import path from 'node:path';
import fs from 'node:fs/promises';
import type {
  ChatAttachment, ChatMessage, ChatSendParams, ChatSendResult, Conversation, EmotionState, GrowthState,
  PermissionRole, Persona, Scene,
} from '../../shared/types';
import type { ConversationStore } from './conversations';
import type { SettingsService } from './settings';
import type { PersonaService } from './personas';
import type { MemoryService } from './memory';
import type { MemoryLlm, BuildContextResult } from './memory';
import type { EmotionService } from './emotion';
import type { GrowthService } from './growth';
import type { ContentStore } from './content';
import type { IntegrationHub } from './integration-hub';
import type { Logger } from '../core/logger';
import type { ObservabilityService } from './observability';
import type { ConsciousnessService } from './consciousness';
import type { StickerService } from './stickers';
import type { ChatToolLimiter } from './chat-tools';
import { parseChatCommand, type ChatCommand } from './chat-commands';
import { renderAffectionCard } from './affection-card';
import { localSing } from './local-sing';
import type { EventBus } from '../core/event-bus';
import type { ChatMessageInput } from './integrations';
import { buildPersonaSystemPrompt } from '../../shared/persona-prompts';
import { metaInstruction, parseReply, simulateReply, splitReply, shouldRespond, resolveRole, attachmentsFromMeta, demoSticker, isGroupChatAllowed, personaVocalGender, type ReplyMeta } from './chat-shared';
import { estimateTokens, nowIso, sleep, uid } from '../core/utils';

export interface ChatOutbound {
  available(): boolean;
  sendReplies(conversation: Conversation, parts: { text: string; attachments?: ChatAttachment[] }[]): Promise<void>;
  sendProactive(conversation: Conversation, parts: { text: string; attachments?: ChatAttachment[] }[]): Promise<void>;
}

interface IncomingParams {
  scene: Scene;
  userId: string;
  nickname: string;
  text: string;
  groupId?: string;
  groupName?: string;
  avatar?: string;
  mentioned?: boolean;
  attachments?: ChatAttachment[];
}

export interface IncomingResult { handled: boolean; reason?: string; conversation?: Conversation; reply?: ChatMessage; }

const POSITIVE = /开心|喜欢|谢谢|爱你|可爱|厉害|棒|抱|亲|好耶|哈哈/;
const NEGATIVE = /难过|生气|烦|累|讨厌|滚|闭嘴|失望|伤心|哭|压力/;

export class ChatService {
  private outbound: ChatOutbound | null = null;
  private busy = new Set<string>();
  private lastReplyAt = new Map<string, number>();
  private recentReplies = new Map<string, string[]>();

  constructor(private deps: {
    store: ConversationStore;
    settings: SettingsService;
    personas: PersonaService;
    memory: MemoryService;
    emotion: EmotionService;
    growth: GrowthService;
    content: ContentStore;
    hub: IntegrationHub;
    events: EventBus;
    logger: Logger;
    mediaDir: string;
    petDir: string;
    observability: ObservabilityService;
    consciousness: ConsciousnessService;
    stickers: StickerService;
    chatTools: ChatToolLimiter;
  }) {}

  setOutbound(outbound: ChatOutbound): void { this.outbound = outbound; }

  listConversations(): Conversation[] { return this.deps.store.list(); }
  getMessages(id: string, limit = 200): ChatMessage[] { return this.deps.store.getMessages(id, limit); }

  async createConversation(input: { peerName: string; scene?: Scene; peerId?: string; demo?: boolean }): Promise<Conversation> {
    const persona = this.deps.personas.active();
    const scene = input.scene ?? 'private';
    const peerId = input.peerId || (input.demo ? 'demo_' + uid() : uid('local'));
    return this.deps.store.create({ peerId, peerName: input.peerName, scene, groupId: scene === 'group' ? peerId : undefined, groupName: scene === 'group' ? input.peerName : undefined, personaId: persona.id, demo: input.demo ?? false });
  }

  async markRead(id: string): Promise<void> { await this.deps.store.markRead(id); }

  async clear(id: string): Promise<void> { await this.deps.store.clear(id); }
  async remove(id: string): Promise<void> { await this.deps.store.remove(id); }

  async setPersona(conversationId: string, personaId: string): Promise<Conversation> {
    const persona = this.deps.personas.get(personaId);
    if (!persona) throw new Error('人设不存在');
    return this.deps.store.updateConversation(conversationId, { personaId });
  }


  /** 把创作工坊生成的媒体追加到最近的聊天会话里。 */
  async shareCreation(input: { kind: ChatAttachment['kind']; url: string; title?: string }): Promise<{ message: ChatMessage; conversation: Conversation }> {
    const conversation = this.deps.store.list()[0];
    if (!conversation) throw new Error('还没有聊天会话，先在聊天页新建或发送一条消息');
    const attachment: ChatAttachment = { kind: input.kind, url: input.url, name: input.title || '刚做好的作品' };
    const message = await this.deps.store.append(conversation.id, {
      role: 'assistant',
      text: input.title ? '（把刚做好的「' + input.title + '」发给你）' : '（把刚做好的作品发给你）',
      senderName: this.deps.personas.active()?.name || '鲸鲸',
      scene: conversation.scene,
      attachments: [attachment],
      meta: { personaId: this.deps.personas.active()?.id, source: 'local' },
    });
    this.deps.events.emit('chat:message', { message, conversation: this.deps.store.get(conversation.id)! });
    return { message, conversation: this.deps.store.get(conversation.id)! };
  }

  async send(params: ChatSendParams): Promise<ChatSendResult> {
    const conversation = this.deps.store.get(params.conversationId);
    if (!conversation) throw new Error('会话不存在');
    if (!conversation.isDemo && !this.deps.settings.get().napcat.allowDesktopSendToQq) {
      throw new Error('QQ 会话默认只读；如需在软件内代发，请在 NapCat 设置中打开「允许桌面代发 QQ」');
    }
    if (this.busy.has(conversation.id)) throw new Error('鲸鲸还在回复上一条，稍等一下嘛');
    const persona = this.deps.personas.get(params.personaId || conversation.personaId) ?? this.deps.personas.active();
    const userMessage = await this.deps.store.append(conversation.id, {
      role: 'user', text: params.text, senderId: conversation.peerId, senderName: conversation.peerName,
      scene: conversation.scene, attachments: params.attachments, meta: { source: 'local' },
    });
    this.deps.events.emit('chat:message', { message: userMessage, conversation: this.deps.store.get(conversation.id)! });
    this.deps.events.emit('chat:typing', { conversationId: conversation.id, typing: true });
    try {
      const result = await this.generateReply({ conversation, persona, userMessage, role: 'owner', incoming: false });
      return result;
    } finally {
      this.deps.events.emit('chat:typing', { conversationId: conversation.id, typing: false });
    }
  }

