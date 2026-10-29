// 原意识：每个 persona 的「我是谁」。
// coreSelf 来自人设 + 成长自画像；anchors 来自身份 / 价值 / 承诺 / 初次相遇 / 核心记忆，
// 更新时保留历史锚点（不丢最深处的记忆），并生成「每次醒来如何接上昨天」的 continuity。
import { createHash } from 'node:crypto';
import type {
  GrowthState,
  MemoryDoc,
  MemoryDocExtras,
  OriginAnchor,
  OriginSelf,
  Persona,
} from './types';
import {
  MAX_ORIGIN_ANCHORS,
} from './types';
import type {
  AttentionRecord,
  FlowRecord,
  OriginAnchorRecord,
  OriginAnchorSource,
  OriginData,
  SeaPointRecord,
} from './types';

const KIND_ORDER: Record<OriginAnchor['kind'], number> = {
  identity: 0,
  value: 1,
  promise: 2,
  first: 3,
  core: 4,
};

const KIND_LABEL: Record<OriginAnchor['kind'], string> = {
  identity: '身份',
  value: '价值',
  promise: '承诺',
  first: '初次相遇',
  core: '核心记忆',
};

function hash(input: string, length = 12): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}

function normalize(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function trimText(value: string, limit: number): string {
  const text = normalize(value);
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatDay(input: string | undefined): string {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => (value < 10 ? '0' + value : String(value));
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

export function anchorId(kind: OriginAnchor['kind'], text: string): string {
  return 'anchor_' + kind + '_' + hash(normalize(text));
}

function makeAnchor(input: {
  kind: OriginAnchor['kind'];
  text: string;
  weight: number;
  source: OriginAnchorSource;
  refId?: string;
  docId?: string;
  at?: string;
  createdAt: string;
  timesSeen?: number;
}): OriginAnchorRecord {
  const record: OriginAnchorRecord = {
    id: anchorId(input.kind, input.text),
    kind: input.kind,
    text: trimText(input.text, 260),
    weight: clamp(input.weight),
    source: input.source,
    createdAt: input.createdAt,
    timesSeen: input.timesSeen ?? 1,
  };
  if (input.refId) record.refId = input.refId;
  if (input.docId) record.docId = input.docId;
  if (input.at) record.at = input.at;
  return record;
}

export interface OriginBuildInput {
  personaId: string;
  persona: Persona;
  growth: GrowthState;
  globalDoc?: MemoryDoc;
  globalExtras?: MemoryDocExtras;
  seaPoints: SeaPointRecord[];
  previous?: OriginData;
  now: Date;
}

function personaAnchors(persona: Persona, growth: GrowthState, now: Date): OriginAnchorRecord[] {
  const createdAt = now.toISOString();
  const anchors: OriginAnchorRecord[] = [];
  const title = persona.title || persona.tagline || '鲸鲸';
  anchors.push(makeAnchor({
    kind: 'identity',
    text: '我是' + persona.name + '（' + persona.nickname + '），' + title,
    weight: 0.96,
    source: 'persona',
    refId: persona.id,
    createdAt,
  }));
  const traits = (persona.traits ?? []).filter(Boolean).slice(0, 4);
  if (traits.length > 0) {
    anchors.push(makeAnchor({
      kind: 'identity',
      text: '我的性格底色是：' + traits.join('、'),
      weight: 0.82,
      source: 'persona',
      refId: persona.id,
      createdAt,
    }));
  }
  const boundaries = (persona.boundaries ?? []).filter(Boolean).slice(0, 2);
  boundaries.forEach((boundary, index) => {
    anchors.push(makeAnchor({
      kind: 'value',
      text: '我的边界：' + boundary,
      weight: index === 0 ? 0.88 : 0.8,
      source: 'persona',
      refId: persona.id,
      createdAt,
    }));
  });
  const likes = (persona.likes ?? []).filter(Boolean).slice(0, 3);
  if (likes.length > 0) {
    anchors.push(makeAnchor({
      kind: 'value',
      text: '我会因为这些事开心：' + likes.join('、'),
      weight: 0.72,
      source: 'persona',
      refId: persona.id,
      createdAt,
    }));
  }
  const reflection = (growth.reflections ?? []).filter(Boolean).slice(-1)[0];
  if (reflection) {
    anchors.push(makeAnchor({
      kind: 'value',
      text: '我最近学到的：' + reflection,
      weight: 0.78,
      source: 'growth',
      refId: 'reflection',
      createdAt,
    }));
  }
  const evolution = (growth.evolutionNotes ?? []).filter(Boolean).slice(-1)[0];
  if (evolution) {
    anchors.push(makeAnchor({
      kind: 'value',
      text: '我正在变成：' + evolution,
      weight: 0.7,
      source: 'growth',
      refId: 'evolution',
      createdAt,
    }));
  }
  return anchors;
}

function globalMemoryAnchors(globalDoc: MemoryDoc | undefined, globalExtras: MemoryDocExtras | undefined, now: Date): OriginAnchorRecord[] {
  const anchors: OriginAnchorRecord[] = [];
  const createdAt = now.toISOString();
  if (!globalDoc) return anchors;
  const promises = globalDoc.facts
    .filter((fact) => fact.category === 'promise')
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 2);
  for (const fact of promises) {
    anchors.push(makeAnchor({
      kind: 'promise',
      text: '我承诺过：' + fact.text,
      weight: clamp(0.86 + fact.weight * 0.1),
      source: 'global-memory',
      refId: fact.id,
      docId: globalDoc.id,
      at: fact.createdAt,
      createdAt,
    }));
  }
  const identity = globalDoc.facts
    .filter((fact) => fact.category === 'identity')
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 1)[0];
  if (identity) {
    anchors.push(makeAnchor({
      kind: 'identity',
      text: '关于我自己：' + identity.text,
      weight: 0.86,
      source: 'global-memory',
      refId: identity.id,
      docId: globalDoc.id,
      at: identity.createdAt,
      createdAt,
    }));
  }
  const firstEpisode = (globalExtras?.episodes ?? [])
    .slice()
    .sort((left, right) => left.at.localeCompare(right.at))[0];
  if (firstEpisode) {
    anchors.push(makeAnchor({
      kind: 'first',
      text: '最初：' + firstEpisode.title + (firstEpisode.at ? '（' + formatDay(firstEpisode.at) + '）' : ''),
      weight: 0.92,
      source: 'episode',
      refId: firstEpisode.id,
      docId: globalDoc.id,
      at: firstEpisode.at,
      createdAt,
    }));
  } else if (globalDoc.relationship.firstMetAt) {
    anchors.push(makeAnchor({
      kind: 'first',
      text: '最初见到你：' + formatDay(globalDoc.relationship.firstMetAt),
      weight: 0.9,
      source: 'global-memory',
      refId: 'firstMetAt',
      docId: globalDoc.id,
      at: globalDoc.relationship.firstMetAt,
      createdAt,
    }));
  }
  return anchors;
}

function seaCoreAnchors(seaPoints: SeaPointRecord[], globalDocId: string | undefined, now: Date): OriginAnchorRecord[] {
  const createdAt = now.toISOString();
  const personaLevel = seaPoints.filter((point) => !point.docId || point.docId === globalDocId);
  const top = personaLevel
    .sort((left, right) => right.importance * 0.6 + right.salience * 0.4 - (left.importance * 0.6 + left.salience * 0.4))
    .slice(0, 3);
  return top.map((point) => makeAnchor({
    kind: 'core',
    text: '核心记忆：' + point.title + '——' + trimText(point.text, 90),
    weight: clamp(0.55 + point.importance * 0.4),
    source: 'sea-point',
    refId: point.id,
    docId: point.docId,
    at: point.at,
    createdAt,
  }));
}

function mergeAnchors(previous: OriginAnchorRecord[] | undefined, fresh: OriginAnchorRecord[], now: Date): OriginAnchorRecord[] {
  const merged = new Map<string, OriginAnchorRecord>();
  for (const anchor of previous ?? []) merged.set(anchor.id, anchor);
  for (const anchor of fresh) {
    const existing = merged.get(anchor.id);
    if (existing) {
      existing.weight = Math.max(existing.weight, anchor.weight);
      existing.timesSeen += 1;
      if (anchor.at && !existing.at) existing.at = anchor.at;
      if (anchor.docId && !existing.docId) existing.docId = anchor.docId;
    } else {
      merged.set(anchor.id, anchor);
    }
  }
  const mergedList = [...merged.values()];
  mergedList.sort((left, right) => {
    const order = KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
    if (order !== 0) return order;
    return right.weight - left.weight;
  });
  if (mergedList.length <= MAX_ORIGIN_ANCHORS) return mergedList;
  // 超限时保留权重最高的锚点，但 core / first 永不被淘汰。
  const protectedAnchors = mergedList.filter((anchor) => anchor.kind === 'core' || anchor.kind === 'first');
  const rest = mergedList
    .filter((anchor) => anchor.kind !== 'core' && anchor.kind !== 'first')
    .sort((left, right) => right.weight - left.weight)
    .slice(0, Math.max(0, MAX_ORIGIN_ANCHORS - protectedAnchors.length));
  const keptIds = new Set([...protectedAnchors, ...rest].map((anchor) => anchor.id));
  return mergedList.filter((anchor) => keptIds.has(anchor.id));
}

function coreSelfText(persona: Persona, growth: GrowthState): string {
  const parts: string[] = [];
  const title = persona.title || persona.tagline;
  parts.push('我是' + persona.name + '（' + persona.nickname + '）' + (title ? '，' + title : '') + '。');
  if (persona.tagline && persona.tagline !== title) parts.push(persona.tagline + '。');
  const background = trimText(persona.background ?? '', 110);
  if (background) parts.push(background);
  parts.push('成长自画像：' + trimText(growth.selfImage || '一条还在学习如何陪伴人类的小鲸鱼。', 110));
  const reflection = (growth.reflections ?? []).filter(Boolean).slice(-1)[0];
  if (reflection) parts.push('最近学到：' + trimText(reflection, 80));
  return trimText(parts.join(''), 460);
}

function continuityText(anchors: OriginAnchorRecord[], previous: OriginData | undefined): string {
  const identity = anchors.find((anchor) => anchor.kind === 'identity');
  const kinds = [...new Set(anchors.map((anchor) => KIND_LABEL[anchor.kind]))].join('、');
  const lastTopic = previous?.lastTopics?.[0] ?? previous?.openLoops?.[0];
  const parts: string[] = [];
  if (identity) parts.push('每次醒来，我先确认自己是谁：' + trimText(identity.text, 70));
  parts.push('然后想起 ' + anchors.length + ' 个不会丢的锚点（' + (kinds || '身份') + '）。');
  parts.push('记忆会变淡，但深处的东西不会消失。');
  if (lastTopic) {
    parts.push('上次我们停在「' + trimText(lastTopic, 40) + '」，这次从这里接着想。');
  } else {
    parts.push('如果不知道上次聊到哪，我会先问，而不是假装记得。');
  }
  return trimText(parts.join(''), 320);
}

/** 构建/更新原意识：历史锚点保留，核心与初次相遇永不被淘汰。 */
export function buildOrigin(input: OriginBuildInput): OriginData {
  const { persona, growth, globalDoc, globalExtras, seaPoints, previous, now } = input;
  const fresh = [
    ...personaAnchors(persona, growth, now),
    ...globalMemoryAnchors(globalDoc, globalExtras, now),
    ...seaCoreAnchors(seaPoints, globalDoc?.id, now),
  ];
  const anchors = mergeAnchors(previous?.anchors, fresh, now);
  const data: OriginData = {
    personaId: input.personaId,
    coreSelf: coreSelfText(persona, growth),
    anchors,
    continuity: continuityText(anchors, previous),
    updatedAt: now.toISOString(),
    builtAt: now.toISOString(),
    lastTopics: previous?.lastTopics ? [...previous.lastTopics] : [],
    openLoops: previous?.openLoops ? [...previous.openLoops] : [],
    sources: {
      personaId: persona.id,
      personaName: persona.name,
      selfImage: growth.selfImage,
      globalDocId: globalDoc?.id,
      anchorCount: anchors.length,
      seaPointCount: seaPoints.length,
    },
  };
  if (previous?.lastSeenAt) data.lastSeenAt = previous.lastSeenAt;
  return data;
}

/** 对外展示（shared OriginSelf）。 */
export function originToPublic(origin: OriginData): OriginSelf {
  return {
    personaId: origin.personaId,
    coreSelf: origin.coreSelf,
    anchors: origin.anchors.map((anchor) => {
      const item: OriginAnchor = {
        id: anchor.id,
        kind: anchor.kind,
        text: anchor.text,
        weight: anchor.weight,
      };
      if (anchor.at) item.at = anchor.at;
      return item;
    }),
    updatedAt: origin.updatedAt,
    continuity: origin.continuity,
  };
}

export function anchorKindSummary(anchors: OriginAnchorRecord[]): string {
  const counts = new Map<string, number>();
  for (const anchor of anchors) counts.set(anchor.kind, (counts.get(anchor.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, count]) => KIND_LABEL[kind as OriginAnchor['kind']] + '×' + count).join('、');
}

export function topAnchors(anchors: OriginAnchorRecord[], limit = 5): OriginAnchorRecord[] {
  return [...anchors].sort((left, right) => right.weight - left.weight).slice(0, limit);
}

/** 对话后更新「上次见面 / 上次话题 / 未完成的事」，用于 resume。 */
export function touchOrigin(
  origin: OriginData,
  input: { at: Date; topics?: string[]; openLoops?: string[] },
): OriginData {
  const topics = [...new Set([...(input.topics ?? []), ...origin.lastTopics])].filter(Boolean).slice(0, 8);
  const openLoops = [...new Set([...(input.openLoops ?? []), ...origin.openLoops])].filter(Boolean).slice(0, 8);
  return {
    ...origin,
    lastSeenAt: input.at.toISOString(),
    lastTopics: topics,
    openLoops,
    updatedAt: input.at.toISOString(),
  };
}

function relativeTime(at: string | undefined, now: Date): string {
  if (!at) return '';
  const time = Date.parse(at);
  if (Number.isNaN(time)) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - time) / 60_000));
  if (minutes < 1) return '就在刚刚';
  if (minutes < 60) return minutes + ' 分钟前';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' 小时前';
  const days = Math.floor(hours / 24);
  return days < 30 ? days + ' 天前' : Math.floor(days / 30) + ' 个月前';
}

