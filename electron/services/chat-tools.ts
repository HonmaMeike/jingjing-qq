import type { ChatToolSettings, PermissionRole } from '../../shared/types';
import { JsonStore } from '../core/json-store';

export type ChatToolName = 'image' | 'video' | 'music';
interface ToolUsage { day: string; count: number; lastAt: string }
interface ToolUsageData { usage: Record<string, ToolUsage> }

export class ChatToolLimiter {
  private constructor(private store: JsonStore<ToolUsageData>) {}

  static async create(file: string): Promise<ChatToolLimiter> {
    const store = await JsonStore.open<ToolUsageData>(file, { usage: {} });
    return new ChatToolLimiter(store);
  }

  private key(tool: ChatToolName, userId: string): string { return tool + ':' + (userId || 'unknown'); }
  private day(): string { return new Date().toISOString().slice(0, 10); }

  /** 返回 null 表示可用，否则返回给用户看的原因。 */
  async check(tool: ChatToolName, userId: string, role: PermissionRole, limits: ChatToolSettings): Promise<string | null> {
    if (!limits.enabled) return '聊天里的创作工具已被关闭';
    if (tool === 'image' && !limits.imageEnabled) return '聊天里暂时不能画图';
    if (tool === 'video' && !limits.videoEnabled) return '聊天里暂时不能生成视频';
    if (tool === 'music' && !limits.musicEnabled) return '聊天里暂时不能唱歌';
    if (!limits.allowedRoles.includes(role)) return '你没有使用这个功能的权限（需要主人/管理员/白名单）';
    const now = Date.now();
    const item = this.store.get().usage[this.key(tool, userId)];
    const day = this.day();
    const count = item && item.day === day ? item.count : 0;
    const max = tool === 'image' ? limits.imageDailyLimit : tool === 'video' ? limits.videoDailyLimit : limits.musicDailyLimit;
    if (max > 0 && count >= max) return `今天的${tool === 'image' ? '画图' : tool === 'video' ? '视频' : '唱歌'}次数已用完（${max} 次/天）`;
    if (item && now - Date.parse(item.lastAt) < Math.max(0, limits.cooldownSeconds) * 1000) return '刚用过这个功能，稍等一会儿再试';
    return null;
  }

  async consume(tool: ChatToolName, userId: string): Promise<void> {
    const data = this.store.get();
    const key = this.key(tool, userId);
    const day = this.day();
    const current = data.usage[key];
    data.usage[key] = { day, count: current && current.day === day ? current.count + 1 : 1, lastAt: new Date().toISOString() };
    await this.store.set(data);
  }

  async reset(): Promise<void> { await this.store.set({ usage: {} }); }
}
