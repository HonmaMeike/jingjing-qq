import type { ChatAttachment, ChatMessage, Conversation } from '@shared/types';
import { assetUrl, normalizeAssetUrl } from '@/lib/assets';
import { formatTime } from '@/lib/format';

export type ConversationFilter = 'all' | 'private' | 'group';

const MEDIA_RE = /^(https?:|data:|blob:|pet:|file:)/i;
const FILE_EXT_RE = /\.(png|jpe?g|webp|gif|webm|mp4|mp3|wav|ogg|m4a)$/i;

export function isMediaSource(value?: string): boolean {
  if (!value) return false;
  return MEDIA_RE.test(value) || FILE_EXT_RE.test(value);
}

export function resolveAttachmentSrc(attachment: ChatAttachment): string {
  if (attachment.url) return normalizeAssetUrl(attachment.url);
  const raw = attachment.localPath;
  if (!raw) return '';
  if (MEDIA_RE.test(raw)) return raw;
  if (/^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('\\\\')) {
    return 'file:///' + raw.replace(/\\/g, '/').replace(/ /g, '%20');
  }
  return normalizeAssetUrl(assetUrl(raw));
}

export function attachmentLabel(attachment: ChatAttachment): string {
  switch (attachment.kind) {
    case 'image': return attachment.name || '图片';
    case 'voice': return attachment.name || '语音';
    case 'video': return attachment.name || '视频';
    case 'music': return attachment.name || '音乐';
    case 'sticker': return attachment.name || '梗图';
    case 'file': return attachment.name || '文件';
    default: return attachment.name || '附件';
  }
}

export function formatVoiceDuration(ms?: number): string {
  const total = Math.max(1, Math.round((ms ?? 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? m + ':' + String(s).padStart(2, '0') : s + '"';
}

export function conversationTitle(conversation: Conversation): string {
  return conversation.groupName || conversation.peerName || (conversation.scene === 'group' ? '未命名群聊' : '未命名会话');
}

function startOfDay(input: Date): Date {
  const d = new Date(input);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function conversationTimestamp(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffDays = Math.round((startOfDay(new Date()).getTime() - startOfDay(d).getTime()) / 86400000);
  if (diffDays === 0) return formatTime(iso);
  if (diffDays === 1) return '昨天';
  if (diffDays > 1 && diffDays < 7) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  return (d.getMonth() + 1) + '/' + d.getDate();
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toDateString();
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '未知日期';
  const diffDays = Math.round((startOfDay(new Date()).getTime() - startOfDay(d).getTime()) / 86400000);
  const md = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' });
  if (diffDays === 0) return '今天 · ' + md;
  if (diffDays === 1) return '昨天 · ' + md;
  if (diffDays > 1 && diffDays < 7) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()] + ' · ' + md;
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function groupMessagesByDay(messages: ChatMessage[]): { key: string; label: string; items: ChatMessage[] }[] {
  const groups: { key: string; label: string; items: ChatMessage[] }[] = [];
  for (const message of messages) {
    const key = dayKey(message.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(message);
    else groups.push({ key, label: dayLabel(message.createdAt), items: [message] });
  }
  return groups;
}

export function normalizeMetric(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export const MEMORY_CATEGORY_LABEL: Record<string, string> = {
  identity: '身份',
  preference: '偏好',
  event: '事件',
  promise: '约定',
  emotion: '情绪',
  boundary: '边界',
  other: '其他',
};
