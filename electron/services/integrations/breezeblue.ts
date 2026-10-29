/**
 * Breeze（breeze.blue）语音合成客户端。
 *
 * 关键接口事实：
 * - 基础地址：https://api.breeze.blue
 * - 鉴权头：xi-api-key
 * - GET  /v1/models                         模型列表
 * - GET  /v1/voices                         声音列表（分页：page_size + next_page_token）
 * - POST /v1/text-to-speech/{voiceId}?output_format=mp3
 *   body: { text, model_id, instructions, voice_settings: { guidance_scale } }
 * - 支持中文方括号音频标签，例如 [轻笑]、[叹气]、[低语]，会原样传给模型演绎。
 *
 * 除原始音频 Buffer 外，可直接落盘为文件，返回 VoiceSyncResult / TtsResult 供主进程服务容器使用。
 */
import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import type { VoiceInfo, VoiceSyncResult } from '../../../shared/types';
import {
  asArray,
  asRecord,
  buildUrl,
  createMediaFileName,
  extensionFromContentType,
  firstNumber,
  firstString,
  httpBuffer,
  httpJson,
  IntegrationError,
  runConnectionTest,
  saveBinaryFile,
  type ConnectionTestResult,
  type QueryParams,
} from './http';

export interface BreezeBlueClientOptions {
  apiKey: string;
  /** 默认 https://api.breeze.blue。 */
  baseUrl?: string;
  /** 默认 TTS 模型 ID（对应设置 models.breezeTts，例如 "breeze-tts"）。 */
  modelId?: string;
  /** 默认声音 ID（对应设置 models.breezeVoiceId）。 */
  voiceId?: string;
  /** 默认语气引导强度，默认 1。 */
  guidanceScale?: number;
  /** 默认输出格式。 */
  outputFormat?: 'mp3' | 'wav';
  timeoutMs?: number;
}

export interface BreezeModel {
  modelId: string;
  name: string;
  description?: string;
  languages?: string[];
  raw?: unknown;
}

export interface ListVoicesOptions {
  pageSize?: number;
  maxPages?: number;
  signal?: AbortSignal;
}

export interface VoiceListResult {
  voices: VoiceInfo[];
  total: number;
  latestVoiceId?: string;
}

export interface TtsRequest {
  text: string;
  /** 不传则用客户端默认 voiceId。 */
  voiceId?: string;
  /** 不传则用客户端默认 modelId。 */
  modelId?: string;
  /** 语气/情绪指令（中文自然语言）。 */
  instructions?: string;
  /** 语气引导强度 0~1（Breeze voice_settings.guidance_scale）。 */
  guidanceScale?: number;
  speed?: number;
  outputFormat?: 'mp3' | 'wav';
  /** 文本长度上限，默认 2048。 */
  maxChars?: number;
  /** 提供后把音频写入该目录。 */
  outDir?: string;
  /** 自定义文件名（不含目录）。 */
  fileName?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TtsResult {
  buffer: Buffer;
  contentType: string;
  /** 仅当传入 outDir 时存在。 */
  filePath?: string;
  voiceId: string;
  modelId: string;
  text: string;
  outputFormat: 'mp3' | 'wav';
  bytes: number;
}

const DEFAULT_BASE_URL = 'https://api.breeze.blue';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CHARS = 2048;
const DEFAULT_PAGE_SIZE = 100;

/** 推荐的中文音频标签（供人设提示词/UI 展示）。 */
export const AUDIO_TAG_PRESETS: readonly string[] = [
  '轻笑',
  '笑声',
  '叹气',
  '低语',
  '耳语',
  '停顿',
  '呼吸',
  '哽咽',
  '颤音',
  '小声',
  '提高音量',
  '放慢语速',
  '惊讶',
  '温柔',
  '严肃',
  '开心',
  '委屈',
  '害羞',
  '困倦',
  '撒娇',
];

/** 生成给大模型看的中文音频标签说明。 */
export function audioTagGuide(): string {
  return `可以在台词中插入中文方括号音频标签，例如 ${AUDIO_TAG_PRESETS.slice(0, 4)
    .map((tag) => `[${tag}]`)
    .join('')}，语音模型会用对应语气演绎；标签必须独立成对方括号，不参与朗读。`;
}

export function hasAudioTags(text: string): boolean {
  return /\[[^\[\]\n]{1,8}\]/.test(text);
}

/** 去掉音频标签（用于字符数统计）。 */
export function stripAudioTags(text: string): string {
  return text.replace(/\[[^\[\]\n]{1,8}\]/g, '');
}

/**
 * 预处理 TTS 文本：保留 [标签]，压缩空白，按上限在句子边界截断。
 * 空文本会抛出 BAD_REQUEST，避免无意义计费。
 */
export function prepareTtsText(text: string, maxChars = DEFAULT_MAX_CHARS): string {
  const normalized = (text ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!stripAudioTags(normalized).trim()) {
    throw new IntegrationError({
      service: 'breezeblue',
      code: 'BAD_REQUEST',
      message: '语音文本为空，无法合成',
    });
  }
  const limit = Math.max(16, Math.floor(maxChars));
  if (normalized.length <= limit) return normalized;
  const head = normalized.slice(0, limit);
  const boundary = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('\n'),
    head.lastIndexOf('；'),
    head.lastIndexOf('，'),
  );
  const cut = boundary >= Math.floor(limit * 0.6) ? head.slice(0, boundary + 1) : head;
  return cut.trim();
}

