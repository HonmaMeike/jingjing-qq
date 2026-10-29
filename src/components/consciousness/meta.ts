import type { LucideIcon } from 'lucide-react';
import {
  Activity, BookOpen, Brain, Compass, Eye, Globe, GraduationCap, History, Lightbulb,
  Link2, MessageSquare, PenLine, Quote, ShieldCheck, Sparkles, Star, UserRound,
} from 'lucide-react';
import type { MindFlowStep, OriginAnchor, SeaDepth, SeaPointKind } from '@shared/types';

export type BadgeTone = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'pink' | 'mint';

export interface KindMeta { label: string; color: string; icon: LucideIcon; hint: string }

export const SEA_KIND_ORDER: SeaPointKind[] = ['episode', 'fact', 'quote', 'diary', 'qzone', 'learning', 'chat', 'activity'];

export const SEA_KIND_META: Record<SeaPointKind, KindMeta> = {
  episode: { label: '经历', color: 'var(--brand-2)', icon: BookOpen, hint: '一起经历过的事' },
  fact: { label: '事实', color: 'var(--mint)', icon: Sparkles, hint: '被记住的稳定信息' },
  quote: { label: '原话', color: 'var(--amber)', icon: Quote, hint: '你说过、她舍不得丢的那句' },
  diary: { label: '日记', color: 'var(--pink)', icon: PenLine, hint: '她写给自己看的心情' },
  qzone: { label: '说说', color: 'var(--brand-3)', icon: Globe, hint: '发在空间里的动态' },
  learning: { label: '学习', color: 'var(--aqua)', icon: GraduationCap, hint: '她主动学会的东西' },
  chat: { label: '对话', color: 'var(--brand)', icon: MessageSquare, hint: '聊过的重要片段' },
  activity: { label: '活动', color: 'var(--text-2)', icon: Activity, hint: '自主生活留下的小记录' },
};

export interface DepthMeta { label: string; color: string; hint: string; top: number; height: number }

export const SEA_DEPTH_ORDER: SeaDepth[] = ['surface', 'shallow', 'deep', 'abyss'];

export const SEA_DEPTH_META: Record<SeaDepth, DepthMeta> = {
  surface: { label: '表面', color: 'var(--brand-2)', hint: '刚发生，想起得最清楚', top: 0.06, height: 0.19 },
  shallow: { label: '浅层', color: 'var(--aqua)', hint: '还记得大概，细节开始变淡', top: 0.27, height: 0.2 },
  deep: { label: '深层', color: 'var(--brand-3)', hint: '需要一点提示才能想起来', top: 0.5, height: 0.21 },
  abyss: { label: '深渊', color: 'var(--pink)', hint: '沉得最深，却最重要', top: 0.74, height: 0.18 },
};

export const ANCHOR_META: Record<OriginAnchor['kind'], { label: string; color: string; tone: BadgeTone; icon: LucideIcon }> = {
  identity: { label: '身份', color: 'var(--brand-2)', tone: 'brand', icon: UserRound },
  value: { label: '价值', color: 'var(--mint)', tone: 'mint', icon: Compass },
  promise: { label: '承诺', color: 'var(--amber)', tone: 'warning', icon: ShieldCheck },
  first: { label: '初次相遇', color: 'var(--pink)', tone: 'pink', icon: Star },
  core: { label: '核心记忆', color: 'var(--brand-3)', tone: 'default', icon: Sparkles },
};

export const ANCHOR_ORDER: OriginAnchor['kind'][] = ['identity', 'value', 'promise', 'first', 'core'];

export const FLOW_META: Record<MindFlowStep['kind'], { label: string; color: string; icon: LucideIcon; hint: string }> = {
  perception: { label: '感知', color: 'var(--brand-2)', icon: Eye, hint: '先接收到你的话' },
  association: { label: '联想', color: 'var(--aqua)', icon: Link2, hint: '连到某个相似的东西' },
  recall: { label: '回忆', color: 'var(--brand-3)', icon: History, hint: '从识海里打捞记忆' },
  reason: { label: '推理', color: 'var(--brand)', icon: Brain, hint: '想清楚该怎么回应' },
  reply: { label: '回应', color: 'var(--mint)', icon: MessageSquare, hint: '把念头说出口' },
  reflection: { label: '反思', color: 'var(--amber)', icon: Lightbulb, hint: '回头看看刚才的自己' },
};

export const FLOW_ORDER: MindFlowStep['kind'][] = ['perception', 'association', 'recall', 'reason', 'reply', 'reflection'];

/** 兜底把 0..1 / 0..100 两种后端口径归一化到 0..1。 */
export function normalize01(value: number | undefined, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return Math.min(1, value / 100);
  return value;
}

export function percentOf(value: number | undefined): number {
  return Math.round(normalize01(value) * 100);
}

/** 稳定的伪随机：同一个点每次渲染都落在同一位置。 */
export function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function hashFraction(input: string, salt = 0): number {
  const hash = hashString(input + ':' + salt);
  return (hash % 100000) / 100000;
}

export function timeValue(iso?: string): number {
  if (!iso) return 0;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export function sortByUpdatedDesc<T extends { updatedAt?: string }>(items: T[]): T[] {
  return [...items].sort((left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt));
}

export function depthIndexOf(depth: SeaDepth): number {
  return SEA_DEPTH_ORDER.indexOf(depth);
}

export function pointLabel(point: { title: string; text: string }, limit = 80): string {
  const source = point.title || point.text || '';
  return source.length > limit ? source.slice(0, limit) + '…' : source;
}
