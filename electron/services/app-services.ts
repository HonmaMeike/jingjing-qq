import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ApiKeys, AppSettings, BootstrapData, Persona, PetAsset } from '../../shared/types';
import type { AppPaths } from '../core/paths';
import { EventBus } from '../core/event-bus';
import { Logger } from '../core/logger';
import { SecretsVault } from '../core/secrets';
import { SettingsService } from './settings';
import { PersonaService } from './personas';
import { ConversationStore } from './conversations';
import { ContentStore } from './content';
import { EmotionService } from './emotion';
import { GrowthService } from './growth';
import { IntegrationHub } from './integration-hub';
import { createMemoryService, type MemoryService, type MemoryLlm } from './memory';
import { ChatService } from './chat';
import { NapCatService } from './napcat';
import { AutonomyService } from './autonomy';
import { PluginService } from './plugins';
import { seedDemoConversations } from './demo';
import { nowIso, sanitizeId } from '../core/utils';
import { startMediaServer, type MediaServer } from '../core/media-server';
import { ObservabilityService } from './observability';
import { createConsciousnessService, type ConsciousnessService } from './consciousness';
import { StickerService } from './stickers';
import { ChatToolLimiter } from './chat-tools';

export class AppServices {
  readonly events = new EventBus();
  readonly logger: Logger;
  readonly vault: SecretsVault;
  settings!: SettingsService;
  personas!: PersonaService;
  conversations!: ConversationStore;
  content!: ContentStore;
  emotion!: EmotionService;
  growth!: GrowthService;
  hub!: IntegrationHub;
  memory!: MemoryService;
  chat!: ChatService;
  napcat!: NapCatService;
  autonomy!: AutonomyService;
  plugins!: PluginService;
  petAssets: PetAsset[] = [];
  mediaServer: MediaServer | null = null;
  observability!: ObservabilityService;
  consciousness!: ConsciousnessService;
  stickers!: StickerService;
  chatTools!: ChatToolLimiter;
  private stickerTimer: NodeJS.Timeout | null = null;
  startedAt = Date.now();

  constructor(readonly paths: AppPaths) {
    this.logger = new Logger(paths.logsDir);
    this.vault = new SecretsVault(paths.secretsFile);
  }

