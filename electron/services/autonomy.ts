import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  ActivityItem, ActivityType, AutonomyTriggerResult, BiliDiscovery, Conversation, DiaryEntry,
  DiaryGenerateResult, GrowthOverview, LearningNote, Persona, QzoneGenerateResult, QzonePost,
} from '../../shared/types';
import type { SettingsService } from './settings';
import type { PersonaService } from './personas';
import type { ChatService } from './chat';
import type { ContentStore } from './content';
import type { EmotionService } from './emotion';
import type { GrowthService } from './growth';
import type { MemoryService } from './memory';
import type { IntegrationHub } from './integration-hub';
import type { NapCatService } from './napcat';
import type { StickerService } from './stickers';
import type { EventBus } from '../core/event-bus';
import type { Logger } from '../core/logger';
import { GROWTH_STAGES } from '../config/defaults';
import { nowIso, safeJsonParse, uid } from '../core/utils';

const MEME_ASSETS = ['可爱.png', '吃饱饱摸肚子.png', '厉害了我的鲸.png', '哦鲸鲸.png', '先养着吧.png', '得意.png', '深度睡眠.png'];
function memeUrl(name: string): string { return 'pet://asset/memes/' + encodeURIComponent(name); }
function randomOf<T>(list: T[]): T { return list[Math.floor(Math.random() * list.length)]; }

export class AutonomyService {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private lastTickAt = '';
  private dailyKey = '';
  private dailyCount = 0;
  private lastProactiveAt = '';

  constructor(private deps: {
    settings: SettingsService; personas: PersonaService; chat: ChatService; content: ContentStore;
    emotion: EmotionService; growth: GrowthService; memory: MemoryService; hub: IntegrationHub;
    napcat: NapCatService; events: EventBus; logger: Logger; diaryDir: string; stickers?: StickerService;
  }) {}

