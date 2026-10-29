// 识海：把长期记忆与自我内容沉淀成可检索、会遗忘、会互相连接的「点」。
//
// 规则：
// - 每个点都有稳定 id（来源 + 来源 id + docId 哈希），刷新不会重复；
// - importance 来自来源本身（事实权重 / 经历 / 日记 / 知识），
//   salience 再叠加时间衰减与被回忆的强化；
// - 深层（deep/abyss）不是删除，原文永远留在记忆/内容里；
// - connections 按同人、同时段、关键词真实建立。
import { createHash } from 'node:crypto';
import type { ContentStore } from '../content';
import {
  FACT_CATEGORY_LABELS,
  FACT_HALF_LIFE_DAYS,
  tokenizeQuery,
  type FactCategory,
  type MemoryDoc,
  type MemoryDocExtras,
  type MemoryService,
} from '../memory';
import {
  MAX_CONNECTIONS_PER_POINT,
  MAX_SEA_POINTS,
} from './types';
import type {
  ForgettingStat,
  Scene,
  SeaData,
  SeaDepth,
  SeaPoint,
  SeaPointKind,
  SeaPointProvenance,
  SeaPointRecord,
  SeaPointSource,
} from './types';

const DAY_MS = 86_400_000;
const DEPTH_ORDER: Record<SeaDepth, number> = { surface: 0, shallow: 1, deep: 2, abyss: 3 };
const WEEK_MS = 7 * DAY_MS;

const FACT_IMPORTANCE_MULTIPLIER: Record<FactCategory, number> = {
  identity: 1,
  boundary: 1,
  promise: 1,
  preference: 0.9,
  event: 0.82,
  emotion: 0.6,
  other: 0.72,
};

/** 各来源的遗忘半衰期（天）。事实按分类单独查表。 */
export const SOURCE_HALF_LIFE: Record<SeaPointSource, number> = {
  fact: 365,
  episode: 240,
  quote: 365,
  diary: 300,
  qzone: 120,
  learning: 365,
  activity: 90,
  chat: 45,
};

export interface SeaSourceRecord {
  kind: SeaPointKind;
  source: SeaPointSource;
  sourceId: string;
  title: string;
  text: string;
  at: string;
  importance: number;
  halfLifeDays: number;
  tags: string[];
  provenance: SeaPointProvenance;
}

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function hash(input: string, length = 12): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}

function singleLine(value: string, limit: number): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function isoOrNow(at: string | undefined, now: Date): string {
  if (!at) return now.toISOString();
  const time = Date.parse(at);
  return Number.isNaN(time) ? now.toISOString() : new Date(time).toISOString();
}

function ageInDays(at: string, now: Date): number {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, (now.getTime() - time) / DAY_MS);
}

/** 稳定 id：同来源永远同 id，刷新不会产生重复点。 */
export function pointId(source: SeaPointSource, sourceId: string, docId?: string): string {
  return 'sea_' + source + '_' + hash(source + '|' + sourceId + '|' + (docId ?? ''));
}

/** 重要度 × 时间衰减 + 回忆强化 = 当前显著度（0..1）。 */
export function computeSalience(input: {
  importance: number;
  at: string;
  now: Date;
  accessCount?: number;
  reinforced?: number;
  lastRecalledAt?: string;
  halfLifeDays?: number;
}): number {
  const importance = clamp(input.importance);
  const halfLife = Math.max(1, input.halfLifeDays ?? 180);
  const recency = Math.pow(0.5, ageInDays(input.at, input.now) / halfLife);
  const recallRecency = input.lastRecalledAt
    ? Math.pow(0.5, ageInDays(input.lastRecalledAt, input.now) / 45)
    : 0;
  const accessCount = Math.max(0, input.accessCount ?? 0);
  const reinforced = Math.max(0, input.reinforced ?? 0);
  const reinforcement = Math.min(
    0.3,
    0.055 * Math.log2(1 + accessCount) + 0.02 * reinforced + 0.05 * recallRecency,
  );
  return clamp(importance * (0.55 + 0.45 * recency) + reinforcement);
}