  async init(): Promise<void> {
    await this.vault.load();
    this.settings = await SettingsService.create({ file: this.paths.settingsFile, vault: this.vault, events: this.events, logger: this.logger });
    this.observability = await ObservabilityService.create({ file: path.join(this.paths.dataDir, 'usage.json'), events: this.events, getSettings: () => this.settings.get() });
    this.mediaServer = await startMediaServer({ mediaDir: this.paths.mediaDir, petDir: this.paths.bundledPetDir, externalPetDir: this.paths.defaultExternalPetDir, preferredPort: 47821 });
    this.hub = await IntegrationHub.create({
      getSettings: () => this.settings.get(),
      getKeys: () => this.vault.get(),
      mediaDir: this.paths.mediaDir,
      voicesFile: path.join(this.paths.dataDir, 'voices.json'),
      events: this.events,
      logger: this.logger,
      getMediaBaseUrl: () => this.mediaServer?.baseUrl ?? '',
      observability: this.observability,
    });
    const memoryLlm: MemoryLlm = async (req) => {
      if (!this.vault.has('deepseek')) throw new Error('未配置 DeepSeek API Key');
      const res = await this.hub.clients.deepseek.chat([
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ], { model: this.settings.get().models.deepseekChat, temperature: req.temperature ?? 0.3, maxTokens: req.maxTokens ?? 900, jsonMode: req.json ?? false, timeoutMs: this.settings.get().deepseek.timeoutMs });
      return res.content;
    };
    const ctx = this.settings.get().context;
    const initialPersonaId = this.settings.get().persona.activeId || 'jingjing';
    this.memory = await createMemoryService({
      rootDir: await this.preparePersonaMemoryRoot(initialPersonaId),
      llm: memoryLlm,
      settings: {
        maxContextTokens: ctx.maxContextTokens,
        compactAtPercent: ctx.compactAtPercent / 100,
        keepRecentMessages: ctx.keepRecentMessages,
        memoryTopK: ctx.memoryTopK,
        autoMemoryExtraction: ctx.autoMemoryExtraction,
        detailPreservingCompression: ctx.detailPreservingCompression,
        maxMemoryTokens: ctx.maxMemoryTokens,
        crossSessionRecall: ctx.crossSessionRecall,
      },
    });
    this.personas = await PersonaService.create({ file: path.join(this.paths.dataDir, 'personas.json'), events: this.events, getActiveId: () => this.settings.get().persona.activeId, logger: this.logger });
    await this.syncActivePersonaVoice();
    void this.ensurePersonaVoiceBindings();
    this.conversations = await ConversationStore.create(path.join(this.paths.dataDir, 'conversations.json'));
    this.content = await ContentStore.create(this.paths.activityDir);
    this.emotion = await EmotionService.create(path.join(this.paths.dataDir, 'emotion.json'), this.events);
    this.growth = await GrowthService.create(path.join(this.paths.dataDir, 'growth.json'), this.events);
    await this.seedIfNeeded();
    this.consciousness = await createConsciousnessService({
      dataDir: this.paths.dataDir,
      memory: this.memory,
      content: this.content,
      personas: this.personas,
      growth: this.growth,
      getPersonaId: () => this.settings.get().persona.activeId || 'jingjing',
      llm: memoryLlm,
      events: this.events,
      logger: this.logger,
      useLlmForFlow: false,
    });
    this.chatTools = await ChatToolLimiter.create(path.join(this.paths.dataDir, 'tool-usage.json'));
    this.stickers = await StickerService.create({
      dataDir: this.paths.dataDir,
      petDir: this.paths.bundledPetDir,
      externalPetDir: this.paths.defaultExternalPetDir,
      mediaDir: this.paths.mediaDir,
      toMediaUrl: (file) => this.hub.mediaUrl(file),
      getMediaBaseUrl: () => this.mediaServer?.baseUrl ?? '',
      getSettings: () => this.settings.get(),
      saveSettings: (patch) => this.settings.save(patch),
      events: this.events,
      logger: this.logger,
      getPersona: () => this.personas.active(),
      describeImage: (item) => this.hub.describeImage({ url: item.url, localPath: item.file, prompt: '这是准备发给用户的宠物表情包，请描述画面里的角色动作、表情和文字，判断是否适合日常聊天。' }).then((text) => text ?? undefined),
      generateImage: async (prompt) => {
        const job = await this.hub.generateImage(prompt, '1:1', this.personas.active());
        if (job.status === 'done' && job.result?.urls?.length) return { status: 'done', urls: job.result.urls };
        return { status: 'failed', error: job.error ?? '图像生成失败' };
      },
    });
    this.chat = new ChatService({
      store: this.conversations, settings: this.settings, personas: this.personas, memory: this.memory,
      emotion: this.emotion, growth: this.growth, content: this.content, hub: this.hub, events: this.events,
      logger: this.logger, mediaDir: this.paths.mediaDir, observability: this.observability, consciousness: this.consciousness, stickers: this.stickers, chatTools: this.chatTools,
    });
    this.napcat = new NapCatService({
      settings: this.settings, events: this.events, logger: this.logger,
      paths: { napcatDir: this.paths.napcatDir, dataDir: this.paths.dataDir, petDir: this.paths.bundledPetDir, externalPetDir: this.settings.get().general.assetsPath || this.paths.defaultExternalPetDir },
      chat: this.chat,
      observability: this.observability,
    });
    this.autonomy = new AutonomyService({
      settings: this.settings, personas: this.personas, chat: this.chat, content: this.content,
      emotion: this.emotion, growth: this.growth, memory: this.memory, hub: this.hub,
      napcat: this.napcat, events: this.events, logger: this.logger, diaryDir: this.paths.diaryDir, stickers: this.stickers,
    });
    this.plugins = new PluginService({ settings: this.settings, hub: this.hub, napcat: this.napcat, autonomy: this.autonomy, memory: this.memory, dataDir: this.paths.dataDir });
    this.petAssets = await this.loadPetAssets();
    this.events.on('settings:update', () => { try { this.hub.rebuild(); } catch (error) { this.logger.warn('settings', '重建集成容器失败:', (error as Error).message); } });
    if (this.settings.get().plugins.autonomy?.enabled !== false && this.settings.get().autonomy.enabled) this.autonomy.start();
    if (this.settings.get().napcat.autoStart) setTimeout(() => { void this.napcat.start(); }, 4000);
    if (this.settings.get().tts.autoSyncVoices && this.vault.has('breezeblue')) setTimeout(() => { void this.hub.listVoices(true); }, 5000);
    this.stickerTimer = setInterval(() => {
      if (!this.settings.get().general.demoMode) void this.stickers.autoCollectIfDue().catch(() => undefined);
    }, 15 * 60_000);
    this.stickerTimer.unref?.();
    setTimeout(() => {
      if (!this.settings.get().general.demoMode) void this.stickers.autoCollectIfDue().catch(() => undefined);
    }, 90_000).unref?.();
    this.logger.info('app', '服务初始化完成，数据目录:', this.paths.dataDir);
  }

