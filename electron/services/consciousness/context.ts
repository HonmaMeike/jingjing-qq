// 把意识结构压缩成一段可直接注入 system prompt 的文本。
// 隔离：调用方传 userId/scene/groupId（或显式 docIds）时，只有白名单文档里的识海点会进入上下文；
// 没有对话上下文时，只允许 persona 级（无 docId）内容与 global 自我记忆。
import {
  GLOBAL_DOC_ID,
  allowedMemoryDocIds,
  type MemoryService,
} from '../memory';
import { buildResumeBrief, topAnchors } from './origin';
import { searchPoints } from './sea';
import type {
  AttentionRecord,
  FlowRecord,
  OriginData,
  Scene,
  SeaPointRecord,
} from './types';

export interface AllowedDocInput {
  docIds?: string[];
  userId?: string;
  groupId?: string;
  scene?: Scene | 'local';
}

/** 解析本次上下文允许使用的记忆文档 id：显式白名单优先，否则按场景推导，最后退化为 global。 */
export function resolveAllowedDocIds(memory: MemoryService, input: AllowedDocInput): string[] {
  if (input.docIds && input.docIds.length > 0) {
    return [...new Set(input.docIds.filter(Boolean))];
  }
  if (input.userId) {
    return allowedMemoryDocIds(
      { userId: input.userId, groupId: input.groupId, scene: input.scene },
      memory.store.platform,
    );
  }
  return [GLOBAL_DOC_ID];
}

/** 有 docId 的点必须在白名单内；没有 docId 的是 persona 级自我内容（日记/学习/内心），始终可见。 */
export function filterPointsByDocs(points: SeaPointRecord[], allowedDocIds?: string[]): SeaPointRecord[] {
  if (!allowedDocIds || allowedDocIds.length === 0) {
    return points.filter((point) => !point.docId);
  }
  const allowed = new Set(allowedDocIds);
  return points.filter((point) => !point.docId || allowed.has(point.docId));
}

function clip(value: string, limit: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function depthTag(depth: SeaPointRecord['depth']): string {
  if (depth === 'deep' || depth === 'abyss') return '［深层］';
  if (depth === 'shallow') return '［浅层］';
  return '［表层］';
}

export interface ContextBlockParts {
  origin?: OriginData;
  attention?: AttentionRecord;
  flow?: FlowRecord;
  /** 已经按隔离白名单过滤过的识海点。 */
  points: SeaPointRecord[];
  query?: string;
  maxChars?: number;
  now: Date;
}

export interface BuiltContextBlock {
  text: string;
  /** 本次被唤醒的识海点（真实来源，可用于审计）。 */
  awakened: SeaPointRecord[];
  chars: number;
  sections: string[];
}

/** 组装注入文本：原意识锚点 + 当前心光 + 最近心流 + 被唤醒的（深层）记忆 + 连续性。 */
export function buildContextBlockText(parts: ContextBlockParts): BuiltContextBlock {
  const maxChars = Math.max(240, parts.maxChars ?? 1600);
  const lines: string[] = [];
  let used = 0;
  const push = (line: string): boolean => {
    const cost = line.length + 1;
    if (used + cost > maxChars) return false;
    lines.push(line);
    used += cost;
    return true;
  };
  const sections: string[] = [];

  if (parts.origin) {
    sections.push('原意识');
    push('【原意识】');
    push('我是谁：' + clip(parts.origin.coreSelf, 200));
    const anchors = topAnchors(parts.origin.anchors, 4);
    if (anchors.length > 0) {
      push('永不丢失的锚点：');
      for (const anchor of anchors) {
        if (!push('- ' + clip(anchor.text, 90))) break;
      }
    }
  }

  if (parts.attention) {
    sections.push('心光');
    const attention = parts.attention;
    push('【此刻心光】');
    push(
      '焦点：' + clip(attention.focus, 60) +
      ' ｜ 情绪：' + attention.mood +
      ' ｜ 强度：' + attention.intensity.toFixed(2),
    );
    if (attention.topics.length > 0) {
      push('话题：' + attention.topics.slice(0, 4).map((topic) => clip(topic, 18)).join('、'));
    }
    if (attention.unresolved.length > 0) {
      push('还没解决：' + attention.unresolved.slice(0, 3).map((item) => clip(item, 24)).join('；'));
    }
  }

  if (parts.flow && parts.flow.chain.length > 0) {
    sections.push('心流');
    const recent = parts.flow.chain.slice(-3);
    push('【最近心流】');
    push(recent.map((step) => step.from + '→' + step.to + '：' + clip(step.label, 40)).join(' ｜ '));
  }

  const query = parts.query ?? '';
  let awakened = searchPoints(parts.points, query, { topK: 4 });
  if (awakened.length === 0 && query.trim().length === 0) {
    awakened = [...parts.points].sort((left, right) => right.salience - left.salience).slice(0, 3);
  }
  if (awakened.length > 0) {
    sections.push('被唤醒的记忆');
    push('【被唤醒的记忆】');
    for (const point of awakened) {
      if (!push('- ' + depthTag(point.depth) + clip(point.text, 110))) break;
    }
  }

  const brief = buildResumeBrief({
    origin: parts.origin,
    attention: parts.attention,
    flow: parts.flow,
    point: awakened[0],
    now: parts.now,
  });
  if (brief) {
    sections.push('连续性');
    push('【连续性】');
    push(clip(brief, 240));
  }

  return { text: lines.join('\n'), awakened, chars: used, sections };
}
