// 记忆文档的纯变更操作：不碰文件系统，便于 MemoryStore / MemoryExtractor 复用与单测。
import { sha1Short } from './fsutil';
import { clampNumber, normalizeLine, normalizeText, toIso } from './time';
import type {
  EmotionInput,
  EpisodeInput,
  FactCategory,
  FactInput,
  FactMergeOutcome,
  MemoryDoc,
  MemoryDocExtras,
  MemoryEpisode,
  MemoryEmotionPoint,
  MemoryFact,
  RelationshipState,
  RelationshipUpdate,
} from './types';
import { RELATIONSHIP_AXES } from './types';

/** 各类型事实的默认权重：越稳定、越重要的类别权重越高。 */
export const DEFAULT_FACT_WEIGHT: Record<FactCategory, number> = {
  identity: 0.85,
  preference: 0.7,
  boundary: 0.9,
  event: 0.6,
  promise: 0.8,
  emotion: 0.5,
  other: 0.5,
};

export const MAX_FACTS = 400;
export const MAX_ANCHORS = 80;
export const MAX_EPISODES = 120;
export const MAX_EMOTION_POINTS = 60;
export const MAX_RELATIONSHIP_NOTES = 40;
export const FACT_SIMILARITY_THRESHOLD = 0.82;

export function createMemoryFact(input: FactInput, now: Date = new Date()): MemoryFact {
  const category: FactCategory = input.category ?? 'other';
  const createdAt = input.createdAt ? toIso(input.createdAt) : toIso(now);
  const text = normalizeLine(input.text, 400);
  return {
    id: 'fact_' + sha1Short(text + '|' + createdAt + '|' + Math.random().toString(36)),
    text,
    category,
    weight: clampNumber(input.weight ?? DEFAULT_FACT_WEIGHT[category], 0, 1),
    createdAt,
    source: input.source ?? 'auto',
  };
}

export function normalizeFactText(text: string): string {
  return normalizeLine(text, 400);
}