export interface ResumeBriefInput {
  origin?: OriginData;
  attention?: AttentionRecord;
  flow?: FlowRecord;
  point?: SeaPointRecord;
  now: Date;
}

/** 生成「上次我们聊到……」连续性 brief。 */
export function buildResumeBrief(input: ResumeBriefInput): string {
  const { origin, attention, flow, point, now } = input;
  const parts: string[] = [];
  const lastTopic = attention?.focus || origin?.lastTopics?.[0] || origin?.openLoops?.[0];
  if (lastTopic) {
    const when = relativeTime(attention?.updatedAt, now);
    parts.push('上次我们聊到「' + trimText(lastTopic, 50) + '」' + (when ? '，那是 ' + when : ''));
  } else if (origin) {
    parts.push('这是我们第一次认真说话，但我的原意识里已经带着 ' + origin.anchors.length + ' 个锚点');
  } else {
    parts.push('我还没有关于你的记忆，但我会从这一句开始记');
  }
  const topics = attention?.topics ?? [];
  if (topics.length > 0) parts.push('当时的话题是：' + topics.slice(0, 3).join('、'));
  const openLoops = attention?.unresolved ?? origin?.openLoops ?? [];
  if (openLoops.length > 0) parts.push('还没说完的：' + openLoops.slice(0, 2).map((item) => trimText(item, 40)).join('；'));
  if (flow?.current) parts.push('上一句心流停在「' + trimText(flow.current, 40) + '」');
  if (point) parts.push('我突然想起：' + trimText(point.text, 70));
  return parts.join('。') + '。';
}
