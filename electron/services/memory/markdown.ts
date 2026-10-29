// Markdown 记忆文档：固定章节渲染 + 容错解析。
// 人读部分是清晰的中文章节，机器读部分是文末的 <!-- memory:data --> JSON 块。
import { normalizeExtras } from './docops';
import { formatDate, normalizeLine, normalizeText, toIso } from './time';
import type {
  FactCategory,
  MemoryDoc,
  MemoryDocExtras,
  MemoryEmotionPoint,
  MemoryEpisode,
  MemoryFact,
  MemoryScene,
  MemoryScopeKind,
  ParsedMemoryDoc,
  RelationshipState,
} from './types';
import {
  FACT_CATEGORY_LABELS,
  MEMORY_DATA_MARKER,
  MEMORY_DOC_VERSION,
  MEMORY_SECTIONS,
  RELATIONSHIP_AXIS_LABELS,
  RELATIONSHIP_AXES,
} from './types';

const EMPTY_LINE = '_（暂无）_';
const BACKTICK = '\u0060';

export function emptyRelationship(now?: Date | number | string): RelationshipState {
  const iso = toIso(now);
  return {
    affinity: 50,
    trust: 50,
    familiarity: 10,
    intimacy: 5,
    respect: 55,
    tension: 5,
    interactions: 0,
    streakDays: 0,
    firstMetAt: iso,
    lastInteractionAt: iso,
    lastMood: '平静',
    notes: [],
  };
}

export function emptyExtras(): MemoryDocExtras {
  return { anchors: [], episodes: [], emotionTrail: [], manualNote: '', summaryVersion: 0 };
}

function scopeLabel(scope: MemoryScopeKind): string {
  switch (scope) {
    case 'user':
      return '联系人';
    case 'group':
      return '群聊';
    case 'global':
      return '全局自我';
    case 'persona':
      return '人设';
    default:
      return String(scope);
  }
}

function sceneLabel(scene: MemoryScene): string {
  if (scene === 'group') return '群聊';
  if (scene === 'global') return '全局';
  return '私聊';
}