/** 显著度 -> 深度；极重要的内容即便淡去也只在 deep，不落 abyss。 */
export function computeDepth(salience: number, importance: number): SeaDepth {
  let depth: SeaDepth;
  if (salience >= 0.55) depth = 'surface';
  else if (salience >= 0.38) depth = 'shallow';
  else if (salience >= 0.2) depth = 'deep';
  else depth = 'abyss';
  if (importance >= 0.8 && depth === 'abyss') depth = 'deep';
  if (importance >= 0.92 && depth === 'shallow') depth = 'deep';
  return depth;
}

// ---------------------------------------------------------------------------
// 来源采集：记忆文档 + 自我内容
// ---------------------------------------------------------------------------

function factHalfLife(category: FactCategory): number {
  return FACT_HALF_LIFE_DAYS[category] ?? SOURCE_HALF_LIFE.fact;
}

function docScene(doc: MemoryDoc): Scene | undefined {
  if (doc.scene === 'group') return 'group';
  if (doc.scene === 'private') return 'private';
  return undefined;
}

function docProvenanceBase(doc: MemoryDoc): Pick<SeaPointProvenance, 'docId' | 'docScene' | 'groupId' | 'userId' | 'displayName'> {
  const base: Pick<SeaPointProvenance, 'docId' | 'docScene' | 'groupId' | 'userId' | 'displayName'> = {
    docId: doc.id,
    displayName: doc.displayName,
  };
  const scene = docScene(doc);
  if (scene) base.docScene = scene;
  if (doc.groupId) base.groupId = doc.groupId;
  if (doc.scope === 'user') base.userId = doc.externalId;
  return base;
}

export function collectMemorySources(memory: MemoryService, now: Date): SeaSourceRecord[] {
  let docs: MemoryDoc[] = [];
  try {
    docs = memory.listDocs({});
  } catch {
    return [];
  }
  const sources: SeaSourceRecord[] = [];
  for (const doc of docs) {
    const base = docProvenanceBase(doc);
    for (const fact of doc.facts) {
      const category = fact.category;
      sources.push({
        kind: 'fact',
        source: 'fact',
        sourceId: fact.id,
        title: doc.displayName + ' · ' + (FACT_CATEGORY_LABELS[category] ?? '事实'),
        text: fact.text,
        at: isoOrNow(fact.createdAt, now),
        importance: clamp(fact.weight * FACT_IMPORTANCE_MULTIPLIER[category]),
        halfLifeDays: factHalfLife(category),
        tags: [category, doc.scope],
        provenance: { source: 'fact', sourceId: fact.id, ...base },
      });
    }
    let extras: MemoryDocExtras | undefined;
    try {
      extras = memory.store.getExtras(doc.id);
    } catch {
      extras = undefined;
    }
    if (!extras) continue;
    for (const episode of extras.episodes) {
      const quotes = episode.anchors.filter((anchor) => anchor.trim().length > 0);
      sources.push({
        kind: 'episode',
        source: 'episode',
        sourceId: episode.id,
        title: episode.title,
        text: [episode.detail, quotes.length > 0 ? '原话：' + quotes.join('；') : ''].filter(Boolean).join(' ').trim(),
        at: isoOrNow(episode.at, now),
        importance: clamp(0.8 + (quotes.length > 0 ? 0.08 : 0) + Math.min(0.07, episode.detail.length / 4000)),
        halfLifeDays: SOURCE_HALF_LIFE.episode,
        tags: ['经历', ...doc.tags.slice(0, 2)],
        provenance: {
          source: 'episode',
          sourceId: episode.id,
          ...base,
          ...(quotes[0] ? { quote: quotes[0] } : {}),
        },
      });
    }
    const anchorAt = extras.episodes.length > 0
      ? extras.episodes[extras.episodes.length - 1]?.at
      : doc.updatedAt;
    for (const anchor of extras.anchors) {
      const normalized = singleLine(anchor, 300);
      if (!normalized) continue;
      const sourceId = 'anchor_' + hash(doc.id + '|' + normalized);
      sources.push({
        kind: 'quote',
        source: 'quote',
        sourceId,
        title: doc.displayName + ' · 原话',
        text: normalized,
        at: isoOrNow(anchorAt, now),
        importance: 0.78,
        halfLifeDays: SOURCE_HALF_LIFE.quote,
        tags: ['原话', doc.scope],
        provenance: { source: 'quote', sourceId, ...base, quote: normalized },
      });
    }
  }
  return sources;
}