  /** 收到真实 QQ 消息（由 NapCat 服务调用）。 */
  async handleIncoming(params: IncomingParams): Promise<IncomingResult> {
    const settings = this.deps.settings.get();
    if (params.scene === 'group' && !isGroupChatAllowed(settings.permissions, params.groupId)) {
      return { handled: false, reason: '该群未开启群聊或未加入白名单' };
    }
    const check = shouldRespond({
      scene: params.scene, userId: params.userId, text: params.text, mentioned: !!params.mentioned,
      settings: { permissions: settings.permissions, napcat: settings.napcat },
    });
    if (!check.ok) return { handled: false, reason: check.reason };
    const persona = this.deps.personas.active();
    let conversation: Conversation;
    if (params.scene === 'group') {
      const groupId = params.groupId ?? 'unknown';
      conversation = this.deps.store.list().find((c) => c.id === 'group_' + groupId)
        ?? await this.deps.store.create({ peerId: groupId, peerName: params.groupName ?? 'QQ 群', scene: 'group', groupId, groupName: params.groupName, personaId: persona.id, demo: false });
    } else {
      conversation = this.deps.store.list().find((c) => c.id === 'private_' + params.userId)
        ?? await this.deps.store.create({ peerId: params.userId, peerName: params.nickname, scene: 'private', peerAvatar: params.avatar, personaId: persona.id, demo: false });
    }
    await this.deps.store.updateConversation(conversation.id, { peerName: params.scene === 'group' ? conversation.peerName : params.nickname, unread: (this.deps.store.get(conversation.id)?.unread ?? 0) + 1 });
    const userMessage = await this.deps.store.append(conversation.id, {
      role: 'user', text: params.text, senderId: params.userId, senderName: params.nickname,
      avatar: params.avatar, scene: params.scene, attachments: params.attachments, meta: { source: 'qq' },
    });
    this.deps.events.emit('chat:message', { message: userMessage, conversation: this.deps.store.get(conversation.id)! });
    this.deps.events.emit('chat:typing', { conversationId: conversation.id, typing: true });
    void this.deps.observability.recordUsage({ provider: 'napcat', service: 'QQ 消息接收', kind: 'message', units: 1, unit: 'messages', meta: { scene: params.scene } });
    try {
      const result = await this.generateReply({ conversation: this.deps.store.get(conversation.id)!, persona, userMessage, role: check.role, incoming: true });
      const replyParts = result.reply ? splitReply(result.reply.text, settings.napcat.splitReplies ? 3 : 1) : [];
      // 语音/TTS 回复时正文可能为空，但附件仍需发送。
      if (result.reply && replyParts.length === 0 && result.reply.attachments?.length) replyParts.push('');
      const replies = replyParts.map((text, index) => ({ text, attachments: index === 0 ? result.reply?.attachments : undefined }));
      if (replies.length && this.outbound?.available()) {
        await this.outbound.sendReplies(this.deps.store.get(conversation.id)!, replies);
        void this.deps.observability.recordUsage({ provider: 'napcat', service: 'QQ 消息发送', kind: 'message', units: replies.length, unit: 'messages', meta: { scene: params.scene } });
      }
      return { handled: true, conversation: this.deps.store.get(conversation.id), reply: result.reply };
    } catch (error) {
      this.deps.logger.error('chat', '处理 QQ 消息失败:', error);
      return { handled: true, conversation, reason: (error as Error).message };
    } finally {
      this.deps.events.emit('chat:typing', { conversationId: conversation.id, typing: false });
    }
  }

  private commandAttachment(command: ChatCommand, result: { urls?: string[]; audioUrl?: string; title?: string }): ChatAttachment[] {
    if (command.kind === 'music' && result.audioUrl) return [{ kind: 'music', url: result.audioUrl, name: result.title || '鲸鲸唱的歌' }];
    if (command.kind === 'video' && result.urls?.[0]) return [{ kind: 'video', url: result.urls[0], name: '鲸鲸生成的视频' }];
    if (command.kind === 'image' && result.urls?.[0]) return [{ kind: 'image', url: result.urls[0], name: '鲸鲸画的图' }];
    return [];
  }

  private async appendCommandReply(conversation: Conversation, persona: Persona, text: string, attachments: ChatAttachment[] = []): Promise<ChatSendResult> {
    const reply = await this.deps.store.append(conversation.id, {
      role: 'assistant', text, senderName: persona.name, scene: conversation.scene, attachments,
      meta: { personaId: persona.id, mood: '陪你', source: 'local', model: 'chat-command' },
    });
    const updated = this.deps.store.get(conversation.id)!;
    this.deps.events.emit('chat:message', { message: reply, conversation: updated });
    return { reply, conversation: updated, context: { estimatedTokens: estimateTokens(text), maxTokens: this.deps.settings.get().context.maxContextTokens, compacted: false, memoryHits: 0, rawMessages: this.deps.store.getMessages(conversation.id).length, summaryVersion: 0 } };
  }

