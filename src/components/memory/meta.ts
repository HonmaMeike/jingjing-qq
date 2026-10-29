import type { MemoryDoc, MemoryFact, MemorySummary } from '@shared/types';

export type FactCategory = MemoryFact['category'];
export type BadgeTone = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'pink' | 'mint';

/** 事实分类的展示顺序：越靠前越稳定、越不容易被遗忘。 */
export const FACT_CATEGORY_ORDER: FactCategory[] = ['identity', 'preference', 'boundary', 'event', 'promise', 'emotion', 'other'];

export const FACT_CATEGORY_META: Record<FactCategory, { label: string; tone: BadgeTone; color: string; hint: string }> = {
  identity: { label: '身份', tone: 'brand', color: 'var(--brand-2)', hint: '关于 TA 是谁的稳定信息' },
  preference: { label: '偏好', tone: 'mint', color: 'var(--mint)', hint: '喜欢什么、讨厌什么' },
  boundary: { label: '雷区', tone: 'danger', color: 'var(--danger)', hint: '不能碰的话题与底线' },
  event: { label: '事件', tone: 'default', color: 'var(--brand-3)', hint: '一起经历过的事' },
  promise: { label: '承诺', tone: 'warning', color: 'var(--amber)', hint: '说好要记得的约定' },
  emotion: { label: '情绪', tone: 'pink', color: 'var(--pink)', hint: '某次心情的来由' },
  other: { label: '其他', tone: 'default', color: 'var(--text-3)', hint: '还没来得及归类的小事' },
};

export interface ScopeMeta { label: string; tone: BadgeTone; hint: string }

/** 一份记忆文档在 UI 里的身份说明。 */
export function docScopeMeta(doc: MemoryDoc): ScopeMeta {
  if (doc.scope === 'global') {
    return { label: '全局自我', tone: 'pink', hint: '鲸鲸对自己的认知，会跨会话生效，但不包含任何联系人的私密内容。' };
  }
  if (doc.scope === 'persona') {
    return { label: '人设记忆', tone: 'brand', hint: '跟随这套人设演化的专属记忆。' };
  }
  if (doc.scope === 'group') {
    return { label: '群记忆', tone: 'mint', hint: `只属于群「${doc.displayName}」的公共记忆，不会被带进私聊或其他群。` };
  }
  if (doc.groupId) {
    return {
      label: '群内成员',
      tone: 'default',
      hint: `这份记忆只属于群「${doc.groupName ?? '未知群聊'}」里的 ${doc.displayName}，私聊时不会读到它。`,
    };
  }
  return { label: '私聊联系人', tone: 'success', hint: '独立成册，只在这位联系人的私聊里生效，绝不会串到别人那里。' };
}

export function scopeShortLabel(scope: string): string {
  switch (scope) {
    case 'user': return '联系人';
    case 'group': return '群记忆';
    case 'global': return '全局';
    case 'persona': return '人设';
    default: return scope;
  }
}

export function relationLevel(value: number): string {
  if (value >= 80) return '亲密';
  if (value >= 60) return '亲近';
  if (value >= 40) return '熟络';
  if (value >= 20) return '初识';
  return '陌生';
}

function timeValue(iso?: string): number {
  if (!iso) return 0;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

/** 默认打开哪份档案：置顶优先，其次最近活跃的私聊联系人，最后才是任意文档。 */
export function pickInitialDoc(summary: MemorySummary): string | null {
  const docs = summary.docs ?? [];
  if (!docs.length) return null;
  const pinned = docs.find((doc) => doc.pinned);
  if (pinned) return pinned.id;
  const byRecency = [...docs].sort((left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt));
  const privateDoc = byRecency.find((doc) => doc.scope === 'user' && !doc.groupId);
  return (privateDoc ?? byRecency[0])?.id ?? null;
}

export { timeValue };