export function collectContentSources(content: ContentStore, now: Date, personaId?: string): SeaSourceRecord[] {
  const sources: SeaSourceRecord[] = [];
  try {
    for (const diary of content.listDiaries(personaId)) {
      sources.push({
        kind: 'diary',
        source: 'diary',
        sourceId: diary.id,
        title: '日记 · ' + diary.title,
        text: singleLine(diary.content, 1400),
        at: isoOrNow(diary.createdAt, now),
        importance: 0.9,
        halfLifeDays: SOURCE_HALF_LIFE.diary,
        tags: ['日记', diary.mood],
        provenance: { source: 'diary', sourceId: diary.id, displayName: '鲸鲸的日记' },
      });
    }
  } catch { /* 内容服务不可用时忽略该类来源 */ }
  try {
    for (const post of content.listQzone(personaId)) {
      sources.push({
        kind: 'qzone',
        source: 'qzone',
        sourceId: post.id,
        title: '空间说说',
        text: singleLine(post.content, 1000),
        at: isoOrNow(post.createdAt, now),
        importance: 0.66,
        halfLifeDays: SOURCE_HALF_LIFE.qzone,
        tags: ['说说', post.status],
        provenance: { source: 'qzone', sourceId: post.id, displayName: '鲸鲸的空间' },
      });
    }
  } catch { /* ignore */ }
  try {
    for (const note of content.listLearning(personaId)) {
      sources.push({
        kind: 'learning',
        source: 'learning',
        sourceId: note.id,
        title: '学到 · ' + note.topic,
        text: singleLine([note.summary, ...(note.points ?? [])].join('；'), 1400),
        at: isoOrNow(note.createdAt, now),
        importance: 0.82,
        halfLifeDays: SOURCE_HALF_LIFE.learning,
        tags: ['学习', '知识'],
        provenance: { source: 'learning', sourceId: note.id, displayName: '鲸鲸的学习笔记' },
      });
    }
  } catch { /* ignore */ }
  try {
    for (const item of content.listBili(personaId)) {
      sources.push({
        kind: 'activity',
        source: 'activity',
        sourceId: 'bili_' + item.id,
        title: '刷到 · ' + item.title,
        text: singleLine([item.reason, item.comment].filter(Boolean).join('；'), 800),
        at: isoOrNow(item.createdAt, now),
        importance: 0.52,
        halfLifeDays: SOURCE_HALF_LIFE.activity,
        tags: ['B站', '发现'],
        provenance: { source: 'activity', sourceId: 'bili_' + item.id, displayName: '鲸鲸刷到的视频' },
      });
    }
  } catch { /* ignore */ }
  try {
    for (const item of content.listActivities(200, personaId)) {
      if (!item.title && !item.summary) continue;
      sources.push({
        kind: 'activity',
        source: 'activity',
        sourceId: item.id,
        title: item.title || item.summary.slice(0, 40),
        text: singleLine([item.summary, item.detail].filter(Boolean).join('；'), 900),
        at: isoOrNow(item.createdAt, now),
        importance: item.type === 'reflection' || item.type === 'diary' ? 0.68 : 0.5,
        halfLifeDays: SOURCE_HALF_LIFE.activity,
        tags: ['活动', item.type],
        provenance: { source: 'activity', sourceId: item.id, displayName: '鲸鲸的行动记录' },
      });
    }
  } catch { /* ignore */ }
  return sources;
}

