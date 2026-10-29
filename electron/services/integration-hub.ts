import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  ApiKeys, AppSettings, BiliDiscovery, IntegrationStatus, MediaJob, Persona, SearchResultItem,
  ServiceId, VoiceInfo, VoiceSyncResult, ProviderBalance,
} from '../../shared/types';
import { createIntegrationsFromSettings, IntegrationError, type IntegrationServices } from './integrations';
import { buildTtsInstruction, toTtsText } from '../../shared/persona-prompts';
import { nowIso, sanitizeId, uid } from '../core/utils';
import { JsonStore } from '../core/json-store';
import type { EventBus } from '../core/event-bus';
import type { Logger } from '../core/logger';
import type { ObservabilityService } from './observability';

interface VoiceCache { voices: VoiceInfo[]; total: number; syncedAt: string; latestVoiceId?: string }

export function mediaUrl(absPath: string, mediaRoot: string): string {
  const rel = path.relative(mediaRoot, absPath).split(path.sep).join('/');
  if (rel.startsWith('..')) return '';
  return 'media://asset/' + rel.split('/').map((s) => encodeURIComponent(s)).join('/');
}

export class IntegrationHub {
  private services!: IntegrationServices;
  private voices: JsonStore<VoiceCache>;
  private lastProbe: IntegrationStatus[] = [];

  private constructor(
    private getSettings: () => AppSettings,
    private getKeys: () => ApiKeys,
    private paths: { mediaDir: string; voicesFile: string },
    private events: EventBus,
    private logger: Logger,
    voices: JsonStore<VoiceCache>,
    private getMediaBaseUrl: () => string,
    private observability?: ObservabilityService,
  ) {
    this.voices = voices;
    this.rebuild();
  }

  static async create(opts: { getSettings: () => AppSettings; getKeys: () => ApiKeys; mediaDir: string; voicesFile: string; events: EventBus; logger: Logger; getMediaBaseUrl?: () => string; observability?: ObservabilityService }): Promise<IntegrationHub> {
    const voices = await JsonStore.open<VoiceCache>(opts.voicesFile, { voices: [], total: 0, syncedAt: '' });
    return new IntegrationHub(opts.getSettings, opts.getKeys, { mediaDir: opts.mediaDir, voicesFile: opts.voicesFile }, opts.events, opts.logger, voices, opts.getMediaBaseUrl ?? (() => ''), opts.observability);
  }