/** 把长文本切成若干不超过 maxChars 的片段（优先按句子边界）。 */
export function splitTtsText(text: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  const normalized = (text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return [];
  const limit = Math.max(16, Math.floor(maxChars));
  if (normalized.length <= limit) return [normalized];
  const sentences = normalized
    .split(/(?<=[。！？!?\n；;])/)
    .map((item) => item.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  const push = (): void => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      push();
      for (let index = 0; index < sentence.length; index += limit) {
        chunks.push(sentence.slice(index, index + limit));
      }
      continue;
    }
    if ((current + sentence).length > limit) push();
    current += sentence;
  }
  push();
  return chunks;
}

function normalizeVoice(raw: unknown): VoiceInfo | undefined {
  const record = asRecord(raw);
  const voiceId = firstString(record.voice_id, record.voiceId, record.id);
  if (!voiceId) return undefined;
  const labels = asRecord(record.labels);
  const toneRaw = labels.tone ?? record.tone;
  const tone = Array.isArray(toneRaw)
    ? toneRaw.filter((item): item is string => typeof item === 'string')
    : typeof toneRaw === 'string'
      ? [toneRaw]
      : undefined;
  const createdAtUnix = firstNumber(record.created_at_unix, record.createdAtUnix);
  const createdAt = firstString(record.created_at, record.createdAt)
    ?? (createdAtUnix !== undefined ? new Date(createdAtUnix * 1000).toISOString() : undefined);
  return {
    voiceId,
    name: firstString(record.name, record.voice_name, record.voiceName) ?? voiceId,
    language: firstString(labels.language, record.language, labels.language_code),
    gender: firstString(labels.gender, record.gender),
    age: firstString(labels.age, record.age),
    accent: firstString(labels.accent, record.accent),
    tone,
    createdAt,
    previewUrl: firstString(record.preview_url, record.previewUrl),
    category: firstString(record.category, labels.category),
    isLatest: false,
  };
}

interface VoicesPage {
  voices: VoiceInfo[];
  nextToken?: string;
  total?: number;
  hasMore: boolean;
}

function parseVoicesPage(payload: unknown): VoicesPage {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const listCandidate = Array.isArray(payload)
    ? payload
    : Array.isArray(root.voices)
      ? root.voices
      : Array.isArray(root.items)
        ? root.items
        : Array.isArray(root.data)
          ? root.data
          : Array.isArray(data.voices)
            ? data.voices
            : Array.isArray(data.items)
              ? data.items
              : [];
  const nextToken = firstString(
    root.next_page_token,
    root.nextPageToken,
    data.next_page_token,
    asRecord(root.paging).next_page_token,
    asRecord(data.paging).next_page_token,
  );
  const hasMoreFlag = root.has_more ?? data.has_more ?? root.hasMore ?? data.hasMore;
  const total = firstNumber(root.total, data.total, root.count, data.count);
  const voices = listCandidate
    .map(normalizeVoice)
    .filter((voice): voice is VoiceInfo => voice !== undefined);
  return {
    voices,
    nextToken,
    total,
    hasMore: hasMoreFlag === true || nextToken !== undefined,
  };
}

function sortVoicesByCreatedAt(voices: VoiceInfo[]): VoiceInfo[] {
  return [...voices].sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
    return rightTime - leftTime;
  });
}