// ---------------------------------------------------------------------------
// 点生成 / 刷新
// ---------------------------------------------------------------------------

function createOrUpdateRecord(
  id: string,
  source: SeaSourceRecord,
  previous: SeaPointRecord | undefined,
  now: Date,
): SeaPointRecord {
  const record: SeaPointRecord = {
    id,
    kind: source.kind,
    title: singleLine(source.title, 120) || singleLine(source.text, 40),
    text: source.text,
    at: source.at,
    salience: 0,
    depth: 'surface',
    connections: 0,
    accessCount: previous?.accessCount ?? 0,
    reinforced: previous?.reinforced ?? 0,
    importance: clamp(source.importance),
    halfLifeDays: source.halfLifeDays,
    provenance: source.provenance,
    firstSeenAt: previous?.firstSeenAt ?? source.at,
    lastDepth: previous?.lastDepth ?? 'surface',
    connectionIds: [],
    updatedAt: now.toISOString(),
  };
  if (source.provenance.docId) record.docId = source.provenance.docId;
  const tags = [...new Set(source.tags.filter(Boolean))].slice(0, 6);
  if (tags.length > 0) record.tags = tags;
  if (previous?.lastRecalledAt) record.lastRecalledAt = previous.lastRecalledAt;
  if (previous?.depthChangedAt) record.depthChangedAt = previous.depthChangedAt;
  if (previous?.fadedAt) record.fadedAt = previous.fadedAt;
  recalcRecord(record, now, Boolean(previous));
  return record;
}

/** 依据当前显著度重算深度；从浅到深时记录 fadedAt（用于「本周遗忘」统计）。 */
export function recalcRecord(record: SeaPointRecord, now: Date, trackHistory = true): void {
  record.salience = computeSalience({
    importance: record.importance,
    at: record.at,
    now,
    accessCount: record.accessCount,
    reinforced: record.reinforced,
    lastRecalledAt: record.lastRecalledAt,
    halfLifeDays: record.halfLifeDays,
  });
  const nextDepth = computeDepth(record.salience, record.importance);
  if (trackHistory && nextDepth !== record.depth) {
    const deeper = DEPTH_ORDER[nextDepth] > DEPTH_ORDER[record.depth];
    record.lastDepth = record.depth;
    record.depthChangedAt = now.toISOString();
    if (deeper) record.fadedAt = now.toISOString();
  }
  record.depth = nextDepth;
  record.connections = record.connectionIds.length;
  record.updatedAt = now.toISOString();
}

function tokenSetForPoint(point: SeaPointRecord): Set<string> {
  const tokens = tokenizeQuery(point.title + ' ' + point.text.slice(0, 220));
  return new Set([...tokens.bigrams, ...tokens.keywords]);
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function connectionWeight(a: SeaPointRecord, b: SeaPointRecord, tokensA: Set<string>, tokensB: Set<string>): number {
  let weight = 0;
  if (a.docId && b.docId && a.docId === b.docId) weight += 2;
  const timeA = Date.parse(a.at);
  const timeB = Date.parse(b.at);
  if (Number.isFinite(timeA) && Number.isFinite(timeB) && Math.abs(timeA - timeB) <= 36 * 3_600_000) {
    weight += 1;
  }
  const overlap = jaccard(tokensA, tokensB);
  if (overlap >= 0.4) weight += 2;
  else if (overlap >= 0.2) weight += 1;
  if (
    a.provenance.conversationId &&
    a.provenance.conversationId === b.provenance.conversationId &&
    a.provenance.source === 'chat' &&
    b.provenance.source === 'chat'
  ) {
    weight += 1;
  }
  return weight;
}

/** 为全部点重建连接（同人 / 同时段 / 关键词）。返回建立的边数。 */
export function connectPoints(points: SeaPointRecord[], options: { minWeight?: number; maxPerPoint?: number } = {}): number {
  const minWeight = options.minWeight ?? 2;
  const maxPerPoint = options.maxPerPoint ?? MAX_CONNECTIONS_PER_POINT;
  const tokenSets = points.map(tokenSetForPoint);
  const adjacency = new Map<string, { id: string; weight: number }[]>();
  for (const point of points) adjacency.set(point.id, []);
  let edges = 0;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const a = points[i] as SeaPointRecord;
      const b = points[j] as SeaPointRecord;
      const weight = connectionWeight(a, b, tokenSets[i] as Set<string>, tokenSets[j] as Set<string>);
      if (weight < minWeight) continue;
      adjacency.get(a.id)?.push({ id: b.id, weight });
      adjacency.get(b.id)?.push({ id: a.id, weight });
      edges += 1;
    }
  }
  for (const point of points) {
    const linked = adjacency.get(point.id) ?? [];
    linked.sort((left, right) => right.weight - left.weight);
    point.connectionIds = linked.slice(0, maxPerPoint).map((link) => link.id);
    point.connections = point.connectionIds.length;
  }
  return edges;
}

