import type { ActivityItem, ActivityType } from '@shared/types';

export const ACTIVITY_META: Record<ActivityType, { label: string; color: string; hint: string }> = {
  proactive: { label: '主动消息', color: 'var(--brand-2)', hint: '她先开口的一次搭话' },
  diary: { label: '日记', color: 'var(--pink)', hint: '睡前写给自己看的心情记录' },
  qzone: { label: '空间动态', color: 'var(--brand-3)', hint: '发在 QQ 空间里的说说' },
  bilibili: { label: 'B站发现', color: 'var(--mint)', hint: '自己在 B 站逛到的东西' },
  learning: { label: '学习笔记', color: 'var(--amber)', hint: '主动查资料学到的新东西' },
  reflection: { label: '自我反思', color: 'var(--brand)', hint: '对自己最近表现的复盘' },
  growth: { label: '成长事件', color: 'var(--mint)', hint: '阶段性的变化与进化' },
  system: { label: '系统', color: 'var(--text-3)', hint: '自主生活引擎记录' },
  chat: { label: '聊天', color: 'var(--brand-2)', hint: '对话中发生的事' },
};

export const ACTIVITY_STATUS: Record<ActivityItem['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'default' }> = {
  pending: { label: '进行中', tone: 'warning' },
  done: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  skipped: { label: '已跳过', tone: 'default' },
};

export const TRIGGER_ACTIONS: { kind: ActivityType; label: string; hint: string }[] = [
  { kind: 'proactive', label: '主动找我', hint: '让她主动发来一条消息' },
  { kind: 'reflection', label: '反思一下', hint: '回看最近的对话并写一段自省' },
  { kind: 'qzone', label: '发条说说', hint: '生成一条 QQ 空间动态' },
  { kind: 'bilibili', label: '刷会儿B站', hint: '去 B 站逛一圈，带回新发现' },
  { kind: 'learning', label: '学点东西', hint: '围绕兴趣查资料并做笔记' },
  { kind: 'diary', label: '写篇日记', hint: '记录今天的心情和经历' },
];

export function qzoneVisibilityLabel(value: number): string {
  if (value === 1) return '公开';
  if (value === 4) return '好友可见';
  if (value === 64) return '仅自己';
  return '自定义';
}

/** 0..1 的比例转成 0..100 的仪表值。 */
export function percentOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

export function stripMarkdown(text: string, limit = 90): string {
  const plain = text
    .replace(/[#>*`_~-]/g, ' ')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
}

/** 把 overview 里新出现的条目合并到本地列表前面（用于接收自主生活事件）。 */
export function mergeNew<T extends { id: string }>(incoming: T[], current: T[]): T[] {
  if (!incoming.length) return current;
  const existing = new Set(current.map((item) => item.id));
  const fresh = incoming.filter((item) => !existing.has(item.id));
  return fresh.length ? [...fresh, ...current] : current;
}

export function sortByTimeDesc<T extends { createdAt?: string; date?: string }>(items: T[]): T[] {
  const value = (item: T) => {
    const raw = item.createdAt || item.date || '';
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? 0 : time;
  };
  return [...items].sort((left, right) => value(right) - value(left));
}