  private async runChatCommand(command: ChatCommand, conversation: Conversation, persona: Persona, userMessage: ChatMessage, role: PermissionRole): Promise<ChatSendResult | undefined> {
    const settings = this.deps.settings.get();
    if (command.kind === 'fetch') {
      try {
        const page = await this.deps.hub.fetchPage(command.url);
        const body = page.content.replace(/\s+/g, ' ').slice(0, 1200);
        return this.appendCommandReply(conversation, persona, '看完了《' + (page.title || command.url) + '》：\n' + body);
      } catch (error) {
        return this.appendCommandReply(conversation, persona, '这个网页没打开：' + (error as Error).message);
      }
    }
    if (command.kind === 'help') {
      const names = { image: '画图', video: '视频', music: '唱歌' } as const;
      return this.appendCommandReply(conversation, persona, '用法：先写「' + names[command.tool] + '」，再跟一句描述。比如「画 一只在海底吃白饭的蓝鲸」「唱《起风了》」「视频 蓝鲸跃出海面」。');
    }
    if (command.kind === 'affection') {
      const speaker = { userId: userMessage.senderId || conversation.peerId, nickname: userMessage.senderName || conversation.peerName };
      const docs = await this.deps.memory.ensureConversationMemory({
        userId: speaker.userId, nickname: speaker.nickname, scene: conversation.scene,
        groupId: conversation.groupId, groupName: conversation.groupName,
      });
      const relationship = (docs.memberDoc ?? docs.userDoc)?.relationship;
      if (!relationship) return this.appendCommandReply(conversation, persona, '鲸鲸还没攒到你的好感档案，先多聊几句嘛。');
      const outDir = path.join(this.deps.mediaDir, 'affection');
      const outputPath = path.join(outDir, 'affection-' + uid() + '.png');
      const ok = await renderAffectionCard({
        userName: speaker.nickname, personaName: persona.name, scene: conversation.scene,
        affinity: relationship.affinity, trust: relationship.trust, familiarity: relationship.familiarity,
        intimacy: relationship.intimacy, respect: relationship.respect,
        interactions: relationship.interactions, streakDays: relationship.streakDays,
        firstMetAt: relationship.firstMetAt, outputPath,
      }).catch(() => false);
      const url = ok ? this.deps.hub.mediaUrl(outputPath) : '';
      const doc = docs.memberDoc ?? docs.userDoc;
      const facts = (doc?.facts ?? []).filter((fact) => fact.text && !/边界|禁忌|隐私/.test(fact.text)).slice(0, 6);
      const impressions = facts.filter((fact) => /性格|偏好|喜欢|讨厌|习惯|身份|印象/.test(fact.category + fact.text)).slice(0, 2).map((fact) => fact.text.slice(0, 42));
      const memories = facts.filter((fact) => /事件|经历|承诺|约定|共同/.test(fact.category + fact.text)).slice(0, 2).map((fact) => fact.text.slice(0, 42));
      const impressionText = impressions.length ? impressions.join('；') : (doc?.preview?.slice(0, 60) || '还在慢慢认识你');
      const memoryText = memories.length ? memories.join('；') : '暂时没有特别的事，慢慢攒。';
      const text = '（把关于' + speaker.nickname + '的好感档案摊开给你看）\n好感 ' + Math.round(relationship.affinity) + ' / 信任 ' + Math.round(relationship.trust) + ' / 熟悉 ' + Math.round(relationship.familiarity) + ' / 亲密 ' + Math.round(relationship.intimacy) + ' / 尊重 ' + Math.round(relationship.respect) + '\n印象：' + impressionText + '\n记得：' + memoryText;
      return this.appendCommandReply(conversation, persona, text, url ? [{ kind: 'image', url, name: '好感档案' }] : []);
    }

    const tool = command.kind;
    const denial = await this.deps.chatTools.check(tool, userMessage.senderId || conversation.peerId, role, settings.chatTools);
    if (denial) return this.appendCommandReply(conversation, persona, '（尾巴摇了摇）' + denial + '。可以找主人给你开权限，或者自己动手在创作工坊里生成。');
    if (tool === 'image') {
      const job = await this.deps.hub.generateImage(command.prompt, settings.media.imageAspectRatio, persona);
      if (job.status !== 'done' || !job.result?.urls?.length) return this.appendCommandReply(conversation, persona, '画到一半没游出来：' + (job.error || '再试一次嘛'));
      await this.deps.chatTools.consume(tool, userMessage.senderId || conversation.peerId);
      return this.appendCommandReply(conversation, persona, '画好啦，给你。', this.commandAttachment(command, { urls: job.result.urls }));
    }
    if (tool === 'video') {
      const job = await this.deps.hub.generateVideo(command.prompt, settings.models.minimaxVideoDuration, settings.models.minimaxVideoResolution);
      if (job.status !== 'done' || !job.result?.urls?.length) return this.appendCommandReply(conversation, persona, '视频没生成出来：' + (job.error || '网络或额度问题，稍后再试'));
      await this.deps.chatTools.consume(tool, userMessage.senderId || conversation.peerId);
      return this.appendCommandReply(conversation, persona, '拍好啦，点开看看。', this.commandAttachment(command, { urls: job.result.urls }));
    }
    this.deps.logger.info('chat', '唱歌命令：调用 Suno 生成歌曲 query=' + (command.title || command.query || '随机'));
    const randomStyles = ['温柔的中文流行曲，木吉他，轻声唱给喜欢的人', '轻快的海底爵士，鲸鱼尾巴打节拍，女声哼唱', '安静的钢琴民谣，关于深海和晚安'];
    const songQuery = command.query || randomStyles[Math.floor(Math.random() * randomStyles.length)];
    const gender = personaVocalGender(persona);
    const job = await this.deps.hub.generateMusic({ prompt: command.query ? '一首叫《' + songQuery + '》的歌，中文' + (gender === 'm' ? '男声' : '女声') + '演唱，旋律好听' : songQuery + '，' + (gender === 'm' ? '男声' : '女声') + '演唱', title: command.title, instrumental: false, style: (command.query ? '流行' : '中文流行') + '，' + (gender === 'm' ? '男声' : '女声') + '主唱', vocalGender: gender });
    if (job.status !== 'done' || !job.result?.audioUrl) {
      this.deps.logger.warn('chat', 'Suno 失败，尝试本地逐字演唱：' + (job.error || '无音频'));
      const local = await localSing({ lyrics: command.query || songQuery || '白饭白饭真好吃尾巴摇摇', outDir: path.join(this.deps.mediaDir, 'music'), persona, hub: this.deps.hub });
      if (local.ok && local.filePath) {
        const url = this.deps.hub.mediaUrl(local.filePath);
        return this.appendCommandReply(conversation, persona, 'Suno 没接上，我用她的声音慢慢唱了一遍。', [{ kind: 'music', url, localPath: local.filePath, name: '鲸鲸的本地演唱' }]);
      }
      return this.appendCommandReply(conversation, persona, '这首歌没唱出来：' + (job.error || local.error || 'Suno 暂时没有回应'));
    }
    await this.deps.chatTools.consume(tool, userMessage.senderId || conversation.peerId);
    return this.appendCommandReply(conversation, persona, '唱给你听，' + (command.title ? '《' + command.title + '》' : '这首即兴的'), this.commandAttachment(command, { audioUrl: job.result.audioUrl, title: job.result.title }));
  }