  private instrument(): void {
    const obs = this.observability;
    if (!obs) return;
    const deepseek = this.services.deepseek as unknown as { chat: Function; streamChat?: Function };
    const originalChat = deepseek.chat.bind(deepseek);
    deepseek.chat = async (messages: { role: string; content: string }[], options: Record<string, unknown> = {}) => {
      const started = Date.now();
      obs.recordNeural({ type: 'llm_start', node: 'deepseek', target: 'core', label: 'DeepSeek 接收上下文', detail: String(options.model ?? this.getSettings().models.deepseekChat) + ' · ' + messages.length + ' 条消息' });
      let lastDelta = 0;
      let wrapped = options;
      if (typeof options.onDelta === 'function') {
        const original = options.onDelta as (delta: unknown) => void;
        wrapped = {
          ...options,
          onDelta: (delta: { content?: string; reasoning?: string }) => {
            try { original(delta); } catch { /* ignore */ }
            const now = Date.now();
            if (now - lastDelta > 80) {
              lastDelta = now;
              obs.recordNeural({ type: 'llm_delta', node: 'deepseek', target: 'core', label: delta.reasoning ? '推理流' : '生成流', detail: (delta.reasoning || delta.content || '').slice(0, 160) });
            }
          },
        };
      }
      try {
        const result = await originalChat(messages, wrapped) as { model?: string; content?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
        const usage = result.usage;
        await obs.recordUsage({
          provider: 'deepseek', service: 'DeepSeek Chat', kind: 'llm', model: result.model || String(options.model ?? ''), inputTokens: usage?.promptTokens ?? 0,
          outputTokens: usage?.completionTokens ?? 0, totalTokens: usage?.totalTokens ?? 0, units: usage?.totalTokens ?? 0, unit: 'tokens',
          meta: { purpose: String(options.jsonMode ? 'structured' : 'chat'), reasoning: !!options.reasoning },
        });
        obs.addTokens(usage?.totalTokens ?? 0);
        obs.recordNeural({ type: 'llm_end', node: 'deepseek', target: 'core', label: 'DeepSeek 完成推理', detail: (result.content || '').slice(0, 160), durationMs: Date.now() - started, tokens: usage?.totalTokens ?? 0 });
        return result;
      } catch (error) {
        obs.recordNeural({ type: 'error', node: 'deepseek', target: 'core', label: 'DeepSeek 请求失败', detail: (error as Error).message, durationMs: Date.now() - started });
        throw error;
      }
    };
    try {
      const breeze = this.services.breezeblue as unknown as { synthesize: Function };
      const originalTts = breeze.synthesize.bind(breeze);
      breeze.synthesize = async (request: { text: string }) => {
        const started = Date.now();
        obs.recordNeural({ type: 'tts', node: 'tts', target: 'core', label: '合成语音', detail: request.text.slice(0, 80) });
        const result = await originalTts(request);
        await obs.recordUsage({ provider: 'breezeblue', service: 'BreezeBlue TTS', kind: 'tts', model: String((result as { modelId?: string }).modelId ?? ''), units: request.text.length, unit: 'characters' });
        obs.recordNeural({ type: 'tts', node: 'tts', target: 'core', label: '语音合成完成', durationMs: Date.now() - started, detail: '已缓存到本地媒体库' });
        return result;
      };
    } catch { /* ignore */ }
    try {
      const minimax = this.services.minimax as unknown as { generateImage: Function; generateVideo: Function };
      const image = minimax.generateImage.bind(minimax);
      minimax.generateImage = async (request: { n?: number }) => {
        const started = Date.now();
        const result = await image(request);
        const count = (result as { urls?: string[] }).urls?.length ?? request.n ?? 1;
        await obs.recordUsage({ provider: 'minimax', service: 'MiniMax Image', kind: 'image', model: this.getSettings().models.minimaxImage, units: count, unit: 'images' });
        obs.recordNeural({ type: 'media', node: 'media', target: 'core', label: '生成图像', detail: count + ' 张', durationMs: Date.now() - started });
        return result;
      };
      const video = minimax.generateVideo.bind(minimax);
      minimax.generateVideo = async (...args: unknown[]) => {
        const started = Date.now();
        const request = (args[0] ?? {}) as { duration?: number };
        const result = await video(...args);
        const seconds = request.duration ?? 6;
        await obs.recordUsage({ provider: 'minimax', service: 'MiniMax Video', kind: 'video', model: this.getSettings().models.minimaxVideo, units: seconds, unit: 'seconds' });
        obs.recordNeural({ type: 'media', node: 'media', target: 'core', label: '生成视频', detail: seconds + ' 秒', durationMs: Date.now() - started });
        return result;
      };
    } catch { /* ignore */ }
    try {
      const suno = this.services.suno as unknown as { generateAndWait: Function };
      const originalSuno = suno.generateAndWait.bind(suno);
      suno.generateAndWait = async (...args: unknown[]) => {
        const started = Date.now();
        const result = await originalSuno(...args);
        const tracks = (result as { tracks?: unknown[] }).tracks?.length ?? 0;
        await obs.recordUsage({ provider: 'suno', service: 'Suno Music', kind: 'music', model: 'V6', units: tracks, unit: 'tracks' });
        obs.recordNeural({ type: 'media', node: 'media', target: 'core', label: '生成音乐', detail: tracks + ' 首', durationMs: Date.now() - started });
        return result;
      };
    } catch { /* ignore */ }
    try {
      const serper = this.services.serper as unknown as { search: Function };
      const originalSearch = serper.search.bind(serper);
      serper.search = async (...args: unknown[]) => {
        const started = Date.now();
        const result = await originalSearch(...args);
        await obs.recordUsage({ provider: 'serper', service: 'Serper Search', kind: 'search', units: 1, unit: 'requests' });
        obs.recordNeural({ type: 'tool', node: 'search', target: 'core', label: '联网搜索', detail: String(args[0] ?? ''), durationMs: Date.now() - started });
        return result;
      };
    } catch { /* ignore */ }
  }

  mediaUrl(filePath: string): string { return this.toMediaUrl(filePath); }

  private toMediaUrl(filePath: string): string {
    const rel = path.relative(this.paths.mediaDir, filePath).split(path.sep).join('/');
    const base = this.getMediaBaseUrl();
    if (base && rel && !rel.startsWith('..')) return base + '/media/' + rel.split('/').map((s) => encodeURIComponent(s)).join('/');
    return mediaUrl(filePath, this.paths.mediaDir);
  }

  rebuild(): void {
    this.services = createIntegrationsFromSettings(this.getSettings(), this.getKeys());
    this.instrument();
    this.lastProbe = [];
    this.logger.info('integrations', 'API 集成容器已重建');
  }

  get clients(): IntegrationServices { return this.services; }
  private pluginEnabled(id: string): boolean { return this.getSettings().plugins?.[id]?.enabled !== false; }
  has(id: Exclude<ServiceId, 'napcat'>): boolean { return this.pluginEnabled(id) && this.services.has(id); }

  status(): IntegrationStatus[] { return this.lastProbe.length ? this.lastProbe : this.services.status(); }

  async probeAll(): Promise<IntegrationStatus[]> {
    this.lastProbe = await this.services.probeAll();
    this.events.emit('integration:status', this.lastProbe);
    return this.lastProbe;
  }

  async test(service: ServiceId): Promise<{ ok: boolean; message: string; latencyMs?: number }> {
    if (service === 'napcat') return { ok: false, message: '请到 NapCat 页面测试协议端连接' };
    const started = Date.now();
    try {
      const result = service === 'bilibili' ? { ok: true, detail: '公开 API 可用（实际访问在发现页触发）' } : await (this.services[service] as { testConnection: () => Promise<{ ok: boolean; detail?: string }> }).testConnection();
      return { ok: result.ok, message: result.detail || (result.ok ? '连接成功' : '连接失败'), latencyMs: Date.now() - started };
    } catch (error) {
      const e = error as IntegrationError;
      return { ok: false, message: e.message || '连接失败', latencyMs: Date.now() - started };
    }
  }

  // ---------------- TTS ----------------
  async listVoices(refresh = false): Promise<VoiceSyncResult> {
    const cached = this.voices.get();
    if (!refresh && cached.voices.length && cached.syncedAt) return { voices: cached.voices, total: cached.voices.length, latestVoiceId: cached.latestVoiceId, syncedAt: cached.syncedAt };
    if (!this.services.has('breezeblue')) return { voices: cached.voices, total: cached.voices.length, latestVoiceId: cached.latestVoiceId, syncedAt: cached.syncedAt || nowIso() };
    try {
      const result = await this.services.breezeblue.syncVoices();
      const data: VoiceCache = { voices: result.voices, total: result.total, latestVoiceId: result.latestVoiceId, syncedAt: result.syncedAt };
      await this.voices.set(data);
      const settings = this.getSettings();
      if (settings.tts.preferLatestVoice && result.latestVoiceId && !settings.models.breezeVoiceId) {
        this.logger.info('tts', '音色库已同步，发现最新音色:', result.latestVoiceId);
      }
      return result;
    } catch (error) {
      this.logger.warn('tts', '音色库同步失败:', (error as Error).message);
      return { voices: cached.voices, total: cached.voices.length, latestVoiceId: cached.latestVoiceId, syncedAt: cached.syncedAt || nowIso() };
    }
  }

  async synthesize(text: string, persona: Persona, voiceIdOverride?: string): Promise<{ ok: boolean; url?: string; filePath?: string; error?: string }> {
    if (!this.services.has('breezeblue')) return { ok: false, error: '尚未配置 BreezeBlue API Key' };
    const settings = this.getSettings();
    let voiceId = voiceIdOverride || settings.models.breezeVoiceId;
    let voices = this.voices.get().voices;
    if (!voiceId) {
      if (!voices.length) {
        try { const sync = await this.listVoices(true); voices = sync.voices; } catch { /* ignore */ }
      }
      const zh = voices.filter((v) => (v.language || '').toLowerCase().startsWith('zh') || /chinese|mandarin/i.test(v.language || ''));
      voiceId = settings.tts.preferLatestVoice ? (zh[0]?.voiceId ?? voices[0]?.voiceId) : (zh[0]?.voiceId ?? voices[0]?.voiceId) ?? '';
    }
    if (!voiceId) return { ok: false, error: '尚未选择音色，请到设置页同步 BreezeBlue 音色库' };
    const spoken = toTtsText(text).slice(0, settings.tts.maxChars);
    if (!spoken.trim()) return { ok: false, error: '没有可朗读的文本' };
    const instruction = buildTtsInstruction(persona);
    try {
      const outDir = path.join(this.paths.mediaDir, 'tts');
      await fs.mkdir(outDir, { recursive: true });
      const fileName = `tts-${sanitizeId(persona.id)}-${uid()}.mp3`;
      const result = await this.services.breezeblue.synthesize({
        text: spoken,
        voiceId,
        modelId: settings.models.breezeTts,
        instructions: [instruction.instructions, settings.tts.instructions].filter(Boolean).join('；'),
        guidanceScale: settings.tts.guidanceScale,
        speed: settings.tts.speed,
        outputFormat: settings.tts.outputFormat,
        outDir,
        fileName,
        maxChars: settings.tts.maxChars,
      });
      const filePath = result.filePath ?? path.join(outDir, fileName);
      return { ok: true, filePath, url: this.toMediaUrl(filePath) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('tts', '语音合成失败:', message);
      return { ok: false, error: message };
    }
  }

  // ---------------- media ----------------
  async generateImage(prompt: string, aspectRatio?: string, persona?: Persona): Promise<MediaJob> {
    const id = uid('img-');
    const createdAt = nowIso();
    if (!this.services.has('minimax')) {
      return { id, kind: 'image', status: 'failed', prompt, createdAt, provider: 'MiniMax', error: '尚未配置 MiniMax API Key' };
    }
    const settings = this.getSettings();
    try {
      const outDir = path.join(this.paths.mediaDir, 'images');
      await fs.mkdir(outDir, { recursive: true });
      const result = await this.services.minimax.generateImage({
        prompt: [persona ? `角色气质：${persona.name}，${persona.tagline}` : '', prompt].filter(Boolean).join('\n'),
        aspectRatio: aspectRatio || settings.media.imageAspectRatio,
        n: settings.media.imageCount,
        promptOptimizer: settings.media.promptOptimizer,
        responseFormat: 'base64',
        outDir,
      });
      const urls = result.files.map((f) => this.toMediaUrl(f)).filter(Boolean);
      return { id, kind: 'image', status: 'done', prompt, createdAt, provider: 'MiniMax', result: { urls: urls.length ? urls : result.urls } };
    } catch (error) {
      return { id, kind: 'image', status: 'failed', prompt, createdAt, provider: 'MiniMax', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async generateVideo(prompt: string, duration?: number, resolution?: string, persona?: Persona): Promise<MediaJob> {
    const id = uid('vid-');
    const createdAt = nowIso();
    if (!this.services.has('minimax')) return { id, kind: 'video', status: 'failed', prompt, createdAt, provider: 'MiniMax', error: '尚未配置 MiniMax API Key' };
    const settings = this.getSettings();
    try {
      const outDir = path.join(this.paths.mediaDir, 'videos');
      await fs.mkdir(outDir, { recursive: true });
      const result = await this.services.minimax.generateVideo({
        prompt: [persona ? `角色气质：${persona.name}，${persona.tagline}` : '', prompt].filter(Boolean).join('\n'),
        duration: duration || settings.models.minimaxVideoDuration,
        resolution: resolution || settings.models.minimaxVideoResolution,
        model: settings.models.minimaxVideo,
        aspectRatio: settings.media.videoAspectRatio || '16:9',
        promptOptimizer: true,
      }, { pollIntervalMs: 6000, timeoutMs: 12 * 60_000 }, { outDir });
      const urls = [result.filePath].filter(Boolean).map((f) => this.toMediaUrl(String(f))).filter(Boolean);
      return { id, kind: 'video', status: 'done', prompt, createdAt, provider: 'MiniMax', result: { urls: urls.length ? urls : [result.downloadUrl] } };
    } catch (error) {
      return { id, kind: 'video', status: 'failed', prompt, createdAt, provider: 'MiniMax', error: error instanceof Error ? error.message : String(error) };
    }
  }

  async generateMusic(params: { prompt: string; title?: string; instrumental?: boolean; style?: string; lyrics?: string; vocalGender?: 'm' | 'f' }): Promise<MediaJob> {
    const id = uid('music-');
    const createdAt = nowIso();
    if (!this.services.has('suno')) return { id, kind: 'music', status: 'failed', prompt: params.prompt, createdAt, provider: 'Suno', error: '尚未配置 Suno API Key' };
    const settings = this.getSettings();
    try {
      const outDir = path.join(this.paths.mediaDir, 'music');
      await fs.mkdir(outDir, { recursive: true });
      const result = await this.services.suno.generateAndWait({
        prompt: params.lyrics || params.prompt,
        customMode: !!params.lyrics,
        instrumental: params.instrumental ?? false,
        style: params.style || params.prompt,
        title: params.title,
        model: settings.models.suno,
        vocalGender: params.vocalGender,
      }, { pollIntervalMs: 10_000, timeoutMs: 10 * 60_000 }, { audioDir: outDir, coverDir: outDir });
      const track = result.tracks?.[0];
      if (!track) throw new Error(result.failReason || '音乐生成失败');
      const audioUrl = track.audioPath ? this.toMediaUrl(track.audioPath) : track.audioUrl;
      const coverUrl = track.coverPath ? this.toMediaUrl(track.coverPath) : track.coverUrl;
      return { id, kind: 'music', status: 'done', prompt: params.prompt, createdAt, provider: 'Suno', result: { audioUrl, coverUrl, title: track.title, durationSec: track.durationSec } };
    } catch (error) {
      return { id, kind: 'music', status: 'failed', prompt: params.prompt, createdAt, provider: 'Suno', error: error instanceof Error ? error.message : String(error) };
    }
  }



  /** 用 DeepSeek 多模态真实理解一张图片，返回简短描述。 */
  async describeImage(input: { url?: string; localPath?: string; prompt?: string }): Promise<string | null> {
    if (!this.services.has('deepseek')) return null;
    try {
      let buffer: Buffer | null = null;
      let mime = 'image/jpeg';
      if (input.url?.startsWith('data:')) {
        const match = input.url.match(/^data:([^;]+);base64,(.*)$/);
        if (match) { mime = match[1]; buffer = Buffer.from(match[2], 'base64'); }
      } else if (input.localPath) {
        buffer = await fs.readFile(input.localPath);
        const lower = input.localPath.toLowerCase();
        mime = lower.endsWith('.png') ? 'image/png' : lower.endsWith('.webp') ? 'image/webp' : lower.endsWith('.gif') ? 'image/gif' : 'image/jpeg';
      } else if (input.url && /^https?:\/\//i.test(input.url)) {
        const response = await fetch(input.url, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) return null;
        buffer = Buffer.from(await response.arrayBuffer());
        mime = response.headers.get('content-type')?.split(';')[0] || mime;
      }
      if (!buffer || buffer.byteLength === 0 || buffer.byteLength > 8 * 1024 * 1024) return null;
      const result = await this.services.deepseek.chat([
        { role: 'system', content: '你是图片理解器。只输出一句具体、可核对的中文描述，说明画面主体、表情、文字和氛围，不猜测看不到的内容。' },
        { role: 'user', content: [
          { type: 'text', text: input.prompt || '请描述这张图片的实际内容。' },
          { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + buffer.toString('base64') } },
        ] },
      ], { maxTokens: 220, temperature: 0.2, thinking: false, stream: false });
      return result.content.trim() || null;
    } catch (error) {
      this.logger.warn('vision', '图片理解失败：' + (error as Error).message);
      return null;
    }
  }

  /** 为新人设生成并保存专属音色；没有 Breeze Key 或失败时返回 null。 */
  async createPersonaVoice(input: { name: string; description: string; text: string; gender?: 'male' | 'female' | 'neutral'; age?: 'child' | 'young' | 'middle_aged' | 'old' }): Promise<{ voiceId: string; name: string } | null> {
    if (!this.services.has('breezeblue')) return null;
    try {
      const voice = await this.services.breezeblue.createDesignedVoice(input);
      this.logger.info('integration-hub', '已创建人设专属音色：' + voice.name + ' (' + voice.voiceId + ')');
      return voice;
    } catch (error) {
      this.logger.warn('integration-hub', '创建人设音色失败：' + (error as Error).message);
      return null;
    }
  }

  /** DeepSeek 官方搜索 / 抓取；余额与额度查询。 */
  async searchDeepSeek(query: string, needContent = false): Promise<SearchResultItem[]> {
    const settings = this.getSettings();
    const results = await this.services.deepseek.searchWeb({ query, count: settings.search.maxResults, needContent });
    void this.observability?.recordUsage({ provider: 'deepseek', service: 'DeepSeek Search', kind: 'search', units: 1, unit: 'requests', model: 'deepseek-search' });
    return results.map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.summary || item.snippet,
      source: item.siteName || 'DeepSeek 搜索',
      date: item.publishedAt,
    }));
  }

  async fetchPage(url: string): Promise<{ url: string; title?: string; content: string; description?: string; siteName?: string; publishedAt?: string }> {
    if (!this.services.has('deepseek')) throw new Error('尚未配置 DeepSeek API Key');
    const result = await this.services.deepseek.fetchPage(url);
    void this.observability?.recordUsage({ provider: 'deepseek', service: 'DeepSeek Fetch', kind: 'search', units: 1, unit: 'requests', model: 'deepseek-fetch' });
    return result;
  }

  async search(query: string, type: 'search' | 'news' | 'images' = 'search'): Promise<SearchResultItem[]> {
    const settings = this.getSettings();
    const preferDeepSeek = type === 'search' && settings.search.provider !== 'serper' && this.services.has('deepseek');
    if (preferDeepSeek) {
      try { return await this.searchDeepSeek(query); }
      catch (error) { this.logger.warn('search', 'DeepSeek 搜索失败，尝试 Serper:', (error as Error).message); }
    }
    if (!this.services.has('serper')) {
      if (type === 'search' && this.services.has('deepseek')) return this.searchDeepSeek(query);
      throw new Error('尚未配置 DeepSeek 或 Serper API Key');
    }
    const result = await this.services.serper.search({ query, num: settings.search.maxResults, type, gl: 'cn', hl: 'zh-cn' });
    return result;
  }

  async getBalances(): Promise<ProviderBalance[]> {
    const now = nowIso();
    const out: ProviderBalance[] = [];
    const add = (item: Omit<ProviderBalance, 'updatedAt'>) => out.push({ ...item, updatedAt: now });
    if (this.services.has('deepseek')) {
      try {
        const b = await this.services.deepseek.getBalance({ timeoutMs: 15_000 });
        if (b) add({ provider: 'deepseek', label: 'DeepSeek', available: true, balance: b.total, currency: b.currency, unit: b.currency, detail: '赠金 ' + b.granted + ' · 充值 ' + b.toppedUp, sourceUrl: 'https://platform.deepseek.com/top_up' });
        else add({ provider: 'deepseek', label: 'DeepSeek', available: false, error: '余额接口未返回 CNY 余额', sourceUrl: 'https://platform.deepseek.com/top_up' });
      } catch (error) { add({ provider: 'deepseek', label: 'DeepSeek', available: false, error: (error as Error).message, sourceUrl: 'https://platform.deepseek.com/top_up' }); }
    } else add({ provider: 'deepseek', label: 'DeepSeek', available: false, error: '未配置 API Key', sourceUrl: 'https://platform.deepseek.com/top_up' });

    if (this.services.has('breezeblue')) {
      try {
        const b = await this.services.breezeblue.getBalance({ signal: AbortSignal.timeout(15_000) });
        if (b) add({ provider: 'breezeblue', label: 'BreezeBlue', available: true, balance: b.balance, unit: '积分', detail: 'TTS 共享积分', sourceUrl: 'https://platform.breezeblue.ai/' });
        else add({ provider: 'breezeblue', label: 'BreezeBlue', available: false, error: '余额接口未返回积分', sourceUrl: 'https://platform.breezeblue.ai/' });
      } catch (error) { add({ provider: 'breezeblue', label: 'BreezeBlue', available: false, error: (error as Error).message, sourceUrl: 'https://platform.breezeblue.ai/' }); }
    } else add({ provider: 'breezeblue', label: 'BreezeBlue', available: false, error: '未配置 API Key', sourceUrl: 'https://platform.breezeblue.ai/' });

    if (this.services.has('suno')) {
      try {
        const credits = await this.services.suno.getCredits({ signal: AbortSignal.timeout(15_000) });
        add({ provider: 'suno', label: 'Suno', available: credits !== null, balance: credits ?? undefined, unit: 'credits', detail: credits === null ? '额度接口暂不可用' : 'Suno 生成额度', sourceUrl: 'https://sunoapi.org/' });
      } catch (error) { add({ provider: 'suno', label: 'Suno', available: false, error: (error as Error).message, sourceUrl: 'https://sunoapi.org/' }); }
    } else add({ provider: 'suno', label: 'Suno', available: false, error: '未配置 API Key', sourceUrl: 'https://sunoapi.org/' });

    if (this.services.has('serper')) {
      const credits = this.services.serper.getLastCredits();
      add({ provider: 'serper', label: 'Serper', available: credits !== undefined, balance: credits, unit: 'credits', detail: credits === undefined ? '发起一次搜索后显示剩余 credits' : '最近一次搜索响应', sourceUrl: 'https://serper.dev/dashboard' });
    } else add({ provider: 'serper', label: 'Serper', available: false, error: '未配置 API Key', sourceUrl: 'https://serper.dev/dashboard' });

    add({ provider: 'minimax', label: 'MiniMax', available: false, error: '官方暂未提供 API 余额查询，请到控制台查看', sourceUrl: 'https://platform.minimax.cn/user-center/payment/balance' });
    return out;
  }


  /** 只查 DeepSeek 小钱包，避免为一句“还有多少钱”轮询所有供应商。 */
  async getWalletBalance(): Promise<ProviderBalance> {
    const now = nowIso();
    if (!this.services.has('deepseek')) return { provider: 'deepseek', label: 'DeepSeek', available: false, error: '未配置 DeepSeek API Key', sourceUrl: 'https://platform.deepseek.com/top_up', updatedAt: now };
    try {
      const b = await this.services.deepseek.getBalance({ timeoutMs: 15_000 });
      if (b) return { provider: 'deepseek', label: 'DeepSeek', available: true, balance: b.total, currency: b.currency, unit: b.currency, detail: '赠金 ' + b.granted + ' · 充值 ' + b.toppedUp, sourceUrl: 'https://platform.deepseek.com/top_up', updatedAt: now };
      return { provider: 'deepseek', label: 'DeepSeek', available: false, error: '余额接口未返回 CNY 余额', sourceUrl: 'https://platform.deepseek.com/top_up', updatedAt: now };
    } catch (error) {
      return { provider: 'deepseek', label: 'DeepSeek', available: false, error: (error as Error).message, sourceUrl: 'https://platform.deepseek.com/top_up', updatedAt: now };
    }
  }

  async biliDiscover(interests: string[], limit = 9): Promise<{ bvid: string; title: string; cover: string; url: string; upName: string; play: number; duration: string; desc?: string }[]> {
    if (!this.pluginEnabled('bilibili')) throw new Error('B 站插件已禁用，可在插件中心重新启用');
    try {
      const videos = await this.services.bilibili.searchByInterests(interests, { total: limit });
      try { await this.observability?.recordUsage({ provider: 'bilibili', service: 'Bilibili 发现', kind: 'other', units: videos.length, unit: 'requests' }); } catch { /* ignore */ }
      return videos;
    } catch (error) {
      this.logger.warn('bilibili', 'B站发现失败:', (error as Error).message);
      if (error instanceof IntegrationError) throw new Error(error.message + (error.code === 'UPSTREAM' ? '，可在设置中配置 B 站 Cookie' : ''));
      throw error;
    }
  }
}