/** 新增一个点时只和已有相关点连线，避免每次刷新都全量 O(n²)。 */
export function connectNewPoint(points: SeaPointRecord[], point: SeaPointRecord, options: { minWeight?: number; maxPerPoint?: number } = {}): number {
  const minWeight = options.minWeight ?? 2;
  const maxPerPoint = options.maxPerPoint ?? MAX_CONNECTIONS_PER_POINT;
  const tokens = tokenSetForPoint(point);
  const linked: { id: string; weight: number }[] = [];
  for (const other of points) {
    if (other.id === point.id) continue;
    const weight = connectionWeight(point, other, tokens, tokenSetForPoint(other));
    if (weight < minWeight) continue;
    linked.push({ id: other.id, weight });
    other.connectionIds = [...new Set([...other.connectionIds, point.id])].slice(0, maxPerPoint);
    other.connections = other.connectionIds.length;
  }
  linked.sort((left, right) => right.weight - left.weight);
  point.connectionIds = linked.slice(0, maxPerPoint).map((link) => link.id);
  point.connections = point.connectionIds.length;
  return point.connectionIds.length;
}

function prunePoints(points: SeaPointRecord[]): SeaPointRecord[] {
  if (points.length <= MAX_SEA_POINTS) return points;
  const sorted = [...points].sort((left, right) => {
    const leftProtected = left.importance >= 0.9 ? 1 : 0;
    const rightProtected = right.importance >= 0.9 ? 1 : 0;
    if (leftProtected !== rightProtected) return rightProtected - leftProtected;
    return right.salience - left.salience;
  });
  return sorted.slice(0, MAX_SEA_POINTS);
}

export interface BuildSeaInput {
  memory: MemoryService;
  content: ContentStore;
  existing: SeaPointRecord[];
  now: Date;
  /** 只收集当前人设的日记/说说/学习/活动；记忆根已按人设隔离。 */
  personaId?: string;
}

/** 从记忆 + 内容重建识海；对话点保留并合并强化数据。 */
export function buildSea(input: BuildSeaInput): SeaData {
  const { memory, content, existing, now, personaId } = input;
  const existingById = new Map(existing.map((point) => [point.id, point]));
  const sources = [...collectMemorySources(memory, now), ...collectContentSources(content, now, personaId)];
  const points: SeaPointRecord[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const id = pointId(source.source, source.sourceId, source.provenance.docId);
    if (seen.has(id)) continue;
    seen.add(id);
    points.push(createOrUpdateRecord(id, source, existingById.get(id), now));
  }
  // 对话点是真实使用中产生的，刷新记忆时不能丢。
  for (const point of existing) {
    if (seen.has(point.id)) continue;
    if (point.provenance.source !== 'chat') continue;
    points.push(createOrUpdateRecord(point.id, {
      kind: point.kind,
      source: 'chat',
      sourceId: point.provenance.sourceId,
      title: point.title,
      text: point.text,
      at: point.at,
      importance: point.importance,
      halfLifeDays: point.halfLifeDays,
      tags: point.tags ?? [],
      provenance: point.provenance,
    }, point, now));
  }
  const kept = prunePoints(points);
  connectPoints(kept);
  kept.sort((left, right) => right.salience - left.salience || right.at.localeCompare(left.at));
  return { points: kept, updatedAt: now.toISOString() };
}