/** 事实去重键：只保留字母/数字，屏蔽标点与空格差异。 */
export function factKey(text: string): string {
  return normalizeFactText(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 字符 bigram 集合（中文按字切分，英文/数字按字面也适用）。 */
export function charBigrams(text: string): Set<string> {
  const chars = Array.from(text);
  const grams = new Set<string>();
  if (chars.length === 0) return grams;
  if (chars.length === 1) {
    grams.add(chars[0] as string);
    return grams;
  }
  for (let index = 0; index + 1 < chars.length; index += 1) {
    grams.add((chars[index] as string) + (chars[index + 1] as string));
  }
  return grams;
}

/** 0..1 的事实相似度（按较短一方做包含度，短事实并入长事实时更稳）。 */
export function factSimilarity(left: string, right: string): number {
  const a = factKey(left);
  const b = factKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aGrams = charBigrams(a);
  const bGrams = charBigrams(b);
  const minSize = Math.min(aGrams.size, bGrams.size);
  if (minSize === 0) return 0;
  let intersection = 0;
  for (const gram of aGrams) {
    if (bGrams.has(gram)) intersection += 1;
  }
  return intersection / minSize;
}

export interface MergeFactsOptions {
  /** 手动事实（source=manual）是否受保护，默认 true。 */
  protectManual?: boolean;
  /** 新事实来源标记。 */
  source?: string;
  maxFacts?: number;
}

export interface MergeFactsSummary {
  added: MemoryFact[];
  updated: MemoryFact[];
  skipped: FactMergeOutcome[];
}

/**
 * 合并单条事实：
 * - 完全相同 / 高度相似：自动事实会取更详细的文本并提升权重；
 * - 手动事实（🔒）永不改写、永不删除；
 * - 新事实按来源追加，超过上限时优先丢弃权重最低的自动事实。
 */
export function mergeFact(
  doc: MemoryDoc,
  input: FactInput,
  now: Date = new Date(),
  options: MergeFactsOptions = {},
): FactMergeOutcome {
  const text = normalizeFactText(input.text);
  if (!text) {
    return {
      status: 'skipped',
      fact: createMemoryFact({ text: '', category: 'other', weight: 0 }, now),
      reason: 'empty',
    };
  }
  const protectManual = options.protectManual !== false;
  let best: MemoryFact | undefined;
  let bestScore = 0;
  for (const fact of doc.facts) {
    const score = factSimilarity(fact.text, text);
    if (score > bestScore) {
      bestScore = score;
      best = fact;
    }
  }
  if (best && bestScore >= FACT_SIMILARITY_THRESHOLD) {
    if (best.source === 'manual' && protectManual) {
      return { status: 'skipped', fact: cloneFact(best), existingId: best.id, reason: 'manual_protected' };
    }
    if (text.length > best.text.length + 2) best.text = text;
    best.weight = Math.max(best.weight, clampNumber(input.weight ?? DEFAULT_FACT_WEIGHT[input.category ?? 'other'], 0, 1));
    if (input.category && input.category !== 'other') best.category = input.category;
    return { status: 'updated', fact: cloneFact(best), existingId: best.id };
  }
  const fact = createMemoryFact(
    {
      text,
      category: input.category,
      weight: input.weight,
      source: input.source ?? options.source ?? 'auto',
      createdAt: input.createdAt,
    },
    now,
  );
  doc.facts.push(fact);
  const maxFacts = options.maxFacts ?? MAX_FACTS;
  if (doc.facts.length > maxFacts) {
    evictFacts(doc, doc.facts.length - maxFacts);
  }
  return { status: 'added', fact: cloneFact(fact) };
}

export function mergeFacts(
  doc: MemoryDoc,
  inputs: readonly FactInput[],
  now: Date = new Date(),
  options: MergeFactsOptions = {},
): MergeFactsSummary {
  const added: MemoryFact[] = [];
  const updated: MemoryFact[] = [];
  const skipped: FactMergeOutcome[] = [];
  for (const input of inputs) {
    const outcome = mergeFact(doc, input, now, options);
    if (outcome.status === 'added') added.push(outcome.fact);
    else if (outcome.status === 'updated') updated.push(outcome.fact);
    else skipped.push(outcome);
  }
  return { added, updated, skipped };
}

function evictFacts(doc: MemoryDoc, count: number): void {
  let remaining = count;
  while (remaining > 0) {
    let index = -1;
    for (let cursor = 0; cursor < doc.facts.length; cursor += 1) {
      const fact = doc.facts[cursor] as MemoryFact;
      if (fact.source === 'manual') continue;
      if (index === -1 || fact.weight < (doc.facts[index] as MemoryFact).weight) index = cursor;
    }
    if (index === -1) break;
    doc.facts.splice(index, 1);
    remaining -= 1;
  }
}

function cloneFact(fact: MemoryFact): MemoryFact {
  return { ...fact };
}

function normalizeAnchors(quotes: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of quotes) {
    let quote = normalizeLine(raw, 300);
    if (!quote) continue;
    quote = quote.replace(/^[「『"'"'']+/, '').replace(/[」』"'"'']+$/, '').trim();
    if (quote.length < 2) continue;
    const key = factKey(quote) || quote;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(quote);
  }
  return result;
}

export function addAnchors(extras: MemoryDocExtras, quotes: readonly string[]): string[] {
  const added: string[] = [];
  const existing = new Set(extras.anchors.map((anchor) => factKey(anchor) || anchor));
  for (const quote of normalizeAnchors(quotes)) {
    const key = factKey(quote) || quote;
    if (existing.has(key)) continue;
    existing.add(key);
    extras.anchors.push(quote);
    added.push(quote);
  }
  if (extras.anchors.length > MAX_ANCHORS) {
    extras.anchors.splice(0, extras.anchors.length - MAX_ANCHORS);
  }
  return added;
}

/** 追加/合并一条共同经历；同一天高度相似的标题视为同一条，只补细节。 */
export function addEpisode(
  extras: MemoryDocExtras,
  input: EpisodeInput,
  now: Date = new Date(),
): MemoryEpisode | undefined {
  const title = normalizeLine(input.title, 120);
  const detail = normalizeText(input.detail ?? '', 1200);
  if (!title && !detail) return undefined;
  const at = input.at ? toIso(input.at) : toIso(now);
  const anchors = normalizeAnchors(input.anchors ?? []);
  const day = at.slice(0, 10);
  const duplicate = extras.episodes.find(
    (episode) => episode.at.slice(0, 10) === day && factSimilarity(episode.title, title) >= 0.82,
  );
  if (duplicate) {
    if (detail.length > duplicate.detail.length) duplicate.detail = detail;
    for (const anchor of anchors) {
      if (!duplicate.anchors.includes(anchor)) duplicate.anchors.push(anchor);
    }
    addAnchors(extras, anchors);
    return duplicate;
  }
  const episode: MemoryEpisode = {
    id: 'ep_' + sha1Short(at + '|' + title + '|' + extras.episodes.length + '|' + Math.random().toString(36)),
    at,
    title: title || detail.slice(0, 40),
    detail,
    anchors,
  };
  extras.episodes.push(episode);
  if (extras.episodes.length > MAX_EPISODES) {
    extras.episodes.splice(0, extras.episodes.length - MAX_EPISODES);
  }
  addAnchors(extras, anchors);
  return episode;
}

export function appendEmotionPoint(
  doc: MemoryDoc,
  extras: MemoryDocExtras,
  input: EmotionInput,
  now: Date = new Date(),
): MemoryEmotionPoint | undefined {
  const mood = normalizeLine(input.mood, 40);
  if (!mood) return undefined;
  const point: MemoryEmotionPoint = {
    at: input.at ? toIso(input.at) : toIso(now),
    mood,
    valence: clampNumber(input.valence ?? 0, -1, 1),
    arousal: clampNumber(input.arousal ?? 0.3, 0, 1),
    reason: normalizeLine(input.reason ?? '', 200),
  };
  const last = extras.emotionTrail[extras.emotionTrail.length - 1];
  const sameMoment = last !== undefined && last.mood === point.mood && last.reason === point.reason &&
    Math.abs(Date.parse(last.at) - Date.parse(point.at)) < 60 * 60 * 1000;
  if (!sameMoment) {
    extras.emotionTrail.push(point);
    if (extras.emotionTrail.length > MAX_EMOTION_POINTS) {
      extras.emotionTrail.splice(0, extras.emotionTrail.length - MAX_EMOTION_POINTS);
    }
  }
  doc.relationship.lastMood = mood;
  return sameMoment ? last : point;
}

export function addNote(relationship: RelationshipState, note: string): void {
  const clean = normalizeLine(note, 300);
  if (!clean) return;
  if (relationship.notes.some((existing) => factKey(existing) === factKey(clean))) return;
  relationship.notes.push(clean);
  if (relationship.notes.length > MAX_RELATIONSHIP_NOTES) {
    relationship.notes.splice(0, relationship.notes.length - MAX_RELATIONSHIP_NOTES);
  }
}

/** 应用关系变化：增量 clamp 到 0..100，交互次数与最近互动时间自动推进。 */
export function applyRelationshipUpdate(
  doc: MemoryDoc,
  update: RelationshipUpdate,
  now: Date = new Date(),
): RelationshipState {
  const relationship = doc.relationship;
  if (update.deltas) {
    for (const axis of RELATIONSHIP_AXES) {
      const delta = update.deltas[axis];
      if (typeof delta === 'number' && Number.isFinite(delta)) {
        relationship[axis] = clampNumber(relationship[axis] + delta, 0, 100);
      }
    }
  }
  const set = update.set;
  if (set) {
    for (const axis of RELATIONSHIP_AXES) {
      const value = set[axis];
      if (typeof value === 'number' && Number.isFinite(value)) {
        relationship[axis] = clampNumber(value, 0, 100);
      }
    }
    if (typeof set.interactions === 'number' && Number.isFinite(set.interactions)) {
      relationship.interactions = Math.max(0, Math.round(set.interactions));
    }
    if (typeof set.streakDays === 'number' && Number.isFinite(set.streakDays)) {
      relationship.streakDays = Math.max(0, Math.round(set.streakDays));
    }
    if (typeof set.firstMetAt === 'string' && set.firstMetAt) {
      relationship.firstMetAt = toIso(set.firstMetAt);
    }
    if (typeof set.lastInteractionAt === 'string' && set.lastInteractionAt) {
      relationship.lastInteractionAt = toIso(set.lastInteractionAt);
    }
    if (typeof set.lastMood === 'string' && set.lastMood) {
      relationship.lastMood = normalizeLine(set.lastMood, 40);
    }
  }
  if (typeof update.streakDays === 'number' && Number.isFinite(update.streakDays)) {
    relationship.streakDays = Math.max(0, Math.round(update.streakDays));
  }
  if (update.mood) {
    relationship.lastMood = normalizeLine(update.mood, 40);
  }
  if (update.note) {
    addNote(relationship, update.note);
  }
  if (update.touch !== false) {
    relationship.interactions += 1;
    relationship.lastInteractionAt = toIso(now);
  }
  return relationship;
}

/** 确保 extras 的所有字段存在且类型正确（用于旧文档/手写文档兜底）。 */
export function normalizeExtras(input: Partial<MemoryDocExtras> | undefined): MemoryDocExtras {
  return {
    anchors: Array.isArray(input?.anchors) ? input.anchors.filter((item): item is string => typeof item === 'string') : [],
    episodes: Array.isArray(input?.episodes) ? input.episodes : [],
    emotionTrail: Array.isArray(input?.emotionTrail) ? input.emotionTrail : [],
    manualNote: typeof input?.manualNote === 'string' ? input.manualNote : '',
    summaryVersion: typeof input?.summaryVersion === 'number' && Number.isFinite(input.summaryVersion)
      ? Math.max(0, Math.floor(input.summaryVersion))
      : 0,
  };
}