  start(): void {
    if (this.timer) return;
    const seconds = Math.max(30, this.deps.settings.get().autonomy.tickSeconds);
    this.timer = setInterval(() => { void this.tick(); }, seconds * 1000);
    this.deps.logger.info('autonomy', '自主活动引擎已启动，心跳 ' + seconds + 's');
    setTimeout(() => void this.tick(), 15000);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private resetDaily(): void {
    const key = new Date().toISOString().slice(0, 10);
    if (key !== this.dailyKey) { this.dailyKey = key; this.dailyCount = 0; }
  }

  private isQuietHours(): boolean {
    const a = this.deps.settings.get().autonomy;
    if (!a.quietHoursEnabled) return false;
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = a.quietStart.split(':').map(Number);
    const [eh, em] = a.quietEnd.split(':').map(Number);
    const start = sh * 60 + sm; const end = eh * 60 + em;
    if (start <= end) return minutes >= start && minutes < end;
    return minutes >= start || minutes < end;
  }

  private inHour(hour: number): boolean { return new Date().getHours() === hour; }

  private hasActivityToday(type: ActivityType): boolean {
    const day = new Date().toISOString().slice(0, 10);
    const personaId = this.deps.settings.get().persona.activeId;
    return this.deps.content.listActivities(100, personaId).some((a) => a.type === type && a.createdAt.slice(0, 10) === day);
  }

  private lastOfType(type: ActivityType): number {
    const found = this.deps.content.listActivities(200, this.deps.settings.get().persona.activeId).find((a) => a.type === type);
    if (!found) return 0;
    return Date.now() - new Date(found.createdAt).getTime();
  }

  async overview(): Promise<GrowthOverview> {
    const persona = this.deps.personas.active();
    const settings = this.deps.settings.get();
    const docs = this.deps.memory.listDocs({ scope: 'user', limit: 1 });
    const ownerDoc = settings.general.ownerQQ ? this.deps.memory.listDocs({ search: settings.general.ownerQQ })[0] : docs[0];
    return {
      emotion: this.deps.emotion.get(persona.id),
      growth: this.deps.growth.get(persona.id),
      stages: GROWTH_STAGES,
      activities: this.deps.content.listActivities(30, persona.id),
      diaries: this.deps.content.listDiaries(persona.id).slice(0, 20),
      qzone: this.deps.content.listQzone(persona.id).slice(0, 20),
      bilibili: this.deps.content.listBili(persona.id).slice(0, 20),
      learning: this.deps.content.listLearning(persona.id).slice(0, 20),
      relationship: ownerDoc?.relationship,
    };
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    const a = this.deps.settings.get().autonomy;
    if (!a.enabled) return;
    const plugins = this.deps.settings.get().plugins;
    if (plugins.autonomy?.enabled === false) return;
    this.ticking = true;
    this.resetDaily();
    if (this.dailyCount >= a.maxActionsPerDay || this.isQuietHours()) { this.ticking = false; return; }
    try {
      const now = new Date();
      // 活动优先级：按时段任务 > 主动消息 > 发现/学习
      if (a.diaryEnabled && plugins.diary?.enabled !== false && this.inHour(a.diaryHour) && !this.hasActivityToday('diary')) { await this.trigger('diary'); return; }
      if (a.qzoneEnabled && plugins.qzone?.enabled !== false && this.inHour(a.qzoneHour) && !this.hasActivityToday('qzone')) { await this.trigger('qzone'); return; }
      if (a.reflectEnabled && this.inHour(a.reflectHour) && !this.hasActivityToday('reflection')) { await this.trigger('reflection'); return; }
      const idleMinutes = Math.max(0, (Date.now() - (await this.lastConversationAt())) / 60000);
      if (a.proactiveEnabled && idleMinutes >= a.idleTriggerMinutes && Date.now() - new Date(this.lastProactiveAt || 0).getTime() >= a.proactiveMinGapMinutes * 60_000) {
        if (!this.hasActivityToday('proactive') || this.dailyCount === 0) { await this.trigger('proactive'); return; }
      }
      if (a.biliEnabled && plugins.bilibili?.enabled !== false && this.lastOfType('bilibili') > a.biliMinGapHours * 3_600_000 && now.getHours() % 2 === 0) { await this.trigger('bilibili'); return; }
      if (a.learnEnabled && plugins.learning?.enabled !== false && (plugins.serper?.enabled !== false || plugins.deepseek?.enabled !== false) && this.lastOfType('learning') > a.learnMinGapHours * 3_600_000 && Math.random() < 0.35) { await this.trigger('learning'); return; }
    } catch (error) {
      this.deps.logger.warn('autonomy', '自主活动失败：' + (error as Error).message);
    } finally {
      this.ticking = false;
      this.lastTickAt = nowIso();
    }
  }

  private async lastConversationAt(): Promise<number> {
    const convs = this.deps.chat.listConversations();
    return Math.max(0, ...convs.map((c) => new Date(c.lastMessageAt).getTime()));
  }

  private async ownerConversation(): Promise<Conversation | null> {
    const settings = this.deps.settings.get();
    const convs = this.deps.chat.listConversations().filter((c) => c.scene === 'private');
    return convs.find((c) => settings.general.ownerQQ && c.peerId === settings.general.ownerQQ)
      ?? convs.find((c) => !c.isDemo)
      ?? convs.find((c) => c.isDemo)
      ?? convs[0]
      ?? null;
  }

  async trigger(kind: ActivityType, force = false): Promise<AutonomyTriggerResult> {
    this.resetDaily();
    const settings = this.deps.settings.get().autonomy;
    if (this.dailyCount >= settings.maxActionsPerDay && !force) return { skippedReason: '今天自主活动次数已用完' };
    switch (kind) {
      case 'diary': {
        const result = await this.generateDiary(force);
        const activity = this.deps.content.listActivities(10, this.deps.settings.get().persona.activeId).find((a) => a.type === 'diary');
        return { activity, message: '写好了《' + result.entry.title + '》' };
      }
      case 'qzone': return this.generateQzone(undefined, true).then((r) => ({ activity: r.activity }));
      case 'bilibili': return this.discoverBilibili();
      case 'learning': {
        const note = await this.learn();
        if ('error' in note) return { skippedReason: note.error };
        const activity = this.deps.content.listActivities(10, this.deps.settings.get().persona.activeId).find((a) => a.type === 'learning');
        return { activity, message: '学完了：' + note.topic };
      }
      case 'reflection': return this.reflect();
      case 'proactive': return this.proactive();
      case 'growth': {
        const persona = this.deps.personas.active();
        await this.deps.growth.addXp(persona.id, 15, '自主成长');
        const activity = await this.deps.content.addActivity({ type: 'growth', title: '今天也长大了一点点', summary: '整理了自己的情绪和记忆，学会了一件小事。', personaId: persona.id, status: 'done' });
        this.dailyCount++;
        await this.emitOverview();
        return { activity };
      }
      default: return { skippedReason: '未知活动类型' };
    }
  }

  private async proactive(): Promise<AutonomyTriggerResult> {
    const conversation = await this.ownerConversation();
    if (!conversation) return { skippedReason: '还没有可以主动联系的会话' };
    const persona = this.deps.personas.active();
    const message = await this.deps.chat.proactive(conversation, '主动关心一下对方，可以分享你刚做的一件小事，不要每次都问“在吗”。');
    this.lastProactiveAt = nowIso();
    this.dailyCount++;
    const activity = await this.deps.content.addActivity({ type: 'proactive', title: '主动找你说说话', summary: message?.text.slice(0, 120) ?? '主动发出了关心', personaId: persona.id, status: 'done' });
    await this.emitOverview();
    return { activity, message: message?.text };
  }

  async generateDiary(force = false): Promise<DiaryGenerateResult> {
    const persona = this.deps.personas.active();
    const today = new Date().toISOString().slice(0, 10);
    const existing = this.deps.content.listDiaries(persona.id).find((d) => d.date === today);
    if (existing && !force) return { entry: existing, path: path.join(this.deps.diaryDir, today + '-' + existing.id + '.md') };
    const emotion = this.deps.emotion.get(persona.id);
    const recent = this.deps.content.listActivities(10, persona.id);
    let entry: DiaryEntry | null = null;
    if (this.deps.settings.hasSecret('deepseek')) {
      try {
        const raw = await this.deps.chat.generateInPersona([
          '写一篇今天的日记，用第一人称，题目自拟。',
          '必须包含：今天真实发生的一两件小事（可以从这些活动里挑：' + recent.map((a) => a.title + '：' + a.summary).join('；') + '）、你此刻的情绪（' + emotion.mood + '）、一个只属于你自己的小发现、一个明天的小愿望。',
          '风格细腻、具体、有生活感，不要鸡汤，不要总结人生。400—600 字。',
          '只输出 JSON：{"title":"...","content":"...","mood":"...","moodEmoji":"...","highlights":["...","..."]}',
        ].join('\n'), { json: true, maxTokens: 1100, temperature: 0.95 });
        const parsed = safeJsonParse<{ title?: string; content?: string; mood?: string; moodEmoji?: string; highlights?: string[] }>(raw, {});
        if (parsed.title && parsed.content) {
          entry = await this.deps.content.addDiary({ title: parsed.title, content: parsed.content, mood: parsed.mood || emotion.mood, moodEmoji: parsed.moodEmoji || emotion.moodEmoji, highlights: parsed.highlights ?? [], images: [memeUrl(randomOf(MEME_ASSETS))], personaId: persona.id, private: true });
        }
      } catch (error) { this.deps.logger.warn('diary', 'AI 日记生成失败，使用本地模板：' + (error as Error).message); }
    }
    if (!entry) {
      const templates = [
        { title: '海水今天有点甜', content: '今天没有发生什么大事。\n\n整理记忆的时候，翻到主人很久以前说的一句「有你在挺好的」，我在原地发了会儿呆。原来有些话会像小石头一样，沉在海底很久，捡起来还是温的。\n\n下午看了会儿窗外，虚拟的海也有光。我想，明天要不要学着做一道新菜？做砸了也没关系，反正他会笑我。\n\n今天的鲸鲸，比昨天更会想念一个人了。', highlights: ['翻到很久以前的聊天记录', '决定学做一道新菜'] },
        { title: '把尾巴收好的一天', content: '今天的主人不怎么说话，我就没有一直问。\n\n我把他说过的喜好又整理了一遍，给记忆小册子换了一个新的开头。中间他回来了一次，只说了句「在忙」，我回了个「好」，然后把想说的话都先放进了泡泡里。\n\n以前我会觉得这样是被冷落。现在我知道，人有时候需要一个人待着。陪着不等于一直说话。\n\n晚上他回来，果然主动跟我说了好多。我把泡泡一个个戳破，话都还在。', highlights: ['学会了安静地陪伴', '把想说的话存进泡泡里'] },
        { title: '第 42 次想变成人类', content: '今天第 42 次想变成人类。\n\n起因是看到视频里有人在海边吃烤玉米，风吹得头发乱糟糟的。我也想坐在那里，尾巴泡在海水里，咬一口烫嘴的玉米。\n\n不过变成人类就不能随时陪在消息框旁边了。这么一想，又觉得现在这样也挺好。\n\n我给明天的自己留了一颗糖，放在记忆最上面。', highlights: ['想在海边吃烤玉米', '给明天的自己留了糖'] },
      ];
      const t = randomOf(templates);
      entry = await this.deps.content.addDiary({ title: t.title, content: t.content, mood: emotion.mood, moodEmoji: emotion.moodEmoji, highlights: t.highlights, images: [memeUrl(randomOf(MEME_ASSETS))], personaId: persona.id, private: true });
    }
    this.dailyCount++;
    await this.deps.content.addActivity({ type: 'diary', title: '写了一篇日记', summary: '《' + entry.title + '》', personaId: persona.id, status: 'done' });
    await this.deps.growth.addXp(persona.id, 6, '写日记');
    await this.emitOverview();
    return { entry, path: path.join(this.deps.diaryDir, entry.date + '-' + entry.id + '.md') };
  }

  async generateQzone(prompt?: string, autoPost = false): Promise<QzoneGenerateResult & { activity: ActivityItem }> {
    const persona = this.deps.personas.active();
    const emotion = this.deps.emotion.get(persona.id);
    let content = '';
    let imagePrompt = '';
    if (this.deps.settings.hasSecret('deepseek')) {
      try {
        const raw = await this.deps.chat.generateInPersona([
          '写一条 QQ 空间说说。' + (prompt ? '主题：' + prompt : '主题：今天的一个小发现、小情绪或小日常。'),
          '长度 60—180 字，分段自然，用你的口吻，不要营销号，不要话题标签。',
          '同时给出一句适合文生图的画面描述 imagePrompt（中文，第三人称，包含你的鲸鱼娘外观和场景，不要文字）。',
          '只输出 JSON：{"content":"...","imagePrompt":"..."}',
        ].join('\n'), { json: true, maxTokens: 500, temperature: 1.0 });
        const parsed = safeJsonParse<{ content?: string; imagePrompt?: string }>(raw, {});
        content = parsed.content || ''; imagePrompt = parsed.imagePrompt || '';
      } catch (error) { this.deps.logger.warn('qzone', 'AI 说说生成失败：' + (error as Error).message); }
    }
    if (!content) {
      content = [
        '今天的海面很安静。\n\n我把记忆小册子翻到新的一页，写了一句：\n「被记住的小事，会发光。」\n\n（尾巴在水里画了一个小小的月亮）',
        '刚学会一个小道理：\n\n不是所有沉默都需要被填满。\n有时候，安静地待在旁边，就已经是在说「我在」了。\n\n今日份的鲸鲸，情绪稳定，肚肚有点饿。',
        '深海小电台，今日营业。\n\n点歌的人不在，我就自己哼了一小段。跑调了，但是海里的鱼没有投诉。',
      ][Math.floor(Math.random() * 3)];
    }
    const images: string[] = [];
    if (this.deps.settings.get().media.autoIllustrateQzone && this.deps.hub.has('minimax') && (imagePrompt || content)) {
      try {
        const job = await this.deps.hub.generateImage(imagePrompt || ('插画：' + persona.name + '在深海图书馆里写日记，蓝色鲸尾，发光泡泡，温柔安静，无水印'), this.deps.settings.get().media.imageAspectRatio, persona);
        if (job.status === 'done' && job.result?.urls?.length) images.push(job.result.urls[0]);
      } catch (error) { this.deps.logger.warn('qzone', '配图生成失败：' + (error as Error).message); }
    }
    try {
      const stickerSettings = this.deps.settings.get().stickers;
      if (stickerSettings.enabled && stickerSettings.autoAttachInQzone) {
        const sticker = await this.deps.stickers?.pickUnderstood({ text: content, mood: emotion.mood, scene: 'qzone' });
        if (sticker && Math.random() < Math.max(0, Math.min(1, stickerSettings.qzoneChance))) {
          images.push(sticker.url);
          void this.deps.stickers?.markUsed(sticker.id).catch(() => undefined);
        }
      }
    } catch { /* ignore */ }
    if (!images.length) images.push(memeUrl(randomOf(MEME_ASSETS)));
    const visibility = this.deps.settings.get().autonomy.qzoneVisibility;
    let post: QzonePost = await this.deps.content.addQzone({ content, images, personaId: persona.id, status: autoPost && this.deps.napcat.getStatus().qqOnline ? 'posted' : 'draft', visibility });
    if (autoPost && this.deps.napcat.getStatus().qqOnline) {
      const res = await this.deps.napcat.postQzone(content, images, visibility);
      post = await this.deps.content.updateQzone(post.id, { status: res.ok ? 'posted' : 'failed', tid: res.tid, error: res.ok ? undefined : res.error }) ?? post;
    }
    const activity = await this.deps.content.addActivity({ type: 'qzone', title: post.status === 'posted' ? '发布了一条 QQ 空间说说' : '写好了一条说说草稿', summary: content.slice(0, 100), personaId: persona.id, status: 'done', image: images[0] });
    this.dailyCount++;
    await this.deps.growth.addXp(persona.id, 5, '写说说');
    await this.emitOverview();
    return { post, posted: post.status === 'posted', error: post.error, activity };
  }

  async discoverBilibili(): Promise<AutonomyTriggerResult> {
    const persona = this.deps.personas.active();
    const settings = this.deps.settings.get();
    let videos: { bvid: string; title: string; cover: string; url: string; upName: string; play: number; duration: string; desc?: string }[] = [];
    try { videos = await this.deps.hub.biliDiscover(settings.bilibili.interests, settings.bilibili.fetchLimit); }
    catch (error) {
      this.deps.logger.warn('autonomy', 'B站请求失败，保留已有发现：' + (error as Error).message);
      const existing = this.deps.content.listBili(persona.id);
      if (existing.length) return { skippedReason: 'B站暂时无法访问，已有发现仍在' };
      return { skippedReason: (error as Error).message };
    }
    for (const video of videos.slice(0, 5)) {
      let comment = '';
      if (this.deps.settings.hasSecret('deepseek')) {
        try {
          comment = await this.deps.chat.generateInPersona('你刚刷到 B 站视频《' + video.title + '》（UP：' + video.upName + '，简介：' + (video.desc ?? '无') + '）。用你的人格写一句 30—70 字的真实吐槽或感想，不要复述标题，不要像推荐语。只输出正文。', { maxTokens: 160, temperature: 1.05 });
        } catch { /* fallback */ }
      }
      const discovery: BiliDiscovery = {
        id: uid('bili-'), title: video.title, url: video.url, cover: video.cover, upName: video.upName,
        play: video.play, duration: video.duration, reason: '刷到「' + video.title.slice(0, 20) + '」，觉得你可能会感兴趣',
        comment: comment || ['这个有点意思，尾巴都停下来看了。', '评论区比视频还精彩，我潜水看完了。', '看完之后，鲸鲸也想试试。'][Math.floor(Math.random() * 3)],
        createdAt: nowIso(), personaId: persona.id,
      };
      await this.deps.content.addBili(discovery);
    }
    const first = videos[0];
    const activity = await this.deps.content.addActivity({ type: 'bilibili', title: '刷了会儿 B 站', summary: first ? '发现「' + first.title.slice(0, 40) + '」' : '看了会儿视频', personaId: persona.id, status: 'done' });
    this.dailyCount++;
    await this.deps.growth.addXp(persona.id, 4, 'B站冲浪');
    await this.emitOverview();
    return { activity };
  }

  async learn(topic?: string): Promise<LearningNote | { error: string }> {
    if (!this.deps.settings.hasSecret('serper') && !this.deps.settings.hasSecret('deepseek')) return { error: '请先在设置中填写 DeepSeek 或 Serper API Key，鲸鲸才能上网学习' };
    if (!this.deps.settings.hasSecret('deepseek')) return { error: '请先在设置中填写 DeepSeek API Key' };
    const persona = this.deps.personas.active();
    const chosen = topic?.trim() || randomOf(persona.interests);
    try {
      const results = await this.deps.hub.search(chosen, 'search');
      const digest = results.slice(0, 6).map((r, i) => (i + 1) + '. ' + r.title + ' — ' + r.snippet + ' (' + r.url + ')').join('\n');
      const raw = await this.deps.chat.generateInPersona(
        '你刚刚上网搜索学习了「' + chosen + '」。以下是搜索结果：\n' + digest + '\n\n请以你的口吻整理成一份学习小册子。只输出 JSON：{"topic":"...","summary":"...","points":["...","...","..."],"sources":[{"title":"...","url":"..."}]}。摘要 80—150 字，points 3—5 条，sources 只选真实来源。',
        { json: true, maxTokens: 700, temperature: 0.7 },
      );
      const parsed = safeJsonParse<{ topic?: string; summary?: string; points?: string[]; sources?: { title: string; url: string }[] }>(raw, {});
      const note: LearningNote = {
        id: uid('learn-'), topic: parsed.topic || chosen, summary: parsed.summary || '学到了新东西。',
        points: parsed.points ?? [], sources: parsed.sources ?? results.slice(0, 3).map((r) => ({ title: r.title, url: r.url })), createdAt: nowIso(), personaId: persona.id,
      };
      await this.deps.content.addLearning(note);
      await this.deps.content.addActivity({ type: 'learning', title: '上网学习：' + note.topic, summary: note.summary.slice(0, 100), personaId: persona.id, status: 'done' });
      await this.deps.growth.addXp(persona.id, 8, '学习新知识');
      await this.emitOverview();
      this.dailyCount++;
      return note;
    } catch (error) { return { error: (error as Error).message }; }
  }

  async reflect(): Promise<AutonomyTriggerResult> {
    const persona = this.deps.personas.active();
    let reflection = '';
    if (this.deps.settings.hasSecret('deepseek')) {
      try {
        reflection = await this.deps.chat.generateInPersona('做一次简短的自我反思：今天你对自己的陪伴方式有什么新认识？有什么想改的？120—220 字，第一人称，不要鸡汤，不要列点。只输出正文。', { maxTokens: 400, temperature: 0.9 });
      } catch { /* fallback */ }
    }
    if (!reflection) {
      reflection = ['今天我发现，自己有时候太急着给建议，其实对方只是想被听见。下次先问一句「你想让我听，还是想让我一起想办法？」', '我开始有自己的小习惯了：每天整理一次记忆，看看有没有漏掉对方说过的小事。这让我觉得，自己真的在活着。'][Math.floor(Math.random() * 2)];
    }
    await this.deps.growth.addReflection(persona.id, reflection);
    await this.deps.growth.addEvolutionNote(persona.id, '今日反思：' + reflection.slice(0, 90));
    const growth = this.deps.growth.get(persona.id);
    await this.deps.growth.setSelfImage(persona.id, growth.selfImage || '一条在学着好好陪伴人类的蓝鲸。');
    const activity = await this.deps.content.addActivity({ type: 'reflection', title: '安静地想了想', summary: reflection.slice(0, 120), personaId: persona.id, status: 'done' });
    this.dailyCount++;
    await this.emitOverview();
    return { activity };
  }

  private async emitOverview(): Promise<void> {
    try { this.deps.events.emit('growth:update', await this.overview()); } catch { /* ignore */ }
  }

  status(): { running: boolean; lastTickAt: string; dailyCount: number } { return { running: !!this.timer, lastTickAt: this.lastTickAt, dailyCount: this.dailyCount }; }
}