function renderBar(value: number): string {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  const filled = Math.round(clamped / 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function cell(value: string): string {
  const single = normalizeLine(value, 200).split('|').join('&#124;');
  return single || '—';
}

function timeValue(iso: string | undefined): number {
  if (!iso) return 0;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

function sortByTimeDesc<T>(items: readonly T[], pick: (item: T) => string | undefined): T[] {
  return [...items].sort((left, right) => timeValue(pick(right)) - timeValue(pick(left)));
}

function factsOf(doc: MemoryDoc, categories: readonly FactCategory[]): MemoryFact[] {
  return doc.facts.filter((fact) => categories.includes(fact.category));
}

function renderFactLine(fact: MemoryFact): string {
  const manual = fact.source === 'manual' ? '🔒 ' : '';
  return (
    '- ' + manual + BACKTICK + FACT_CATEGORY_LABELS[fact.category] + BACKTICK + ' ' + fact.text +
    '（权重 ' + fact.weight.toFixed(2) + ' · ' + formatDate(fact.createdAt) + '）'
  );
}

function pushFactLines(lines: string[], facts: readonly MemoryFact[]): void {
  if (facts.length === 0) {
    lines.push(EMPTY_LINE);
    return;
  }
  for (const fact of facts) lines.push(renderFactLine(fact));
}

/** 渲染完整 Markdown 文档。章节顺序固定，便于 UI / 人读 / diff。 */
export function renderMemoryMarkdown(doc: MemoryDoc, extrasInput: MemoryDocExtras): string {
  const extras = normalizeExtras(extrasInput);
  const relationship = doc.relationship;
  const lines: string[] = [];

  lines.push('# ' + doc.displayName + ' · 记忆档案');
  lines.push('');
  lines.push(
    '> 记忆 ID：' + BACKTICK + doc.id + BACKTICK + ' ｜ 作用域：' + scopeLabel(doc.scope) +
    ' ｜ 场景：' + sceneLabel(doc.scene),
  );
  lines.push('> 创建：' + formatDate(doc.createdAt, true) + ' ｜ 更新：' + formatDate(doc.updatedAt, true));
  lines.push('> 本文件由鲸鲸记忆系统自动维护；标有 🔒 的条目为用户手动内容，自动提取不会覆盖。');
  lines.push('');

  // 1. 基本档案
  lines.push('## ' + MEMORY_SECTIONS[0]);
  lines.push('');
  const idLabel = doc.scope === 'group' ? '群号' : doc.scope === 'global' ? '标识' : 'QQ';
  lines.push('| 项目 | 内容 |');
  lines.push('| --- | --- |');
  lines.push('| 昵称 | ' + cell(doc.displayName) + ' |');
  lines.push('| ' + idLabel + ' | ' + BACKTICK + cell(doc.externalId) + BACKTICK + ' |');
  lines.push('| 记忆类型 | ' + scopeLabel(doc.scope) + ' |');
  lines.push('| 场景 | ' + sceneLabel(doc.scene) + ' |');
  lines.push('| 所属群 | ' + (doc.groupId ? cell(doc.groupName ?? '未命名群') + '（' + cell(doc.groupId) + '）' : '—') + ' |');
  lines.push('| 首次相遇 | ' + formatDate(relationship.firstMetAt, true) + ' |');
  lines.push('| 最近互动 | ' + formatDate(relationship.lastInteractionAt, true) + ' |');
  lines.push('| 互动次数 | ' + relationship.interactions + ' |');
  lines.push('| 连续互动 | ' + relationship.streakDays + ' 天 |');
  lines.push('| 标签 | ' + (doc.tags.length > 0 ? doc.tags.map((tag) => '#' + tag).join(' ') : '—') + ' |');
  lines.push('| 预览 | ' + cell(doc.preview) + ' |');
  if (extras.manualNote) lines.push('| 手写备注 | ' + cell(extras.manualNote) + ' |');
  if (doc.avatar) lines.push('| 头像 | ' + cell(doc.avatar) + ' |');
  lines.push('');

  // 2. 关系状态
  lines.push('## ' + MEMORY_SECTIONS[1]);
  lines.push('');
  for (const axis of RELATIONSHIP_AXES) {
    lines.push(
      '- ' + RELATIONSHIP_AXIS_LABELS[axis] + '：' + renderBar(relationship[axis]) +
      ' ' + Math.round(relationship[axis]) + '/100',
    );
  }
  lines.push('- 最近情绪：' + (relationship.lastMood || '—'));
  lines.push(
    '- 最近互动：' + formatDate(relationship.lastInteractionAt, true) +
    '（累计 ' + relationship.interactions + ' 次 · 连续 ' + relationship.streakDays + ' 天）',
  );
  if (relationship.notes.length > 0) {
    lines.push('- 备注：');
    for (const note of relationship.notes) lines.push('  - ' + normalizeLine(note, 300));
  }
  lines.push('');

  // 3. 重要事实（身份 / 其他）
  lines.push('## ' + MEMORY_SECTIONS[2]);
  lines.push('');
  pushFactLines(lines, factsOf(doc, ['identity', 'other']));
  lines.push('');

  // 4. 偏好与雷区
  lines.push('## ' + MEMORY_SECTIONS[3]);
  lines.push('');
  lines.push('### 喜欢与偏好');
  lines.push('');
  pushFactLines(lines, factsOf(doc, ['preference']));
  lines.push('');
  lines.push('### 雷区与边界');
  lines.push('');
  pushFactLines(lines, factsOf(doc, ['boundary']));
  lines.push('');

  // 5. 共同经历时间线（episode + event 事实）
  lines.push('## ' + MEMORY_SECTIONS[4]);
  lines.push('');
  const episodes = sortByTimeDesc(extras.episodes, (episode) => episode.at);
  const eventFacts = sortByTimeDesc(factsOf(doc, ['event']), (fact) => fact.createdAt);
  if (episodes.length === 0 && eventFacts.length === 0) {
    lines.push(EMPTY_LINE);
  }
  for (const episode of episodes) {
    lines.push('- **' + formatDate(episode.at) + ' · ' + normalizeLine(episode.title, 120) + '**');
    if (episode.detail) {
      for (const part of episode.detail.split('\n')) lines.push('  ' + part);
    }
    for (const anchor of episode.anchors) lines.push('  > 原话：「' + anchor + '」');
  }
  for (const fact of eventFacts) {
    lines.push('- **' + formatDate(fact.createdAt) + ' · 事件**：' + fact.text);
  }
  lines.push('');

  // 6. 承诺与待办
  lines.push('## ' + MEMORY_SECTIONS[5]);
  lines.push('');
  pushFactLines(lines, factsOf(doc, ['promise']));
  lines.push('');

  // 7. 记忆锚点（原话引用，压缩后依然保留细节）
  lines.push('## ' + MEMORY_SECTIONS[6]);
  lines.push('');
  if (extras.anchors.length === 0) {
    lines.push(EMPTY_LINE);
  } else {
    for (const anchor of extras.anchors) lines.push('- 「' + anchor + '」');
  }
  lines.push('');

  // 8. 情绪轨迹
  lines.push('## ' + MEMORY_SECTIONS[7]);
  lines.push('');
  const plusEmotionFacts = sortByTimeDesc(factsOf(doc, ['emotion']), (fact) => fact.createdAt);
  const emotionPoints = sortByTimeDesc(extras.emotionTrail, (point) => point.at);
  if (plusEmotionFacts.length === 0 && emotionPoints.length === 0) {
    lines.push(EMPTY_LINE);
  }
  for (const point of emotionPoints) {
    lines.push(
      '- **' + formatDate(point.at, true) + ' · ' + point.mood + '**' +
      '（愉悦 ' + point.valence.toFixed(2) + ' / 唤醒 ' + point.arousal.toFixed(2) + '）' +
      (point.reason ? '：' + point.reason : ''),
    );
  }
  for (const fact of plusEmotionFacts) lines.push(renderFactLine(fact));
  lines.push('');

  // 机器可读数据块（避免人读部分解析不完整）
  const payload = {
    v: MEMORY_DOC_VERSION,
    id: doc.id,
    scope: doc.scope,
    externalId: doc.externalId,
    displayName: doc.displayName,
    avatar: doc.avatar ?? null,
    scene: doc.scene,
    groupId: doc.groupId ?? null,
    groupName: doc.groupName ?? null,
    tags: doc.tags,
    pinned: doc.pinned === true,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    messageCount: doc.messageCount,
    episodeCount: doc.episodeCount,
    facts: doc.facts,
    relationship,
    extras: {
      anchors: extras.anchors,
      episodes: extras.episodes,
      emotionTrail: extras.emotionTrail,
      manualNote: extras.manualNote,
      summaryVersion: extras.summaryVersion,
    },
  };
  lines.push('<!-- ' + MEMORY_DATA_MARKER);
  lines.push(escapeDataJson(JSON.stringify(payload, null, 2)));
  lines.push('-->');
  lines.push('');
  return lines.join('\n');
}

function escapeDataJson(json: string): string {
  return json.split('-->').join('--\\u003e');
}

export function buildPreview(doc: MemoryDoc, extras: MemoryDocExtras): string {
  const topFacts = [...doc.facts].sort((left, right) => right.weight - left.weight).slice(0, 2);
  const parts: string[] = ['好感 ' + Math.round(doc.relationship.affinity)];
  for (const fact of topFacts) parts.push(fact.text);
  if (topFacts.length === 0 && extras.episodes.length > 0) {
    const latest = sortByTimeDesc(extras.episodes, (episode) => episode.at)[0];
    if (latest) parts.push(latest.title);
  }
  return normalizeLine(parts.join(' · '), 160);
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export interface ParseFallback {
  id: string;
  scope: MemoryScopeKind;
  externalId: string;
  scene: MemoryScene;
  groupId?: string;
  groupName?: string;
}

interface DataPayload {
  v?: unknown;
  id?: unknown;
  scope?: unknown;
  externalId?: unknown;
  displayName?: unknown;
  avatar?: unknown;
  scene?: unknown;
  groupId?: unknown;
  groupName?: unknown;
  tags?: unknown;
  pinned?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  messageCount?: unknown;
  episodeCount?: unknown;
  facts?: unknown;
  relationship?: unknown;
  extras?: unknown;
}

/** 解析 Markdown：优先机器可读数据块，缺失/损坏时回退到章节解析（支持用户手写）。 */
export function parseMemoryMarkdown(
  markdown: string,
  filePath: string,
  fallback: ParseFallback,
): ParsedMemoryDoc | null {
  const payload = readDataPayload(markdown);
  if (payload) {
    const parsed = docFromPayload(payload, filePath, fallback);
    if (parsed) return parsed;
  }
  return parseBySections(markdown, filePath, fallback);
}

function readDataPayload(markdown: string): DataPayload | undefined {
  const open = '<!-- ' + MEMORY_DATA_MARKER;
  const start = markdown.indexOf(open);
  if (start === -1) return undefined;
  const bodyStart = start + open.length;
  const end = markdown.indexOf('-->', bodyStart);
  if (end === -1) return undefined;
  const body = markdown.slice(bodyStart, end).trim();
  if (!body) return undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null ? (parsed as DataPayload) : undefined;
  } catch {
    return undefined;
  }
}

function isFactCategory(value: unknown): value is FactCategory {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(FACT_CATEGORY_LABELS, value);
}

function normalizeLoadedFact(value: unknown, now: Date): MemoryFact | undefined {
  if (typeof value === 'string') {
    const text = normalizeLine(value, 400);
    if (!text) return undefined;
    return {
      id: 'fact_' + text.length + '_' + text.slice(0, 8),
      text,
      category: 'other',
      weight: 0.5,
      createdAt: toIso(now),
    };
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const text = normalizeLine(typeof record.text === 'string' ? record.text : '', 400);
  if (!text) return undefined;
  const category = isFactCategory(record.category) ? record.category : 'other';
  const weight = typeof record.weight === 'number' && Number.isFinite(record.weight)
    ? Math.max(0, Math.min(1, record.weight))
    : 0.5;
  const createdAt = typeof record.createdAt === 'string' ? toIso(record.createdAt) : toIso(now);
  const fact: MemoryFact = {
    id: typeof record.id === 'string' && record.id ? record.id : 'fact_' + text.length + '_' + text.slice(0, 8),
    text,
    category,
    weight,
    createdAt,
  };
  if (typeof record.source === 'string' && record.source) fact.source = record.source;
  return fact;
}

function normalizeLoadedRelationship(value: unknown): RelationshipState {
  const base = emptyRelationship();
  if (typeof value !== 'object' || value === null) return base;
  const record = value as Record<string, unknown>;
  for (const axis of RELATIONSHIP_AXES) {
    const axisValue = record[axis];
    if (typeof axisValue === 'number' && Number.isFinite(axisValue)) {
      base[axis] = Math.max(0, Math.min(100, axisValue));
    }
  }
  if (typeof record.interactions === 'number' && Number.isFinite(record.interactions)) {
    base.interactions = Math.max(0, Math.round(record.interactions));
  }
  if (typeof record.streakDays === 'number' && Number.isFinite(record.streakDays)) {
    base.streakDays = Math.max(0, Math.round(record.streakDays));
  }
  if (typeof record.firstMetAt === 'string' && record.firstMetAt) base.firstMetAt = toIso(record.firstMetAt);
  if (typeof record.lastInteractionAt === 'string' && record.lastInteractionAt) {
    base.lastInteractionAt = toIso(record.lastInteractionAt);
  }
  if (typeof record.lastMood === 'string') base.lastMood = normalizeLine(record.lastMood, 40);
  if (Array.isArray(record.notes)) {
    base.notes = record.notes.filter((note): note is string => typeof note === 'string').slice(0, 40);
  }
  return base;
}

function normalizeLoadedEpisodes(value: unknown): MemoryEpisode[] {
  if (!Array.isArray(value)) return [];
  const episodes: MemoryEpisode[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const title = normalizeLine(typeof record.title === 'string' ? record.title : '', 120);
    const detail = normalizeText(typeof record.detail === 'string' ? record.detail : '', 1200);
    if (!title && !detail) continue;
    const anchors = Array.isArray(record.anchors)
      ? record.anchors.filter((anchor): anchor is string => typeof anchor === 'string').slice(0, 20)
      : [];
    episodes.push({
      id: typeof record.id === 'string' && record.id ? record.id : 'ep_' + episodes.length,
      at: typeof record.at === 'string' ? toIso(record.at) : toIso(),
      title: title || detail.slice(0, 40),
      detail,
      anchors,
    });
  }
  return episodes;
}

function normalizeLoadedEmotionTrail(value: unknown): MemoryEmotionPoint[] {
  if (!Array.isArray(value)) return [];
  const points: MemoryEmotionPoint[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const mood = normalizeLine(typeof record.mood === 'string' ? record.mood : '', 40);
    if (!mood) continue;
    points.push({
      at: typeof record.at === 'string' ? toIso(record.at) : toIso(),
      mood,
      valence: typeof record.valence === 'number' && Number.isFinite(record.valence)
        ? Math.max(-1, Math.min(1, record.valence))
        : 0,
      arousal: typeof record.arousal === 'number' && Number.isFinite(record.arousal)
        ? Math.max(0, Math.min(1, record.arousal))
        : 0.3,
      reason: normalizeLine(typeof record.reason === 'string' ? record.reason : '', 200),
    });
  }
  return points;
}

function docFromPayload(payload: DataPayload, filePath: string, fallback: ParseFallback): ParsedMemoryDoc | null {
  const now = new Date();
  const scope = typeof payload.scope === 'string' &&
    ['user', 'group', 'global', 'persona'].includes(payload.scope)
    ? (payload.scope as MemoryScopeKind)
    : fallback.scope;
  const scene = typeof payload.scene === 'string' && ['private', 'group', 'global'].includes(payload.scene)
    ? (payload.scene as MemoryScene)
    : fallback.scene;
  const externalId = typeof payload.externalId === 'string' && payload.externalId
    ? payload.externalId
    : fallback.externalId;
  const displayName = typeof payload.displayName === 'string' && payload.displayName
    ? normalizeLine(payload.displayName, 120)
    : fallback.externalId;
  const facts: MemoryFact[] = [];
  if (Array.isArray(payload.facts)) {
    for (const entry of payload.facts) {
      const fact = normalizeLoadedFact(entry, now);
      if (fact) facts.push(fact);
    }
  }
  const extras: MemoryDocExtras = {
    anchors: [],
    episodes: [],
    emotionTrail: [],
    manualNote: '',
    summaryVersion: 0,
  };
  const extrasRecord = typeof payload.extras === 'object' && payload.extras !== null
    ? (payload.extras as Record<string, unknown>)
    : undefined;
  extras.anchors = Array.isArray(extrasRecord?.anchors)
    ? (extrasRecord.anchors as unknown[]).filter((item): item is string => typeof item === 'string').slice(0, 80)
    : [];
  extras.episodes = normalizeLoadedEpisodes(extrasRecord?.episodes);
  extras.emotionTrail = normalizeLoadedEmotionTrail(extrasRecord?.emotionTrail);
  extras.manualNote = typeof extrasRecord?.manualNote === 'string' ? normalizeText(extrasRecord.manualNote, 4000) : '';
  extras.summaryVersion = typeof extrasRecord?.summaryVersion === 'number' && Number.isFinite(extrasRecord.summaryVersion)
    ? Math.max(0, Math.floor(extrasRecord.summaryVersion))
    : 0;

  const id = typeof payload.id === 'string' && payload.id ? payload.id : fallback.id;
  const groupId = typeof payload.groupId === 'string' && payload.groupId
    ? payload.groupId
    : fallback.groupId;
  const groupName = typeof payload.groupName === 'string' && payload.groupName
    ? payload.groupName
    : fallback.groupName;
  const doc: MemoryDoc = {
    id,
    scope,
    externalId,
    displayName,
    scene,
    filePath,
    createdAt: typeof payload.createdAt === 'string' ? toIso(payload.createdAt) : toIso(now),
    updatedAt: typeof payload.updatedAt === 'string' ? toIso(payload.updatedAt) : toIso(now),
    facts,
    relationship: normalizeLoadedRelationship(payload.relationship),
    tags: Array.isArray(payload.tags)
      ? (payload.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string').slice(0, 30)
      : [],
    preview: '',
    messageCount: typeof payload.messageCount === 'number' && Number.isFinite(payload.messageCount)
      ? Math.max(0, Math.round(payload.messageCount))
      : 0,
    episodeCount: typeof payload.episodeCount === 'number' && Number.isFinite(payload.episodeCount)
      ? Math.max(0, Math.round(payload.episodeCount))
      : extras.episodes.length,
  };
  if (typeof payload.avatar === 'string' && payload.avatar) doc.avatar = payload.avatar;
  if (groupId) doc.groupId = groupId;
  if (groupName) doc.groupName = groupName;
  if (payload.pinned === true) doc.pinned = true;
  doc.preview = buildPreview(doc, extras);
  return { doc, extras };
}

// ---------------------------------------------------------------------------
// 章节回退解析（用户手写 / 数据块损坏时）
// ---------------------------------------------------------------------------

function parseBySections(markdown: string, filePath: string, fallback: ParseFallback): ParsedMemoryDoc | null {
  const now = new Date();
  const sections = new Map<string, string[]>();
  let current = '';
  let title = '';
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('# ')) {
      title = title || line.slice(2).split('·')[0]?.trim() || '';
      continue;
    }
    if (line.startsWith('## ')) {
      current = line.slice(3).trim();
      sections.set(current, []);
      continue;
    }
    if (current) sections.get(current)?.push(line);
  }
  const displayName = title || fallback.externalId;
  const facts: MemoryFact[] = [];
  const sectionCategories: Array<[string, FactCategory]> = [
    ['重要事实', 'other'],
    ['偏好与雷区', 'preference'],
    ['共同经历时间线', 'event'],
    ['承诺与待办', 'promise'],
    ['情绪轨迹', 'emotion'],
  ];
  for (const [section, category] of sectionCategories) {
    const lines = sections.get(section) ?? [];
    facts.push(...parseFactLines(lines, category, now));
  }
  const timelineLines = sections.get('共同经历时间线') ?? [];
  const episodes = parseEpisodeLines(timelineLines, now);
  const anchors = parseAnchorLines(sections.get('记忆锚点') ?? []);
  const relationship = parseRelationshipLines(sections.get('关系状态') ?? []);
  const extras: MemoryDocExtras = {
    anchors,
    episodes,
    emotionTrail: [],
    manualNote: '',
    summaryVersion: 0,
  };
  for (const episode of episodes) {
    for (const anchor of episode.anchors) {
      if (!anchors.includes(anchor)) anchors.push(anchor);
    }
  }
  const doc: MemoryDoc = {
    id: fallback.id,
    scope: fallback.scope,
    externalId: fallback.externalId,
    displayName,
    scene: fallback.scene,
    filePath,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    facts,
    relationship,
    tags: [],
    preview: '',
    messageCount: 0,
    episodeCount: episodes.length,
  };
  if (fallback.groupId) doc.groupId = fallback.groupId;
  if (fallback.groupName) doc.groupName = fallback.groupName;
  doc.preview = buildPreview(doc, extras);
  return { doc, extras };
}

function labelToCategory(label: string): FactCategory | undefined {
  const entries = Object.entries(FACT_CATEGORY_LABELS) as Array<[FactCategory, string]>;
  const hit = entries.find(([, text]) => text === label);
  return hit ? hit[0] : undefined;
}

function parseFactLines(lines: readonly string[], defaultCategory: FactCategory, now: Date): MemoryFact[] {
  const facts: MemoryFact[] = [];
  let category = defaultCategory;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('### ')) {
      const heading = line.slice(4);
      if (heading.includes('雷') || heading.includes('边界')) category = 'boundary';
      else if (heading.includes('偏好') || heading.includes('喜欢')) category = 'preference';
      else category = defaultCategory;
      continue;
    }
    if (!line.startsWith('- ')) continue;
    let text = line.slice(2).trim();
    if (!text || text === EMPTY_LINE) continue;
    const manual = text.includes('🔒');
    text = text.split('🔒').join('').trim();
    let parsedCategory = category;
    if (text.startsWith(BACKTICK)) {
      const close = text.indexOf(BACKTICK, 1);
      if (close > 1) {
        const found = labelToCategory(text.slice(1, close));
        if (found) parsedCategory = found;
        text = text.slice(close + 1).trim();
      }
    }
    let weight: number | undefined;
    const weightIndex = text.indexOf('（权重 ');
    if (weightIndex >= 0) {
      const weightMatch = /[0-9]+\.[0-9]+/.exec(text.slice(weightIndex));
      if (weightMatch) weight = Number.parseFloat(weightMatch[0]);
      text = text.slice(0, weightIndex).trim();
    }
    text = normalizeLine(text, 400);
    if (!text) continue;
    const fact: MemoryFact = {
      id: 'fact_section_' + facts.length + '_' + text.length,
      text,
      category: parsedCategory,
      weight: weight !== undefined && Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0.5,
      createdAt: toIso(now),
    };
    if (manual) fact.source = 'manual';
    facts.push(fact);
  }
  return facts;
}

function parseEpisodeLines(lines: readonly string[], now: Date): MemoryEpisode[] {
  const episodes: MemoryEpisode[] = [];
  let pending: MemoryEpisode | undefined;
  let detail: string[] = [];
  const flush = (): void => {
    if (!pending) return;
    pending.detail = normalizeText(detail.join('\n'), 1200);
    episodes.push(pending);
    pending = undefined;
    detail = [];
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = /^- \*\*(.+?)\*\*(.*)$/.exec(line);
    if (heading) {
      flush();
      const head = heading[1] ?? '';
      const rest = (heading[2] ?? '').replace(/^[:：]/, '').trim();
      const parts = head.split('·');
      const at = parts.length > 1 ? parts[0]?.trim() : '';
      const title = (parts.length > 1 ? parts.slice(1).join('·').trim() : head) || rest.slice(0, 40);
      pending = {
        id: 'ep_section_' + episodes.length,
        at: at ? toIso(at) : toIso(now),
        title,
        detail: '',
        anchors: [],
      };
      if (rest) detail.push(rest);
      continue;
    }
    if (!pending) continue;
    if (line.startsWith('> 原话：') || line.startsWith('> 原话:')) {
      const anchor = line
        .replace(/^> 原话[：:]/, '')
        .trim()
        .replace(/^[「『"']+/, '')
        .replace(/[」』"']+$/, '');
      if (anchor) pending.anchors.push(anchor);
      continue;
    }
    if (line) detail.push(line);
  }
  flush();
  return episodes;
}

function parseAnchorLines(lines: readonly string[]): string[] {
  const anchors: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('- ')) continue;
    const anchor = line
      .slice(2)
      .trim()
      .replace(/^[「『"']+/, '')
      .replace(/[」』"']+$/, '');
    if (anchor && anchor !== EMPTY_LINE && !anchors.includes(anchor)) anchors.push(anchor);
  }
  return anchors;
}

function parseRelationshipLines(lines: readonly string[]): RelationshipState {
  const relationship = emptyRelationship();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('- ')) continue;
    for (const axis of RELATIONSHIP_AXES) {
      const label = RELATIONSHIP_AXIS_LABELS[axis];
      if (!line.includes(label + '：') && !line.includes(label + ':')) continue;
      const matches = /[0-9]+/g.exec(line);
      if (matches) relationship[axis] = Math.max(0, Math.min(100, Number.parseInt(matches[0], 10)));
    }
    if (line.includes('最近情绪：')) {
      relationship.lastMood = normalizeLine(line.split('最近情绪：')[1] ?? '', 40);
    }
  }
  return relationship;
}