  private replyNgrams(text: string): Set<string> {
    const clean = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
    const out = new Set<string>();
    for (let i = 0; i + 3 <= clean.length; i += 1) out.add(clean.slice(i, i + 3));
    return out;
  }

  private isNearRepeat(personaId: string, text: string): boolean {
    const recent = this.recentReplies.get(personaId) ?? [];
    const a = this.replyNgrams(text);
    if (a.size === 0) return false;
    return recent.some((old) => {
      const b = this.replyNgrams(old);
      let hit = 0;
      for (const gram of a) if (b.has(gram)) hit += 1;
      return hit / Math.max(1, Math.min(a.size, b.size)) > 0.62;
    });
  }

  private rememberReply(personaId: string, text: string): void {
    const next = [...(this.recentReplies.get(personaId) ?? []), text].slice(-8);
    this.recentReplies.set(personaId, next);
  }

  private async varyReply(text: string, persona: Persona, messages: ChatMessageInput[], conversation: Conversation): Promise<string> {
    if (!text || !this.isNearRepeat(persona.id, text)) return text;
    try {
      const llm = this.deps.hub.clients.deepseek;
      const settings = this.deps.settings.get();
      const result = await llm.chat([
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: '[系统重写要求] 你刚才这句话和最近说过的太像了。保持意思和情绪，但换一种完全不同的说法；不要解释，不要提系统，只输出正文。' },
      ], { model: settings.models.deepseekChat, temperature: Math.min(1.5, settings.deepseek.temperature + 0.12), maxTokens: Math.min(500, settings.deepseek.maxTokens), thinking: false, timeoutMs: Math.min(45_000, settings.deepseek.timeoutMs), stream: false });
      const parsed = parseReply(result.content);
      if (parsed.text && !this.isNearRepeat(persona.id, parsed.text)) {
        this.deps.logger.info('chat', '反重复改写命中', { conversationId: conversation.id });
        return parsed.text;
      }
    } catch (error) {
      this.deps.logger.warn('chat', '反重复改写失败：' + (error as Error).message);
    }
    return text;
  }

  private async autoSticker(text: string, mood: string | undefined, scene: 'private' | 'group'): Promise<ChatAttachment | undefined> {
    const settings = this.deps.settings.get().stickers;
    if (!settings.enabled || !settings.autoSendInChat) return undefined;
    if (Math.random() >= Math.max(0, Math.min(1, settings.autoSendChance))) return undefined;
    try {
      const item = await this.deps.stickers.pickUnderstood({ text, mood, scene });
      if (!item) return undefined;
      void this.deps.stickers.markUsed(item.id).catch(() => undefined);
      return { kind: 'sticker', name: item.name, url: item.url };
    } catch (error) {
      this.deps.logger.warn('stickers', '自动挑选表情包失败:', (error as Error).message);
      return undefined;
    }
  }

  /** 把本地/远程图片转成 DeepSeek 多模态 image_url 数据。 */
  private async buildImageParts(attachments: ChatAttachment[] | undefined): Promise<{ type: 'image_url'; image_url: { url: string } }[]> {
    const images = (attachments ?? []).filter((item) => (item.kind === 'image' || item.kind === 'sticker') && (item.localPath || item.url)).slice(0, 4);
    const parts: { type: 'image_url'; image_url: { url: string } }[] = [];
    for (const image of images) {
      try {
        let buffer: Buffer | null = null;
        let mime = 'image/jpeg';
        if (image.url?.startsWith('data:')) {
          const match = image.url.match(/^data:([^;]+);base64,(.*)$/);
          if (match) { mime = match[1]; buffer = Buffer.from(match[2], 'base64'); }
        } else if (image.localPath) {
          buffer = await fs.readFile(image.localPath);
          mime = image.localPath.toLowerCase().endsWith('.png') ? 'image/png' : image.localPath.toLowerCase().endsWith('.webp') ? 'image/webp' : image.localPath.toLowerCase().endsWith('.gif') ? 'image/gif' : 'image/jpeg';
        } else if (image.url?.startsWith('pet://asset/')) {
          const rel = decodeURIComponent(image.url.slice('pet://asset/'.length));
          const local = path.join(this.deps.petDir, rel);
          buffer = await fs.readFile(local);
          mime = local.toLowerCase().endsWith('.png') ? 'image/png' : local.toLowerCase().endsWith('.gif') ? 'image/gif' : local.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
        } else if (image.url && /^https?:\/\//i.test(image.url)) {
          const response = await fetch(image.url, { signal: AbortSignal.timeout(15_000) });
          if (!response.ok) continue;
          buffer = Buffer.from(await response.arrayBuffer());
          mime = response.headers.get('content-type')?.split(';')[0] || mime;
        }
        if (!buffer || buffer.byteLength === 0 || buffer.byteLength > 30 * 1024 * 1024) continue;
        parts.push({ type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + buffer.toString('base64') } });
      } catch (error) {
        this.deps.logger.warn('chat', '读取图片失败，已跳过：' + (error as Error).message);
      }
    }
    return parts;
  }

  private async walletHint(text: string): Promise<string> {
    if (!/(余额|钱包|零花|多少钱|剩多少|还剩|够不够花|多少额度|破产)/.test(text)) return '';
    const wallet = await this.deps.hub.getWalletBalance();
    if (wallet.available && typeof wallet.balance === 'number') {
      const amount = wallet.balance.toFixed(2);
      const detail = wallet.detail ? '（' + wallet.detail + '）' : '';
      return '【小钱包实时状态】你的 DeepSeek 小钱包里大约有 ¥' + amount + detail + '。用户这轮在问钱/余额；请用你的人设口吻自然回答，可以说"我看看钱包"之类，但不要提 API、接口、供应商、模型，也不要机械报一串数字；金额说个大概即可，重点是够不够花/要不要省着点。';
    }
    return '【小钱包实时状态】小钱包暂时查不到余额（' + (wallet.error || '还没连上') + '）。用户这轮在问钱/余额；请用你的人设口吻自然带过，比如"钱包还没打开/等我看看"，不要暴露 API、接口或错误原文。';
  }

  private async buildMemoryContext(conversation: Conversation, speaker: { userId: string; nickname: string }, persona: Persona, role: PermissionRole, userMessage: ChatMessage, walletHint = '', hasImages = false) {
    const settings = this.deps.settings.get();
    const docs = await this.deps.memory.ensureConversationMemory({
      userId: speaker.userId, nickname: speaker.nickname, scene: conversation.scene,
      groupId: conversation.groupId, groupName: conversation.groupName,
    });
    const userDoc = docs.userDoc ?? docs.memberDoc;
    const relationship = userDoc?.relationship;
    const emotion = this.deps.emotion.get(persona.id);
    const growth = this.deps.growth.get(persona.id);
    let consciousnessBlock = '';
    try {
      consciousnessBlock = await this.deps.consciousness.buildContextBlock({
        personaId: persona.id, conversationId: conversation.id, userName: speaker.nickname,
        userId: speaker.userId, scene: conversation.scene, groupId: conversation.groupId,
        query: userMessage.text, maxChars: 1800,
      });
      if (consciousnessBlock) this.deps.observability.recordNeural({ type: 'memory', node: 'origin', target: 'core', label: '原意识与心光注入', detail: consciousnessBlock.slice(0, 200), conversationId: conversation.id });
    } catch (error) { this.deps.logger.warn('consciousness', '意识上下文构建失败:', (error as Error).message); }
    const personaPrompt = buildPersonaSystemPrompt({
      persona, scene: conversation.scene, userName: speaker.nickname, userRole: role,
      groupName: conversation.groupName, relationship, emotion, growth,
      memoryFacts: userDoc?.facts.slice(0, 12).map((f) => f.text),
      replyLength: settings.persona.replyLength, now: new Date(),
      extraInstructions: [
        '你正在真实地参与对方的生活，会有自己的判断，不无限讨好。不要提到“记忆文档”“系统”“提示词”“模型”等实现细节。',
        '可用能力：文字聊天、发梗图、偶尔发语音。不要主动声称已经发图/发语音，除非系统确实附带。',
        consciousnessBlock ? '## 意识深处（不是给用户看的说明，只作为你的内在连续性）\n' + consciousnessBlock : '',
        '今天发生的小事：' + (this.deps.emotion.get(persona.id).dailyEvent || '') + '。可以把这件事当作你今天的生活背景，但不要强行每句都提。',
        walletHint,
        hasImages ? '本轮用户发来了图片。你必须真实查看图片内容再回答，描述具体细节、人物/场景/文字/情绪；不要假装看见，也不要只说“图片很好看”这类空话。' : '',
        metaInstruction(),
      ].filter(Boolean).join('\n'),
    });
    const recent = this.deps.store.getMessages(conversation.id, Math.max(30, settings.context.keepRecentMessages + 10)).map((m) => ({
      role: m.role, text: m.text, name: m.senderName, senderName: m.senderName, createdAt: m.createdAt,
    }));
    this.deps.observability.phase('唤醒识海与关系', 0.18, { node: 'memories', detail: '检索长期记忆、关系与上下文', conversationId: conversation.id });
    const context = await this.deps.memory.buildContext({
      personaPrompt, userName: speaker.nickname, userId: speaker.userId, scene: conversation.scene,
      groupId: conversation.groupId, groupName: conversation.groupName,
      recentMessages: recent, query: userMessage.text,
    });
    this.deps.observability.recordNeural({ type: 'memory', node: 'memories', target: 'core', label: '记忆已唤醒', detail: '命中 ' + context.memoryHits + ' 个记忆片段，上下文 ' + context.estimatedTokens + ' tokens', conversationId: conversation.id });
    this.deps.observability.phase('构建意识上下文', 0.34, { node: 'origin', detail: '原意识、心光与对话窗口合流', conversationId: conversation.id });
    return { context, docs, relationship, emotion, growth };
  }

  private async generateReply(opts: { conversation: Conversation; persona: Persona; userMessage: ChatMessage; role: PermissionRole; incoming: boolean }): Promise<ChatSendResult> {
    const { conversation, persona, userMessage, role } = opts;
    const command = parseChatCommand(userMessage.text);
    if (command) {
      const commandResult = await this.runChatCommand(command, conversation, persona, userMessage, role);
      if (commandResult) return commandResult;
    }
    this.busy.add(conversation.id);
    const settings = this.deps.settings.get();
    this.deps.observability.beginTurn(conversation.id, '感知到新消息');
    this.deps.observability.recordNeural({ type: 'message_in', node: 'user', target: 'core', label: userMessage.senderName ? userMessage.senderName + ' 发来消息' : '收到消息', detail: userMessage.text.slice(0, 160), conversationId: conversation.id });
    const startedAt = Date.now();
    const hasKey = this.deps.settings.hasSecret('deepseek') && this.deps.settings.get().plugins.deepseek?.enabled !== false;
    try {
      if (!hasKey) {
        await sleep(settings.napcat.replyDelayMinMs > 2000 ? 900 : 650);
        const text = simulateReply(persona, userMessage.text);
        const pickedSticker = await this.autoSticker(text, this.deps.emotion.get(persona.id)?.mood, conversation.scene);
        const sticker = pickedSticker ? undefined : (Math.random() < 0.22 ? demoSticker(persona) : undefined);
        const attachments: ChatAttachment[] = pickedSticker ? [pickedSticker] : sticker ? [{ kind: 'sticker', name: sticker.replace(/\.png$/, ''), url: 'pet://asset/memes/' + encodeURIComponent(sticker) }] : [];
        const reply = await this.deps.store.append(conversation.id, {
          role: 'assistant', text, senderName: persona.name, scene: conversation.scene, attachments,
          meta: { personaId: persona.id, mood: '陪你', source: 'local', model: 'offline-demo', reasoning: '离线人设演示；配置 DeepSeek API Key 后启用真实对话' },
        });
        await this.applyEmotion(persona, { mood: '温柔', valenceDelta: 0.015, affectionDelta: 0.004, reason: '和对方聊天' });
        await this.deps.growth.addXp(persona.id, 4, '消息互动');
        this.deps.observability.phase('离线人设回应', 0.85, { node: 'persona', detail: '未配置大脑，使用人设演示回复', conversationId: conversation.id });
        this.deps.observability.recordNeural({ type: 'reply', node: 'persona', target: 'user', label: '演示回复', detail: reply.text.slice(0, 120), conversationId: conversation.id });
        void this.deps.consciousness.observeExchange({
          personaId: persona.id, conversationId: conversation.id, userName: conversation.peerName,
          userId: conversation.peerId, scene: conversation.scene, groupId: conversation.groupId,
          userText: userMessage.text, assistantText: reply.text,
        }).then((observe) => this.deps.observability.recordNeural({ type: 'memory', node: 'flow', target: 'core', label: '心光 / 心流更新', detail: observe.changes.join('；'), conversationId: conversation.id }))
          .catch((error) => this.deps.logger.warn('consciousness', '意识结构更新失败:', (error as Error).message));
        const updated = this.deps.store.get(conversation.id)!;
        this.deps.events.emit('chat:message', { message: reply, conversation: updated });
        return { userMessage, reply, conversation: updated, context: { estimatedTokens: estimateTokens(userMessage.text), maxTokens: settings.context.maxContextTokens, compacted: false, memoryHits: 0, rawMessages: this.deps.store.getMessages(conversation.id).length, summaryVersion: 0 } };
      }

      const speaker = { userId: userMessage.senderId || conversation.peerId, nickname: userMessage.senderName || conversation.peerName };
      const walletHint = await this.walletHint(userMessage.text);
    const imageParts = await this.buildImageParts(userMessage.attachments);
    const built = await this.buildMemoryContext(conversation, speaker, persona, role, userMessage, walletHint, imageParts.length > 0);
      let messages: ChatMessageInput[] = built.context.messages.map((m) => ({ role: m.role, content: m.content }));
      if (imageParts.length > 0) {
        // 明确追加为最后一条 user 消息，避免当前图片被贴到历史旧消息上。
        messages.push({ role: 'user', content: [{ type: 'text', text: '（用户刚发来图片，请先看图片）' + (userMessage.text || '') }, ...imageParts] });
        this.deps.observability.phase('识别图片内容', 0.46, { node: 'deepseek', detail: '把图片送入多模态理解', conversationId: conversation.id });
      }
      const llm = this.deps.hub.clients.deepseek;
      this.deps.observability.phase('DeepSeek 推理', 0.5, { node: 'deepseek', detail: settings.models.deepseekChat + ' · ' + messages.length + ' 条上下文', conversationId: conversation.id });
      let result = await llm.chat(messages, {
        model: settings.models.deepseekChat, temperature: settings.deepseek.temperature, maxTokens: settings.deepseek.maxTokens,
        thinking: settings.deepseek.useReasoningForChat, reasoningEffort: settings.deepseek.reasoningEffort ?? 'high',
        timeoutMs: settings.deepseek.timeoutMs,
        stream: settings.deepseek.stream, onDelta: settings.deepseek.stream ? () => undefined : undefined,
      });
      this.deps.observability.phase('解析回复与情绪', 0.74, { node: 'core', detail: '解析正文、状态协议与可能的工具动作', conversationId: conversation.id });
      let parsed = parseReply(result.content);
      // 工具式动作：搜索后二次回答
      const action = parsed.meta.actions?.find((a) => a.type === 'search');
      if (action?.query && (this.deps.hub.has('serper') || this.deps.hub.has('deepseek'))) {
        try {
          this.deps.observability.phase('调用 Serper 搜索', 0.62, { node: 'search', detail: action.query, conversationId: conversation.id });
          const searchResults = await this.deps.hub.search(action.query, 'search');
          const digest = searchResults.slice(0, 5).map((r, i) => `${i + 1}. ${r.title} — ${r.snippet}（${r.url}）`).join('\n');
          messages = [
            ...messages,
            { role: 'assistant', content: parsed.text || result.content },
            { role: 'user', content: `[系统工具结果] 我已为你检索“${action.query}”，以下是网页摘要，请基于它们用你的口吻回答原来的问题，不要编造，不要逐条罗列链接：\n${digest}` },
          ];
          this.deps.observability.phase('基于检索再推理', 0.68, { node: 'deepseek', detail: '将搜索结果带回原意识', conversationId: conversation.id });
          result = await llm.chat(messages, { model: settings.models.deepseekChat, temperature: settings.deepseek.temperature, maxTokens: settings.deepseek.maxTokens, thinking: settings.deepseek.useReasoningForChat, reasoningEffort: settings.deepseek.reasoningEffort ?? 'high', timeoutMs: settings.deepseek.timeoutMs, stream: settings.deepseek.stream, onDelta: settings.deepseek.stream ? () => undefined : undefined });
          parsed = parseReply(result.content);
        } catch (error) {
          this.deps.logger.warn('chat', '搜索工具失败，使用原回复:', (error as Error).message);
        }
      }
      let text = parsed.text || simulateReply(persona, userMessage.text);
      text = await this.varyReply(text, persona, messages, conversation);
      const attachments = attachmentsFromMeta(parsed.meta);
      if (!attachments.some((item) => item.kind === 'sticker')) {
        const picked = await this.autoSticker(text, parsed.meta.mood, conversation.scene);
        if (picked) attachments.push(picked);
      }
      // 图片动作
      const imageAction = parsed.meta.actions?.find((a) => a.type === 'image');
      if (imageAction?.prompt && settings.plugins.minimax?.enabled !== false && this.deps.hub.has('minimax')) {
        const senderId = userMessage.senderId || conversation.peerId;
        const denial = await this.deps.chatTools.check('image', senderId, role, settings.chatTools);
        if (denial) {
          text += '\n（画图这次先欠着：' + denial + '）';
        } else {
          this.deps.observability.phase('MiniMax 生成配图', 0.8, { node: 'media', detail: imageAction.prompt.slice(0, 80), conversationId: conversation.id });
          const job = await this.deps.hub.generateImage(imageAction.prompt, settings.media.imageAspectRatio, persona);
          if (job.status === 'done' && job.result?.urls?.length) {
            attachments.unshift({ kind: 'image', url: job.result.urls[0], name: '鲸鲸画的图' });
            await this.deps.chatTools.consume('image', senderId);
          }
        }
      }
      // 视频动作（由模型自主识别“拍个视频/生成一段视频”）
      const videoAction = parsed.meta.actions?.find((a) => a.type === 'video');
      if (videoAction?.prompt && settings.plugins.minimax?.enabled !== false && this.deps.hub.has('minimax')) {
        const senderId = userMessage.senderId || conversation.peerId;
        const denial = await this.deps.chatTools.check('video', senderId, role, settings.chatTools);
        if (denial) text += '（视频这次先欠着：' + denial + '）';
        else {
          const job = await this.deps.hub.generateVideo(videoAction.prompt, settings.models.minimaxVideoDuration, settings.models.minimaxVideoResolution, persona);
          if (job.status === 'done' && job.result?.urls?.length) {
            attachments.unshift({ kind: 'video', url: job.result.urls[0], name: '鲸鲸拍的视频' });
            await this.deps.chatTools.consume('video', senderId);
          }
        }
      }
      // 唱歌动作（由模型自主识别“唱首歌/来一段”）
      const musicAction = parsed.meta.actions?.find((a) => a.type === 'music');
      if (musicAction?.query && settings.plugins.suno?.enabled !== false && this.deps.hub.has('suno')) {
        const senderId = userMessage.senderId || conversation.peerId;
        const denial = await this.deps.chatTools.check('music', senderId, role, settings.chatTools);
        if (denial) text += '（唱歌这次先欠着：' + denial + '）';
        else {
          const gender = personaVocalGender(persona);
          const job = await this.deps.hub.generateMusic({ prompt: musicAction.query + '，' + (gender === 'm' ? '男声' : '女声') + '演唱，旋律好听', title: musicAction.query.slice(0, 24), instrumental: false, style: (gender === 'm' ? '男声' : '女声') + '主唱，中文流行', vocalGender: gender });
          if (job.status === 'done' && job.result?.audioUrl) {
            attachments.unshift({ kind: 'music', url: job.result.audioUrl, name: job.result.title || '鲸鲸唱的歌' });
            await this.deps.chatTools.consume('music', senderId);
          }
        }
      }
      // 语音：显式要求或随机。语音成功后不再重复发送同一段文字。
      const wantVoice = settings.tts.enabled && settings.plugins.breezeblue?.enabled !== false && (parsed.meta.voice === true || Math.random() < settings.tts.voiceReplyChance);
      let outgoingText = text;
      if (wantVoice && text.length <= settings.tts.maxChars * 2) {
        this.deps.observability.phase('BreezeBlue 合成语音', 0.84, { node: 'tts', detail: '把回复变成她的声音', conversationId: conversation.id });
        const tts = await this.deps.hub.synthesize(text, persona);
        if (tts.ok && tts.url) {
          attachments.push({ kind: 'voice', url: tts.url, localPath: tts.filePath, name: '鲸鲸的语音', durationMs: Math.min(60_000, text.length * 220) });
          outgoingText = '';
        }
      }
      this.rememberReply(persona.id, text);
      const reply = await this.deps.store.append(conversation.id, {
        role: 'assistant', text: outgoingText, senderName: persona.name, scene: conversation.scene, attachments,
        meta: { personaId: persona.id, mood: parsed.meta.mood || '温柔', source: 'local', model: result.model, tokens: result.usage?.totalTokens, reasoning: settings.deepseek.useReasoningForChat ? result.reasoning.slice(0, 500) : undefined },
      });
      await this.applyEmotion(persona, {
        mood: parsed.meta.mood,
        valenceDelta: parsed.meta.valenceDelta ?? (POSITIVE.test(userMessage.text) ? 0.03 : NEGATIVE.test(userMessage.text) ? -0.02 : 0.008),
        energyDelta: parsed.meta.energyDelta ?? -0.008,
        affectionDelta: parsed.meta.affectionDelta ?? 0.003,
        patienceDelta: parsed.meta.patienceDelta,
        reason: `和${speaker.nickname}聊天：${userMessage.text.slice(0, 40)}`,
      });
      await this.deps.growth.addXp(persona.id, settings.persona.growthIntensity === 'fast' ? 8 : 4, '消息互动');
      // 异步抽取长期记忆，不阻塞回复
      void this.deps.memory.remember({
        docId: built.context.primaryDocId,
        messages: [{ role: 'user', text: userMessage.text, name: speaker.nickname }, { role: 'assistant', text: text, name: persona.name }],
        scene: conversation.scene, nickname: speaker.nickname, groupName: conversation.groupName,
      }).then(async (extraction) => {
        this.deps.observability.recordNeural({ type: 'memory', node: 'storage', target: 'memories', label: '长期记忆抽取完成', detail: extraction.extraction.facts.length + ' 条事实 / ' + (extraction.extraction.episode ? '1 段经历' : '无新经历'), conversationId: conversation.id });
        // 群聊：同一次抽取结果同步写入「当前发言人」的独立成员记忆，保证每个人都有自己的档案。
        if (conversation.scene === 'group' && built.docs.memberDoc && built.docs.memberDoc.id !== built.context.primaryDocId && extraction.extraction) {
          try { await this.deps.memory.extractor.apply(built.docs.memberDoc.id, extraction.extraction); }
          catch (error) { this.deps.logger.warn('memory', '群成员记忆写入失败:', (error as Error).message); }
        }
        if (extraction.extraction.emotion) {
          const emo = extraction.extraction.emotion;
          await this.deps.emotion.apply(persona.id, { mood: emo.mood, valence: emo.valence - this.deps.emotion.get(persona.id).valence, arousal: emo.arousal - this.deps.emotion.get(persona.id).arousal, reason: emo.reason }, 'memory');
        }
        this.deps.events.emit('memory:update', await this.deps.memory.getSummary());
      }).catch((error) => this.deps.logger.warn('memory', '记忆抽取失败:', (error as Error).message));
      this.deps.observability.recordNeural({ type: 'reply', node: 'core', target: conversation.scene === 'group' ? 'qq' : 'user', label: '回复已生成', detail: reply.text.slice(0, 160), tokens: result.usage?.totalTokens, conversationId: conversation.id });
      void this.deps.consciousness.observeExchange({
        personaId: persona.id, conversationId: conversation.id, userName: speaker.nickname, userId: speaker.userId,
        scene: conversation.scene, groupId: conversation.groupId, userText: userMessage.text, assistantText: text,
      }).then((observe) => {
        this.deps.observability.recordNeural({ type: 'memory', node: 'flow', target: 'core', label: '心光 / 心流更新', detail: observe.changes.join('；'), conversationId: conversation.id });
      }).catch((error) => this.deps.logger.warn('consciousness', '意识结构更新失败:', (error as Error).message));
      this.deps.observability.phase('写入记忆与情绪', 0.94, { node: 'storage', detail: '归档、抽取记忆、更新关系与成长', conversationId: conversation.id });
      const updated = this.deps.store.get(conversation.id)!;
      this.deps.events.emit('chat:message', { message: reply, conversation: updated });
      return {
        userMessage, reply, conversation: updated,
        context: { estimatedTokens: built.context.estimatedTokens, maxTokens: settings.context.maxContextTokens, compacted: built.context.compacted, memoryHits: built.context.memoryHits, rawMessages: this.deps.store.getMessages(conversation.id).length, summaryVersion: built.context.summaryVersion },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.observability.failTurn(message);
      this.deps.logger.error('chat', '生成回复失败:', message);
      if (!hasKey) {
        // 理论上走不到这里
        const fallback = await this.deps.store.append(conversation.id, { role: 'assistant', text: simulateReply(persona, userMessage.text), senderName: persona.name, scene: conversation.scene, meta: { personaId: persona.id, source: 'local' } });
        return { userMessage, reply: fallback, conversation: this.deps.store.get(conversation.id)!, error: message };
      }
      const reply = await this.deps.store.append(conversation.id, {
        role: 'assistant', text: '唔……刚才和深海那边的连接晃了一下，没听清。你再说一遍好不好？', senderName: persona.name, scene: conversation.scene,
        meta: { personaId: persona.id, source: 'local', error: message, mood: '困惑' },
      });
      this.deps.events.emit('chat:message', { message: reply, conversation: this.deps.store.get(conversation.id)! });
      return { userMessage, reply, conversation: this.deps.store.get(conversation.id)!, error: message };
    } finally {
      this.busy.delete(conversation.id);
      this.deps.observability.endTurn(conversation.id);
      this.deps.logger.info('chat', '回复耗时', Date.now() - startedAt, 'ms');
    }
  }

  private async applyEmotion(persona: Persona, delta: { mood?: string; valenceDelta?: number; energyDelta?: number; affectionDelta?: number; patienceDelta?: number; reason?: string }): Promise<void> {
    try {
      const current = this.deps.emotion.get(persona.id);
      await this.deps.emotion.apply(persona.id, {
        mood: delta.mood,
        valence: current.valence + (delta.valenceDelta ?? 0),
        energy: current.energy + (delta.energyDelta ?? 0),
        affection: current.affection + (delta.affectionDelta ?? 0),
        patience: current.patience + (delta.patienceDelta ?? 0),
        reason: delta.reason,
      }, 'chat');
    } catch (error) { this.deps.logger.warn('emotion', '更新情绪失败:', (error as Error).message); }
  }

  async generateInPersona(instruction: string, options: { json?: boolean; maxTokens?: number; temperature?: number } = {}): Promise<string> {
    if (!this.deps.settings.hasSecret('deepseek')) return '';
    this.deps.observability.beginTurn(undefined, '自主思考');
    this.deps.observability.phase('自主意识活动', 0.2, { node: 'core', detail: instruction.slice(0, 120) });
    const persona = this.deps.personas.active();
    const settings = this.deps.settings.get();
    const system = buildPersonaSystemPrompt({
      persona, scene: 'local', emotion: this.deps.emotion.get(persona.id), growth: this.deps.growth.get(persona.id),
      now: new Date(), replyLength: settings.persona.replyLength,
      extraInstructions: instruction + (options.json ? '\n只输出合法 JSON，不要代码块。' : ''),
    });
    try {
      const result = await this.deps.hub.clients.deepseek.chat([{ role: 'system', content: system }, { role: 'user', content: instruction }], {
        model: settings.models.deepseekChat, temperature: options.temperature ?? 0.9, maxTokens: options.maxTokens ?? 900,
        jsonMode: options.json ?? false, timeoutMs: settings.deepseek.timeoutMs,
      });
      this.deps.observability.endTurn();
      return result.content;
    } catch (error) {
      this.deps.observability.failTurn((error as Error).message);
      throw error;
    }
  }

  async proactive(conversation: Conversation, hint?: string): Promise<ChatMessage | null> {
    const persona = this.deps.personas.get(conversation.personaId) ?? this.deps.personas.active();
    const settings = this.deps.settings.get();
    let text = '';
    try {
      if (this.deps.settings.hasSecret('deepseek')) {
        const docs = await this.deps.memory.ensureConversationMemory({ userId: conversation.peerId, nickname: conversation.peerName, scene: 'private' });
        const relationship = docs.userDoc?.relationship;
        const system = buildPersonaSystemPrompt({
          persona, scene: 'private', userName: conversation.peerName, userRole: 'owner', relationship,
          emotion: this.deps.emotion.get(persona.id), growth: this.deps.growth.get(persona.id),
          memoryFacts: docs.userDoc?.facts.slice(0, 8).map((f) => f.text), now: new Date(),
          extraInstructions: '现在没有人跟你说话，你想主动找对方聊两句。语气自然，不要像客服。只输出要发的话，不要解释你为什么主动。',
        });
        const res = await this.deps.hub.clients.deepseek.chat([{ role: 'system', content: system }, { role: 'user', content: hint || '（你自己想找 TA 说点什么）' }], { model: settings.models.deepseekChat, temperature: 1.1, maxTokens: 200, timeoutMs: settings.deepseek.timeoutMs });
        text = parseReply(res.content).text;
      }
    } catch (error) { this.deps.logger.warn('chat', '主动消息生成失败，使用离线模板:', (error as Error).message); }
    if (!text) {
      const options = [
        `（尾巴从屏幕边缘冒出来）在忙吗？鲸鲸就是来看看你。`,
        `刚刚整理记忆的时候翻到你上次说的话，突然有点想问你：今天过得怎么样呀？`,
        `（轻轻戳了戳对话框）要不要休息一下？鲸鲸陪你待一会儿。`,
      ];
      text = options[Math.floor(Math.random() * options.length)];
    }
    const message = await this.deps.store.append(conversation.id, { role: 'assistant', text, senderName: persona.name, scene: 'private', meta: { personaId: persona.id, source: 'autonomy', mood: '想念' } });
    const updated = this.deps.store.get(conversation.id)!;
    this.deps.events.emit('chat:message', { message, conversation: updated });
    if (this.outbound?.available()) await this.outbound.sendProactive(updated, [{ text }]);
    await this.deps.growth.addXp(persona.id, 2, '主动关心');
    return message;
  }

  roleFor(userId: string): PermissionRole {
    const s = this.deps.settings.get();
    return resolveRole(userId, s.permissions);
  }
}