export class BreezeBlueClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModelId?: string;
  private readonly defaultVoiceId?: string;
  private readonly defaultGuidanceScale: number;
  private readonly defaultOutputFormat: 'mp3' | 'wav';
  private readonly defaultTimeoutMs: number;

  constructor(options: BreezeBlueClientOptions) {
    this.apiKey = (options.apiKey ?? '').trim();
    this.baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this.defaultModelId = options.modelId?.trim() || undefined;
    this.defaultVoiceId = options.voiceId?.trim() || undefined;
    this.defaultGuidanceScale = options.guidanceScale ?? 1;
    this.defaultOutputFormat = options.outputFormat ?? 'mp3';
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 调用前校验密钥，未配置时抛出统一的 MISSING_API_KEY。 */
  private requireKey(): string {
    if (!this.apiKey) {
      throw new IntegrationError({
        service: 'breezeblue',
        code: 'MISSING_API_KEY',
        message: '尚未配置 Breeze 语音 API Key，请在设置 → API 密钥中填写',
      });
    }
    return this.apiKey;
  }

  /** GET /v1/models → TTS 模型列表。 */
  async listModels(options: { signal?: AbortSignal } = {}): Promise<BreezeModel[]> {
    this.requireKey();
    try {
      const payload = await httpJson<unknown>(buildUrl(this.baseUrl, '/v1/models'), {
        method: 'GET',
        headers: this.headers(),
        service: 'breezeblue',
        timeoutMs: this.defaultTimeoutMs,
        signal: options.signal,
      });
      const root = asRecord(payload);
      const list = Array.isArray(payload)
        ? payload
        : Array.isArray(root.models)
          ? root.models
          : Array.isArray(root.data)
            ? root.data
            : asArray(asRecord(root.data).models);
      return list
        .map((item): BreezeModel | undefined => {
          const record = asRecord(item);
          const modelId = firstString(record.model_id, record.modelId, record.id);
          if (!modelId) return undefined;
          const languages = asArray(record.languages).filter(
            (language): language is string => typeof language === 'string',
          );
          return {
            modelId,
            name: firstString(record.name, record.title) ?? modelId,
            description: firstString(record.description, record.desc),
            languages: languages.length > 0 ? languages : undefined,
            raw: item,
          };
        })
        .filter((model): model is BreezeModel => model !== undefined);
    } catch (error) {
      throw toBreezeError(error);
    }
  }


  /** 用文本描述生成并保存一个音色（Breeze Voice Design）。 */
  async createDesignedVoice(input: { name: string; description: string; text: string; gender?: 'male' | 'female' | 'neutral'; age?: 'child' | 'young' | 'middle_aged' | 'old' }): Promise<{ voiceId: string; name: string }> {
    this.requireKey();
    const design = await httpJson<unknown>(buildUrl(this.baseUrl, '/v1/voice-previews/design'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: {
        voice_description: input.description.slice(0, 500),
        text: input.text.slice(0, 500),
        guidance_scale: 4,
        preview_count: 1,
      },
      service: 'breezeblue',
      timeoutMs: 120_000,
    });
    const root = asRecord(design);
    const previews = Array.isArray(root.previews) ? root.previews : [];
    const first = asRecord(previews[0]);
    const generatedVoiceId = firstString(first.generated_voice_id, first.generatedVoiceId, first.voice_id, first.voiceId);
    if (!generatedVoiceId) throw new IntegrationError({ service: 'breezeblue', code: 'UPSTREAM', message: '音色设计接口没有返回预览 ID' });
    const saved = await httpJson<unknown>(buildUrl(this.baseUrl, '/v1/voice-previews/' + encodeURIComponent(generatedVoiceId) + '/save'), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: {
        voice_name: input.name,
        language_code: 'zh',
        ...(input.gender ? { gender: input.gender } : {}),
        ...(input.age ? { age: input.age } : {}),
      },
      service: 'breezeblue',
      timeoutMs: 120_000,
    });
    const savedRoot = asRecord(saved);
    const voice = asRecord(savedRoot.voice);
    const voiceId = firstString(savedRoot.voice_id, savedRoot.voiceId, voice.voice_id, voice.voiceId);
    const name = firstString(savedRoot.name, savedRoot.voice_name, voice.name, voice.voice_name) ?? input.name;
    if (!voiceId) throw new IntegrationError({ service: 'breezeblue', code: 'UPSTREAM', message: '音色保存接口没有返回 voice_id' });
    return { voiceId, name };
  }

  /** GET /v1/voices：自动翻页拉取全部声音，按 created_at_unix 降序，标记最新声音。 */
  async listVoices(options: ListVoicesOptions = {}): Promise<VoiceListResult> {
    this.requireKey();
    const pageSize = Math.max(1, Math.min(100, options.pageSize ?? DEFAULT_PAGE_SIZE));
    const maxPages = Math.max(1, options.maxPages ?? 10);
    const collected = new Map<string, VoiceInfo>();
    let token: string | undefined;
    let pageFallback = 1;
    let total: number | undefined;

    try {
      for (let page = 0; page < maxPages; page += 1) {
        const query: QueryParams = { page_size: pageSize };
        if (token) query.next_page_token = token;
        else if (pageFallback > 1) query.page = pageFallback;
        const payload = await httpJson<unknown>(buildUrl(this.baseUrl, '/v1/voices', query), {
          method: 'GET',
          headers: this.headers(),
          service: 'breezeblue',
          timeoutMs: this.defaultTimeoutMs,
          signal: options.signal,
        });
        const parsed = parseVoicesPage(payload);
        for (const voice of parsed.voices) collected.set(voice.voiceId, voice);
        total = parsed.total ?? total;
        if (parsed.nextToken) {
          token = parsed.nextToken;
          continue;
        }
        // 兼容只返回 has_more 的实现：用 page 参数继续翻页。
        if (parsed.hasMore && parsed.voices.length >= pageSize) {
          pageFallback += 1;
          token = undefined;
          continue;
        }
        break;
      }
    } catch (error) {
      throw toBreezeError(error);
    }

    const voices = sortVoicesByCreatedAt([...collected.values()]);
    const latestVoiceId = voices[0]?.voiceId;
    if (latestVoiceId) {
      voices[0] = { ...voices[0], isLatest: true };
    }
    return { voices, total: total ?? voices.length, latestVoiceId };
  }

  /** 声音同步：返回可直接写入设置的 VoiceSyncResult。 */
  async syncVoices(options: ListVoicesOptions = {}): Promise<VoiceSyncResult> {
    const { voices, latestVoiceId } = await this.listVoices(options);
    return {
      voices,
      latestVoiceId,
      total: voices.length,
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * 合成语音：POST /v1/text-to-speech/{voiceId}?output_format=mp3
   * 传入 outDir 时会落盘并返回 filePath，否则仅返回 Buffer。
   */
  async synthesize(request: TtsRequest): Promise<TtsResult> {
    this.requireKey();
    const voiceId = request.voiceId?.trim() || this.defaultVoiceId;
    const modelId = request.modelId?.trim() || this.defaultModelId;
    if (!voiceId) {
      throw new IntegrationError({
        service: 'breezeblue',
        code: 'CONFIG',
        message: '未指定语音声音 ID（voiceId），请先在设置中同步并选择声音',
      });
    }
    const outputFormat = request.outputFormat ?? this.defaultOutputFormat;
    const text = prepareTtsText(request.text, request.maxChars ?? DEFAULT_MAX_CHARS);
    const guidanceScale = request.guidanceScale ?? this.defaultGuidanceScale;
    const url = buildUrl(
      this.baseUrl,
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      { output_format: outputFormat },
    );
    const body: Record<string, unknown> = {
      text,
      voice_settings: { guidance_scale: guidanceScale, speed: request.speed },
    };
    if (modelId) body.model_id = modelId;
    if (request.instructions?.trim()) body.instructions = request.instructions.trim();

    try {
      const result = await httpBuffer(url, {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json', Accept: 'audio/mpeg, audio/*, */*' }),
        body,
        service: 'breezeblue',
        timeoutMs: request.timeoutMs ?? this.defaultTimeoutMs,
        signal: request.signal,
      });
      if (result.buffer.byteLength === 0) {
        throw new IntegrationError({
          service: 'breezeblue',
          code: 'BAD_RESPONSE',
          message: 'Breeze 返回了空音频数据',
        });
      }
      const extension =
        extensionFromContentType(result.contentType) ?? (outputFormat === 'wav' ? 'wav' : 'mp3');
      let filePath: string | undefined;
      if (request.outDir) {
        const fileName =
          request.fileName?.trim() ||
          createMediaFileName('tts', extension);
        filePath = await saveBinaryFile(path.join(request.outDir, fileName), result.buffer);
      }
      return {
        buffer: result.buffer,
        contentType: result.contentType || (outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'),
        filePath,
        voiceId,
        modelId: modelId ?? '',
        text,
        outputFormat,
        bytes: result.buffer.byteLength,
      };
    } catch (error) {
      throw toBreezeError(error);
    }
  }

  /**
   * 长文本合成：按 maxChars 切分后逐段合成，返回合并后的 MP3 与片段信息。
   * 仅建议在需要单条语音消息时使用；QQ 场景优先分段发送。
   */
  async synthesizeLong(
    request: TtsRequest,
  ): Promise<TtsResult & { segments: number }> {
    const maxChars = request.maxChars ?? DEFAULT_MAX_CHARS;
    const chunks = splitTtsText(request.text, maxChars);
    if (chunks.length === 0) {
      throw new IntegrationError({
        service: 'breezeblue',
        code: 'BAD_REQUEST',
        message: '语音文本为空，无法合成',
      });
    }
    if (chunks.length === 1) {
      const single = await this.synthesize({ ...request, text: chunks[0], maxChars });
      return { ...single, segments: 1 };
    }
    const buffers: Buffer[] = [];
    let contentType = '';
    let filePath: string | undefined;
    let voiceId = request.voiceId ?? this.defaultVoiceId ?? '';
    let modelId = request.modelId ?? this.defaultModelId ?? '';
    for (let index = 0; index < chunks.length; index += 1) {
      const segment = await this.synthesize({
        ...request,
        text: chunks[index],
        maxChars,
        outDir: undefined,
        fileName: undefined,
      });
      buffers.push(segment.buffer);
      contentType = segment.contentType;
      voiceId = segment.voiceId;
      modelId = segment.modelId;
    }
    const merged = Buffer.concat(buffers);
    const outputFormat = request.outputFormat ?? this.defaultOutputFormat;
    if (request.outDir) {
      const extension = extensionFromContentType(contentType) ?? (outputFormat === 'wav' ? 'wav' : 'mp3');
      const fileName = request.fileName?.trim() || createMediaFileName('tts', extension);
      filePath = await saveBinaryFile(path.join(request.outDir, fileName), merged);
    }
    return {
      buffer: merged,
      contentType: contentType || (outputFormat === 'wav' ? 'audio/wav' : 'audio/mpeg'),
      filePath,
      voiceId,
      modelId,
      text: request.text.trim(),
      outputFormat,
      bytes: merged.byteLength,
      segments: chunks.length,
    };
  }

  /** 连通性测试：优先 /v1/models，失败时回退 /v1/voices。 */
  async testConnection(): Promise<ConnectionTestResult> {
    return runConnectionTest('breezeblue', async () => {
      try {
        const models = await this.listModels({ signal: AbortSignal.timeout(15_000) });
        const { voices } = await this.listVoices({ pageSize: 1, maxPages: 1 });
        const modelText = models.length > 0 ? `模型 ${models.length} 个` : '模型列表为空';
        return `连接正常，${modelText}，可用声音 ${voices.length > 0 ? '已同步' : '待同步'}`;
      } catch (error) {
        if (error instanceof IntegrationError && error.code === 'NOT_FOUND') {
          const { voices } = await this.listVoices({ pageSize: 1, maxPages: 1 });
          return `连接正常，可用声音已同步（${voices.length} 个）`;
        }
        throw error;
      }
    });
  }


  /** 查询账户积分余额（GET /v1/balance）。 */
  async getBalance(options: { signal?: AbortSignal } = {}): Promise<{ balance: number; millicredits?: number } | null> {
    this.requireKey();
    const payload = await httpJson<unknown>(buildUrl(this.baseUrl, '/v1/balance'), {
      method: 'GET',
      headers: this.headers(),
      service: 'breezeblue',
      timeoutMs: 20_000,
      signal: options.signal,
    });
    const root = asRecord(payload);
    const balance = Number(root.balance);
    if (!Number.isFinite(balance)) return null;
    const millicredits = Number(root.balance_millicredits);
    return { balance, ...(Number.isFinite(millicredits) ? { millicredits } : {}) };
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'xi-api-key': this.apiKey,
      Accept: 'application/json',
      ...extra,
    };
  }
}

function toBreezeError(error: unknown): IntegrationError {
  return error instanceof IntegrationError
    ? error
    : new IntegrationError({
        service: 'breezeblue',
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
}

/** 供服务容器注入的便捷构造。 */
export function createBreezeBlueClient(options: BreezeBlueClientOptions): BreezeBlueClient {
  return new BreezeBlueClient(options);
}