  async listCreations(): Promise<import('../../shared/types').CreationItem[]> {
    const root = this.paths.mediaDir;
    const kinds: Record<string, 'image' | 'video' | 'audio' | 'voice' | 'file'> = { '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mp3': 'audio', '.wav': 'audio', '.m4a': 'audio', '.ogg': 'audio' };
    const items: import('../../shared/types').CreationItem[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth < 0) return;
      let entries;
      try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name === 'stickers') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { await walk(full, depth - 1); continue; }
        const ext = path.extname(entry.name).toLowerCase();
        const kind = kinds[ext];
        if (!kind) continue;
        try {
          const stat = await fs.stat(full);
          const relativePath = path.relative(root, full).split(path.sep).join('/');
          items.push({ id: relativePath, name: path.basename(entry.name, ext), kind, url: this.hub.mediaUrl(full), size: stat.size, createdAt: stat.mtime.toISOString(), relativePath });
        } catch { /* ignore */ }
      }
    };
    await walk(root, 4);
    return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 500);
  }

  private async loadPetAssets(): Promise<PetAsset[]> {
    const configured = this.settings.get().general.assetsPath;
    const roots = [this.paths.bundledPetDir, configured, this.paths.defaultExternalPetDir].filter(Boolean);
    interface PetManifest { animations?: { name: string; webm?: string; gif?: string }[]; memes?: { name: string; png?: string; desc?: string }[] }
    let manifest: PetManifest | null = null;
    for (const root of roots) {
      try {
        const raw = await fs.readFile(path.join(root, 'manifest.json'), 'utf8');
        manifest = JSON.parse(raw) as PetManifest;
        if (manifest) break;
      } catch { /* next */ }
    }
    if (manifest) {
      const assets: PetAsset[] = [];
      for (const item of manifest.animations ?? []) {
        assets.push({ name: item.name, webm: item.webm ? decodeURIComponent(item.webm) : undefined, gif: item.gif ? decodeURIComponent(item.gif) : undefined, category: 'animation' });
      }
      for (const item of manifest.memes ?? []) {
        if (item.png) assets.push({ name: item.name, webm: undefined, gif: decodeURIComponent(item.png), category: 'meme', description: item.desc });
      }
      if (assets.length) return assets;
    }
    const assets: PetAsset[] = [];
    for (const root of roots) {
      try {
        const animDir = path.join(root, 'animations');
        const files = await fs.readdir(animDir).catch(() => [] as string[]);
        for (const file of files.filter((f) => f.endsWith('.webm'))) {
          assets.push({ name: file.replace(/\.webm$/, ''), webm: 'animations/' + file, category: 'animation' });
        }
        const memeDir = path.join(root, 'memes');
        const memes = await fs.readdir(memeDir).catch(() => [] as string[]);
        for (const file of memes.filter((f) => f.endsWith('.png'))) {
          assets.push({ name: file.replace(/\.png$/, ''), gif: 'memes/' + file, category: 'meme' });
        }
        if (assets.length) break;
      } catch { /* next */ }
    }
    return assets;
  }

  private async seedIfNeeded(): Promise<void> {
    if (await fs.access(path.join(this.paths.dataDir, '.fresh-start')).then(() => true).catch(() => false)) return;
    const settings = this.settings.get();
    if (!settings.general.demoMode) return;
    try {
      if (!this.conversations.list().length) await seedDemoConversations(this.conversations, settings.persona.activeId);
      if (!this.content.listDiaries().length) await this.content.seedDemo(settings.persona.activeId);
      const stats = await this.memory.getStats();
      if (stats.docs === 0) await this.memory.seedDemo();
      await this.ensureDemoContactMemory();
      const activeId = settings.persona.activeId || 'jingjing';
      if (this.growth.get(activeId).xp === 0) {
        await this.growth.addXp(activeId, 3600, '演示成长数据');
        await this.growth.addHabit(activeId, '每天整理一次记忆小册子');
        await this.growth.addHabit(activeId, '睡前检查主人有没有好好吃饭');
        await this.growth.addEvolutionNote(activeId, '学会了在对方累的时候，先陪伴而不是急着给建议。');
        await this.growth.addReflection(activeId, '今天发现，被记住的小事会发光。我也想成为那个会记住的人。');
        await this.growth.adjustTrait(activeId, '温柔', 6);
        await this.growth.adjustTrait(activeId, '好奇', 4);
        await this.growth.seedDemoStats(activeId, { totalMessages: 1296, totalDays: 42, streakDays: 8, selfImage: '一条正在学习如何好好陪伴人类的蓝鲸。会闹小脾气，也会在深夜认真听你说话。' });
      }
    } catch (error) { this.logger.warn('seed', '演示数据初始化失败:', (error as Error).message); }
  }

  private async ensureDemoContactMemory(): Promise<void> {
    const docs = this.memory.listDocs({ limit: 200 });
    const has = (search: string) => docs.some((d) => d.displayName.includes(search) || d.externalId === search);
    const seedUser = async (userId: string, nickname: string, facts: { text: string; category: 'identity' | 'preference' | 'event' | 'promise' | 'emotion' | 'boundary' | 'other'; weight: number }[], affinity: number, note: string) => {
      if (has(nickname)) return;
      const doc = await this.memory.store.ensureUserDoc({ userId, nickname, scene: 'private' });
      for (const fact of facts) await this.memory.store.appendFact(doc.id, fact);
      await this.memory.store.updateRelationship(doc.id, { set: { affinity, trust: affinity - 8, familiarity: affinity - 12, intimacy: Math.max(0, affinity - 20), respect: 70, tension: 8 }, note, mood: '放松', touch: true });
    };
    await seedUser('10001', '阿澈', [
      { text: '主人阿澈，经常加班，喝咖啡会胃疼', category: 'identity', weight: 10 },
      { text: '喜欢下雨天，压力大时会一个人待着', category: 'preference', weight: 8 },
      { text: '说「随便」的时候其实想吃火锅', category: 'preference', weight: 9 },
      { text: '讨厌别人碰他的键盘，也不喜欢被敷衍', category: 'boundary', weight: 8 },
      { text: '答应过周末十点起床，一起去公园', category: 'promise', weight: 7 },
    ], 72, '会偷偷关心他的作息和吃饭。');
    await seedUser('10002', '小满', [
      { text: '小满，正在准备面试，容易紧张', category: 'identity', weight: 9 },
      { text: '帮同学改简历到深夜，是个很温柔的人', category: 'event', weight: 7 },
      { text: '面试前需要被鼓励而不是被说教', category: 'preference', weight: 8 },
    ], 58, '把她当妹妹一样照顾。');
    await seedUser('10003', '老陈', [
      { text: '老陈，前端工程师，对记忆压缩和上下文管理感兴趣', category: 'identity', weight: 9 },
      { text: '聊天风格直接，喜欢技术细节', category: 'preference', weight: 7 },
    ], 46, '可以聊技术，但也会互相开玩笑。');
    if (!docs.some((d) => d.scope === 'group' && d.displayName.includes('深海摸鱼群'))) {
      const group = await this.memory.store.ensureGroupDoc({ groupId: '20001', groupName: '深海摸鱼群' });
      for (const name of ['摸鱼队长', '小满', '阿梨', '老陈']) {
        const member = await this.memory.store.ensureUserDoc({ userId: name === '小满' ? '10002' : name === '老陈' ? '10003' : name === '阿梨' ? '10005' : '10004', nickname: name, scene: 'group', groupId: '20001', groupName: '深海摸鱼群' });
        await this.memory.store.appendFact(member.id, { text: name + '是深海摸鱼群成员', category: 'identity', weight: 5 });
      }
      await this.memory.store.updateRelationship(group.id, { set: { affinity: 55, trust: 50, familiarity: 62, intimacy: 30, respect: 60, tension: 5 }, note: '群里大家会聊工作、AI 和摸鱼。', touch: true });
    }
  }

  async buildBootstrap(): Promise<BootstrapData> {
    const settings = this.settings.get();
    const memory = await this.memory.getSummary();
    const overview = await this.autonomy.overview();
    return {
      settings,
      keyStatus: this.settings.getKeyStatus(),
      personas: this.personas.list(),
      conversations: this.chat.listConversations(),
      memory,
      overview,
      plugins: this.plugins.list(),
      integrations: this.hub.status(),
      napcat: this.napcat.getStatus(),
      petAssets: this.petAssets,
      version: app.getVersion(),
      dataDir: this.paths.dataDir,
      isFirstRun: !settings.onboardingDone,
    };
  }

  async stats() {
    const conv = this.conversations.stats();
    const memory = await this.memory.getStats();
    const content = this.content.stats();
    const day = new Date().toISOString().slice(0, 10);
    const actionsToday = this.content.listActivities(200).filter((a) => a.createdAt.slice(0, 10) === day).length;
    const napcat = this.napcat.getStatus();
    return {
      totalMessages: conv.totalMessages,
      todayMessages: conv.todayMessages,
      contacts: memory.users,
      groups: memory.groups,
      memoryFacts: memory.facts,
      diaryCount: content.diaries,
      qzoneCount: content.qzone,
      online: napcat.qqOnline,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      tokensToday: conv.todayTokens,
      actionsToday,
    };
  }


  /** 新人设使用专属音色；已有音色库优先，图拉丁没有匹配项时用 Breeze Voice Design 创建。 */
  private async ensurePersonaVoiceBindings(): Promise<void> {
    const globalId = this.settings.get().models.breezeVoiceId || '';
    const globalName = this.settings.get().models.breezeVoiceName || '';
    const presets: Record<string, { voiceId: string; voiceName: string }> = {
      jingye: { voiceId: 'voc_cknttnw9xhed', voiceName: '鲸爷·中文京腔' },
      sunba: { voiceId: 'voc_7bcqb2xdpknf', voiceName: '鲸吧老哥·中文松弛' },
      dingzhen: { voiceId: 'voc_3rfft246mvuu', voiceName: '丁真理塘·中文温和男声' },
    };
    for (const [id, preset] of Object.entries(presets)) {
      const persona = this.personas.get(id);
      if (!persona) continue;
      if (!persona.voiceId || persona.voiceId === globalId || /软软|软糯/.test(persona.voiceName ?? '')) {
        await this.personas.save({ id: persona.id, name: persona.name, voiceId: preset.voiceId, voiceName: preset.voiceName });
      }
    }
    const tualatin = this.personas.get('tualatin');
    if (tualatin && (!tualatin.voiceId || tualatin.voiceId === globalId || /软软|软糯/.test(tualatin.voiceName ?? ''))) {
      const created = await this.hub.createPersonaVoice({
        name: '图拉丁·中文装机男声',
        description: '年轻中国男生，图拉丁吧装机老哥，声音略带沙哑、语速偏快，懒散但热心，像边拆机边聊天，普通话自然带一点网络口音。',
        text: '兄弟，这配置不值，听我给你算算，别给奸商送钱。',
        gender: 'male',
        age: 'young',
      });
      if (created) await this.personas.save({ id: tualatin.id, name: tualatin.name, voiceId: created.voiceId, voiceName: created.name });
    }
    const active = this.personas.active();
    if (active?.voiceId) {
      const current = this.settings.get();
      if (active.voiceId !== current.models.breezeVoiceId) {
        await this.settings.save({ models: { ...current.models, breezeVoiceId: active.voiceId, breezeVoiceName: active.voiceName || current.models.breezeVoiceName } });
      }
    }
    this.logger.info('app', '新人设音色绑定检查完成（' + (globalName || '无全局音色') + '）');
  }

  private async syncActivePersonaVoice(): Promise<void> {

    const current = this.settings.get();
    const globalVoiceId = current.models.breezeVoiceId || '';
    const globalVoiceName = current.models.breezeVoiceName || '';
    // 每个人设首次出现时都绑定一份当前音色作为默认值；之后各人设手动改音色互不影响。
    if (globalVoiceId) {
      for (const persona of this.personas.list()) {
        if (persona.id === 'tualatin') continue;
        if (!persona.voiceId) {
          await this.personas.save({ id: persona.id, name: persona.name, voiceId: globalVoiceId, voiceName: globalVoiceName });
        }
      }
    }
    const active = this.personas.active();
    if (!active) return;
    const voiceId = active.voiceId || globalVoiceId;
    const voiceName = active.voiceName || globalVoiceName;
    if (voiceId && voiceId !== current.models.breezeVoiceId) {
      await this.settings.save({ models: { ...current.models, breezeVoiceId: voiceId, breezeVoiceName: voiceName } });
    }
  }

  private personaMemoryRoot(personaId: string): string {
    return path.join(this.paths.memoriesDir, sanitizeId(personaId || 'jingjing'));
  }

  /** 第一次升级时把旧的全局 memories 迁移到当前人设，之后每个人设独立目录。 */
  private async preparePersonaMemoryRoot(personaId: string): Promise<string> {
    const base = this.paths.memoriesDir;
    const target = this.personaMemoryRoot(personaId);
    const legacyUsers = path.join(base, 'users');
    const hasLegacy = await fs.access(legacyUsers).then(() => true).catch(() => false);
    const hasTarget = await fs.access(target).then(() => true).catch(() => false);
    if (hasLegacy && !hasTarget) {
      await fs.mkdir(target, { recursive: true });
      for (const name of ['users', 'groups', 'global', 'summaries', 'archive']) {
        const source = path.join(base, name);
        if (await fs.access(source).then(() => true).catch(() => false)) {
          await fs.cp(source, path.join(target, name), { recursive: true });
        }
      }
      this.logger.info('memory', '旧记忆已迁移到当前人设目录:', target);
    }
    await fs.mkdir(target, { recursive: true });
    return target;
  }

  async switchPersona(personaId: string): Promise<{ persona: Persona; settings: AppSettings }> {
    const persona = this.personas.get(personaId);
    if (!persona) throw new Error('人设不存在');
    await this.personas.setActive(personaId);
    await this.memory.switchRoot(await this.preparePersonaMemoryRoot(personaId));
    const current = this.settings.get();
    const voiceId = persona.voiceId || current.models.breezeVoiceId || '';
    const voiceName = persona.voiceName || current.models.breezeVoiceName || '';
    if (!persona.voiceId && voiceId) {
      await this.personas.save({ ...persona, voiceId, voiceName });
    }
    const saved = await this.settings.save({
      persona: { ...current.persona, activeId: personaId },
      models: { ...current.models, breezeVoiceId: voiceId, breezeVoiceName: voiceName },
    });
    void this.consciousness.rebuild(personaId).catch((error) => this.logger.warn('consciousness', '切换人设后重建意识失败:', (error as Error).message));
    return { persona: this.personas.get(personaId) ?? persona, settings: saved.settings };
  }

  /** 手动改音色时，把当前音色绑定到当前人设。 */
  async bindActiveVoice(voiceId: string, voiceName: string): Promise<void> {
    const persona = this.personas.active();
    if (!persona) return;
    await this.personas.save({ id: persona.id, name: persona.name, voiceId, voiceName });
  }

  /**
   * 一键重置所有非设置数据：保留 settings.json、密钥、人设定义、音色库与 NapCat 安装，
   * 清除会话、记忆、日记/说说、成长/情绪、意识、表情包、媒体和用量账本。
   */
  async resetUserData(): Promise<{ removed: string[] }> {
    await this.shutdown().catch((error) => this.logger.warn('reset', '关闭服务时出错，继续清空数据:', (error as Error).message));
    const dataDir = this.paths.dataDir;
    const preserve = new Set(['settings.json', 'secrets.enc.json', 'personas.json', 'voices.json', 'napcat', '.fresh-start']);
    const removed: string[] = [];
    const entries = await fs.readdir(dataDir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (preserve.has(entry)) continue;
      try {
        await fs.rm(path.join(dataDir, entry), { recursive: true, force: true });
        removed.push(entry);
      } catch (error) {
        this.logger.warn('reset', '删除数据项失败，继续:', entry, (error as Error).message);
      }
    }
    await fs.writeFile(path.join(dataDir, '.fresh-start'), nowIso(), 'utf8');
    return { removed };
  }

  async shutdown(): Promise<void> {
    if (this.stickerTimer) { clearInterval(this.stickerTimer); this.stickerTimer = null; }
    this.autonomy.stop();
    await this.napcat.shutdown();
    await this.memory.close().catch(() => undefined);
    await this.mediaServer?.close().catch(() => undefined);
    this.events.removeAll();
  }
}
