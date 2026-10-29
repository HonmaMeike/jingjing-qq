import fs from 'node:fs/promises';
import type { ChatMessage, ChatAttachment, Conversation, Scene } from '../../shared/types';
import { JsonStore } from '../core/json-store';
import { nowIso, uid } from '../core/utils';
import type { EventBus } from '../core/event-bus';

interface ConversationData {
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
}

export class ConversationStore {
  private constructor(private store: JsonStore<ConversationData>) {}

  static async create(file: string): Promise<ConversationStore> {
    const store = await JsonStore.open<ConversationData>(file, { conversations: [], messages: {} });
    return new ConversationStore(store);
  }

  list(): Conversation[] {
    return this.store.get().conversations.slice().sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });
  }

  get(id: string): Conversation | undefined { return this.store.get().conversations.find((c) => c.id === id); }

  getMessages(id: string, limit = 200): ChatMessage[] {
    const all = this.store.get().messages[id] ?? [];
    return limit > 0 ? all.slice(-limit) : all;
  }

  async create(input: { peerId: string; peerName: string; scene?: Scene; groupId?: string; groupName?: string; peerAvatar?: string; personaId: string; demo?: boolean }): Promise<Conversation> {
    const data = this.store.get();
    const scene: Scene = input.scene ?? 'private';
    const id = scene === 'group' ? `group_${input.groupId ?? input.peerId}` : `private_${input.peerId}`;
    const existing = data.conversations.find((c) => c.id === id);
    if (existing) return existing;
    const conversation: Conversation = {
      id,
      scene,
      peerId: input.peerId,
      peerName: input.peerName,
      peerAvatar: input.peerAvatar,
      groupId: input.groupId,
      groupName: input.groupName,
      lastMessage: '',
      lastMessageAt: nowIso(),
      unread: 0,
      messageCount: 0,
      personaId: input.personaId,
      isDemo: input.demo,
    };
    data.conversations.push(conversation);
    data.messages[id] = [];
    await this.store.set(data);
    return conversation;
  }

  async append(conversationId: string, message: Omit<ChatMessage, 'id' | 'createdAt' | 'conversationId'> & { id?: string; createdAt?: string }): Promise<ChatMessage> {
    const data = this.store.get();
    const conv = data.conversations.find((c) => c.id === conversationId);
    if (!conv) throw new Error('会话不存在');
    const full: ChatMessage = {
      ...message,
      id: message.id ?? uid('msg-'),
      createdAt: message.createdAt ?? nowIso(),
      conversationId,
    };
    const list = data.messages[conversationId] ?? [];
    list.push(full);
    if (list.length > 3000) list.splice(0, list.length - 3000);
    data.messages[conversationId] = list;
    conv.messageCount = list.length;
    conv.lastMessage = full.text.slice(0, 160) || (full.attachments?.length ? '[媒体]' : '');
    conv.lastMessageAt = full.createdAt;
    if (message.role === 'assistant') conv.unread = 0;
    await this.store.set(data);
    return full;
  }

  async updateConversation(id: string, patch: Partial<Conversation>): Promise<Conversation> {
    const data = this.store.get();
    const idx = data.conversations.findIndex((c) => c.id === id);
    if (idx < 0) throw new Error('会话不存在');
    data.conversations[idx] = { ...data.conversations[idx], ...patch };
    await this.store.set(data);
    return data.conversations[idx];
  }

  async markRead(id: string): Promise<void> {
    const data = this.store.get();
    const conv = data.conversations.find((c) => c.id === id);
    if (conv) conv.unread = 0;
    await this.store.set(data);
  }

  async clear(id: string): Promise<void> {
    const data = this.store.get();
    data.messages[id] = [];
    const conv = data.conversations.find((c) => c.id === id);
    if (conv) { conv.lastMessage = ''; conv.messageCount = 0; conv.unread = 0; }
    await this.store.set(data);
  }

  async remove(id: string): Promise<void> {
    const data = this.store.get();
    data.conversations = data.conversations.filter((c) => c.id !== id);
    delete data.messages[id];
    await this.store.set(data);
  }

  async bulkImport(conversations: Conversation[], messages: Record<string, ChatMessage[]>): Promise<void> {
    const data = this.store.get();
    for (const conv of conversations) {
      if (!data.conversations.find((c) => c.id === conv.id)) data.conversations.push(conv);
      if (!data.messages[conv.id]?.length) data.messages[conv.id] = messages[conv.id] ?? [];
    }
    await this.store.set(data);
  }

  async removeDemo(): Promise<number> {
    const data = this.store.get();
    const demoIds = data.conversations.filter((c) => c.isDemo).map((c) => c.id);
    data.conversations = data.conversations.filter((c) => !c.isDemo);
    for (const id of demoIds) delete data.messages[id];
    await this.store.set(data);
    return demoIds.length;
  }

  stats(): { totalMessages: number; todayMessages: number; todayTokens: number } {
    const data = this.store.get();
    let total = 0; let today = 0; let todayTokens = 0;
    const day = new Date().toISOString().slice(0, 10);
    for (const list of Object.values(data.messages)) {
      total += list.length;
      for (const m of list) {
        if (m.createdAt.slice(0, 10) !== day) continue;
        today += 1;
        todayTokens += m.meta?.tokens ?? 0;
      }
    }
    return { totalMessages: total, todayMessages: today, todayTokens };
  }

  allMessages(): ChatMessage[] {
    return Object.values(this.store.get().messages).flat();
  }
}