// ---------------------------------------------------------------------------
// 对话点 / 强化 / 检索 / 遗忘
// ---------------------------------------------------------------------------

export interface ChatPointInput {
  conversationId: string;
  userText: string;
  assistantText?: string;
  at: Date;
  docId?: string;
  scene?: Scene;
  groupId?: string;
  userId?: string;
  displayName?: string;
  topics?: string[];
  memoryHitCount?: number;
}

/** 把一次真实对话沉淀成识海里的 chat 点（稳定 id：同一时刻同一内容不会重复）。 */
export function upsertChatPoint(points: SeaPointRecord[], input: ChatPointInput): { point: SeaPointRecord; added: boolean } {
  const userText = singleLine(input.userText, 600);
  const assistantText = singleLine(input.assistantText ?? '', 600);
  const sourceId = 'chat_' + hash(
    input.conversationId + '|' + input.at.toISOString() + '|' + input.userText.slice(0, 120),
  );
  const id = pointId('chat', sourceId, input.docId);
  const existing = points.find((point) => point.id === id);
  if (existing) return { point: existing, added: false };
  const topics = (input.topics ?? []).filter(Boolean).slice(0, 4);
  const importance = clamp(
    0.42 + Math.min(0.22, (userText.length + assistantText.length) / 900) + (input.memoryHitCount ?? 0) * 0.04 + (topics.length > 0 ? 0.05 : 0),
    0.3,
    0.9,
  );
  const point: SeaPointRecord = {
    id,
    kind: 'chat',
    title: topics[0] ?? singleLine(userText, 30),
    text: [userText ? '对方：' + userText : '', assistantText ? '鲸鲸：' + assistantText : ''].filter(Boolean).join('\n'),
    at: input.at.toISOString(),
    ...(input.docId ? { docId: input.docId } : {}),
    salience: 0,
    depth: 'surface',
    connections: 0,
    accessCount: 1,
    reinforced: 0,
    importance,
    halfLifeDays: SOURCE_HALF_LIFE.chat,
    provenance: {
      source: 'chat',
      sourceId,
      conversationId: input.conversationId,
      ...(input.docId ? { docId: input.docId } : {}),
      ...(input.scene ? { docScene: input.scene } : {}),
      ...(input.groupId ? { groupId: input.groupId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
    },
    firstSeenAt: input.at.toISOString(),
    lastDepth: 'surface',
    connectionIds: [],
    updatedAt: input.at.toISOString(),
    lastRecalledAt: input.at.toISOString(),
  };
  if (topics.length > 0) point.tags = ['对话', ...topics];
  recalcRecord(point, input.at, false);
  connectNewPoint(points, point);
  points.push(point);
  return { point, added: true };
}

/** 记一次回忆：accessCount++、lastRecalledAt 更新、显著度重算。 */
export function recordRecall(point: SeaPointRecord, now: Date, mode: 'touch' | 'strengthen' = 'touch'): SeaPointRecord {
  point.accessCount += 1;
  point.lastRecalledAt = now.toISOString();
  if (mode === 'strengthen') point.reinforced += 1;
  recalcRecord(point, now, true);
  return point;
}

/** 检索识海点。docIds 是硬白名单：有 docId 的点必须命中白名单；无 docId 的自我内容始终可用。 */
export function searchPoints(
  points: SeaPointRecord[],
  query: string,
  options: { docIds?: string[]; topK?: number; minSalience?: number; kinds?: SeaPointKind[] } = {},
): SeaPointRecord[] {
  const topK = Math.max(1, options.topK ?? 8);
  const minSalience = options.minSalience ?? 0;
  const allowed = options.docIds ? new Set(options.docIds) : undefined;
  const tokens = tokenizeQuery(query ?? '');
  const hasQuery = tokens.bigrams.length > 0 || tokens.keywords.length > 0;
  const scored: { point: SeaPointRecord; score: number }[] = [];
  for (const point of points) {
    if (allowed && point.docId && !allowed.has(point.docId)) continue;
    if (options.kinds && options.kinds.length > 0 && !options.kinds.includes(point.kind)) continue;
    if (point.salience < minSalience) continue;
    if (!hasQuery) {
      scored.push({ point, score: point.salience });
      continue;
    }
    const pointTokens = tokenizeQuery(point.title + ' ' + point.text);
    const pointBigrams = new Set(pointTokens.bigrams);
    let hits = 0;
    for (const bigram of tokens.bigrams) if (pointBigrams.has(bigram)) hits += 1;
    const coverage = tokens.bigrams.length > 0 ? hits / tokens.bigrams.length : 0;
    const lower = (point.title + ' ' + point.text).toLowerCase();
    let keywordHits = 0;
    for (const keyword of tokens.keywords) if (lower.includes(keyword)) keywordHits += 1;
    const keywordScore = tokens.keywords.length > 0 ? keywordHits / tokens.keywords.length : 0;
    const lexical = 0.6 * coverage + 0.4 * keywordScore;
    if (lexical <= 0) continue;
    // 深层记忆被关键词唤醒时略微加权，体现「被唤醒的深层记忆」。
    const depthBoost = point.depth === 'deep' || point.depth === 'abyss' ? 1.08 : 1;
    scored.push({ point, score: lexical * (0.45 + 0.55 * point.salience) * depthBoost });
  }
  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, topK).map((entry) => entry.point);
}

/** 遗忘统计：深度分布、本周下沉、本周巩固。 */
export function forgettingStats(points: SeaPointRecord[], now: Date): ForgettingStat {
  const stat: ForgettingStat = { surface: 0, shallow: 0, deep: 0, abyss: 0, fadedThisWeek: 0, reinforced: 0 };
  const weekAgo = now.getTime() - WEEK_MS;
  for (const point of points) {
    stat[point.depth] += 1;
    if (point.fadedAt) {
      const faded = Date.parse(point.fadedAt);
      if (Number.isFinite(faded) && faded >= weekAgo) stat.fadedThisWeek += 1;
    }
    if (point.lastRecalledAt) {
      const recalled = Date.parse(point.lastRecalledAt);
      if (Number.isFinite(recalled) && recalled >= weekAgo) stat.reinforced += 1;
    }
  }
  return stat;
}

/** 对外展示用：剥掉内部字段。 */
export function toSeaPoint(record: SeaPointRecord): SeaPoint {
  const point: SeaPoint = {
    id: record.id,
    kind: record.kind,
    title: record.title,
    text: record.text,
    at: record.at,
    salience: Math.round(record.salience * 1000) / 1000,
    depth: record.depth,
    connections: record.connectionIds.length,
    accessCount: record.accessCount,
  };
  if (record.docId) point.docId = record.docId;
  if (record.lastRecalledAt) point.lastRecalledAt = record.lastRecalledAt;
  if (record.tags && record.tags.length > 0) point.tags = [...record.tags];
  return point;
}

export function toSeaPoints(records: SeaPointRecord[]): SeaPoint[] {
  return records.map(toSeaPoint);
}

/** 按显著度取前 limit 个点（overview 用）。 */
export function topSeaPoints(points: SeaPointRecord[], limit = 80): SeaPointRecord[] {
  return [...points].sort((left, right) => right.salience - left.salience).slice(0, limit);
}

/** 近期平均清醒度：供 UI 展示「识海活跃度」。 */
export function seaActivity(points: SeaPointRecord[], now: Date): number {
  const recent = points.filter((point) => {
    const recalled = point.lastRecalledAt ? Date.parse(point.lastRecalledAt) : 0;
    return Number.isFinite(recalled) && now.getTime() - recalled <= 3 * DAY_MS;
  });
  return clamp(recent.length / Math.max(1, Math.min(points.length, 20)));
}


