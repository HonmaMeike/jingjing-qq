// MemoryRetriever：无外部嵌入的本地检索。
//
// 评分 = 中文 bigram 覆盖率 * bigram 权重 + 关键词命中率 * 关键词权重，
// 再乘以事实权重与按类别的时间衰减，最后加一点点文档新鲜度。
// 隔离：调用方给出 scene + userId(+groupId) 时，只允许当前发言人 / 当前群 / global 三篇文档。
import { groupDocId, memberDocId, userDocId } from './paths';
import { ageInDays, clampNumber, normalizeLine, toDate } from './time';
import { FACT_HALF_LIFE_DAYS, GLOBAL_DOC_ID, MemoryError } from './types';
import type {
  FactCategory,
  MemoryDoc,
  MemoryDocSource,
  MemorySnippet,
  MemorySnippetKind,
  RetrieverOptions,
  RetrieveOptions,
} from './types';

const CJK_RUN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]+/gu;
const LATIN_WORD = /[a-z0-9][a-z0-9_+#.-]*/g;
const SNIPPET_LIMIT = 240;

export interface QueryTokens {
  normalized: string;
  bigrams: string[];
  keywords: string[];
}

export interface RetrieverSource extends MemoryDocSource {}

type ResolvedRetrieverOptions = Required<RetrieverOptions>;

export function normalizeRetrieverOptions(options: RetrieverOptions = {}): ResolvedRetrieverOptions {
  return {
    halfLifeDays: options.halfLifeDays ?? 180,
    bigramWeight: options.bigramWeight ?? 0.6,
    keywordWeight: options.keywordWeight ?? 0.4,
    factWeight: options.factWeight ?? 0.35,
    recencyBoost: options.recencyBoost ?? 0.05,
  };
}

/** 抽取查询词：中文连续串 -> bigram + 整串短语；英文/数字 -> 单词。 */
export function tokenizeQuery(text: string): QueryTokens {
  const normalized = (text ?? '').normalize('NFKC').toLowerCase().trim();
  const bigrams = new Set<string>();
  const keywords = new Set<string>();
  for (const run of normalized.match(CJK_RUN) ?? []) {
    const chars = Array.from(run);
    if (chars.length === 1) bigrams.add(chars[0] as string);
    for (let index = 0; index + 1 < chars.length; index += 1) {
      bigrams.add((chars[index] as string) + (chars[index + 1] as string));
    }
    if (chars.length >= 2 && chars.length <= 8) keywords.add(run);
  }
  for (const word of normalized.match(LATIN_WORD) ?? []) {
    if (word.length >= 2) keywords.add(word);
  }
  return { normalized, bigrams: [...bigrams], keywords: [...keywords] };
}

export function hasQueryTokens(tokens: QueryTokens): boolean {
  return tokens.bigrams.length > 0 || tokens.keywords.length > 0;
}

export interface ScoreCandidateInput {
  weight: number;
  category?: FactCategory;
  createdAt?: string;
  kind: MemorySnippetKind;
}

/** 单个片段的评分（0..1 量级）。 */
export function scoreCandidate(
  query: QueryTokens,
  text: string,
  input: ScoreCandidateInput,
  now: Date,
  options: ResolvedRetrieverOptions = normalizeRetrieverOptions(),
): number {
  const lowerText = text.normalize('NFKC').toLowerCase();
  if (!lowerText) return 0;
  const halfLife = input.category ? FACT_HALF_LIFE_DAYS[input.category] : options.halfLifeDays;
  const decay = Math.max(0.05, Math.pow(0.5, ageInDays(input.createdAt, now) / Math.max(1, halfLife)));
  const weightFactor = 1 - options.factWeight + options.factWeight * clampNumber(input.weight, 0, 1);
  if (!hasQueryTokens(query)) {
    return (0.35 + 0.65 * clampNumber(input.weight, 0, 1)) * decay;
  }
  const candidateTokens = tokenizeQuery(lowerText);
  const candidateBigrams = new Set(candidateTokens.bigrams);
  let bigramHits = 0;
  for (const bigram of query.bigrams) {
    if (candidateBigrams.has(bigram)) bigramHits += 1;
  }
  const coverage = query.bigrams.length > 0 ? bigramHits / query.bigrams.length : 0;
  let keywordHits = 0;
  for (const keyword of query.keywords) {
    if (lowerText.includes(keyword)) keywordHits += 1;
  }
  const keywordScore = query.keywords.length > 0 ? keywordHits / query.keywords.length : 0;
  const lexical = coverage * options.bigramWeight + keywordScore * options.keywordWeight;
  if (lexical <= 0) return 0;
  return lexical * weightFactor * decay;
}

export interface AllowedDocsInput {
  userId: string;
  groupId?: string;
  scene?: RetrieveOptions['scene'];
}

/**
 * 场景隔离白名单：
 * - 群聊：global + 当前群 + 当前发言人（不含其他群、不含其他群成员、不含私聊记忆）；
 * - 私聊：global + 当前联系人（不含任何群文档与别的用户文档）；
 * - global：只允许 global。
 */
export function allowedMemoryDocIds(input: AllowedDocsInput, platform?: string): string[] {
  const scene = input.scene;
  const isGroup = scene === 'group' || (scene === undefined && input.groupId !== undefined);
  if (isGroup) {
    if (!input.groupId) {
      throw new MemoryError('missing_group_context', '群聊记忆检索必须提供 groupId');
    }
    return [GLOBAL_DOC_ID, groupDocId(input.groupId, platform), memberDocId(input.groupId, input.userId, platform)];
  }
  if (scene === 'global') return [GLOBAL_DOC_ID];
  return [GLOBAL_DOC_ID, userDocId(input.userId, platform)];
}

/** 结合显式白名单与场景隔离，取交集（显式白名单只能收窄，不能越权扩大）。 */
export function resolveAllowedDocIds(options: RetrieveOptions, platform?: string): string[] | undefined {
  let allowed: string[] | undefined = options.docIds ? [...options.docIds] : undefined;
  if (options.scene !== undefined && options.userId) {
    const contextual = allowedMemoryDocIds(
      { userId: options.userId, groupId: options.groupId, scene: options.scene },
      platform,
    );
    allowed = allowed ? allowed.filter((id) => contextual.includes(id)) : contextual;
  } else if (options.groupId !== undefined && options.userId) {
    const contextual = allowedMemoryDocIds({ userId: options.userId, groupId: options.groupId }, platform);
    allowed = allowed ? allowed.filter((id) => contextual.includes(id)) : contextual;
  }
  if (allowed && options.includeGlobal === false) {
    allowed = allowed.filter((id) => id !== GLOBAL_DOC_ID);
  }
  return allowed;
}

function makeSnippet(text: string): string {
  const single = normalizeLine(text, SNIPPET_LIMIT * 2);
  return single.length > SNIPPET_LIMIT ? single.slice(0, SNIPPET_LIMIT - 3) + '…' : single;
}

interface Candidate {
  kind: MemorySnippetKind;
  text: string;
  weight: number;
  category?: FactCategory;
  createdAt?: string;
  factId?: string;
}

function collectCandidates(doc: MemoryDoc, source: MemoryDocSource): Candidate[] {
  const candidates: Candidate[] = [];
  for (const fact of doc.facts) {
    candidates.push({
      kind: 'fact',
      text: fact.text,
      weight: fact.weight,
      category: fact.category,
      createdAt: fact.createdAt,
      factId: fact.id,
    });
  }
  const extras = source.getExtras(doc.id);
  if (!extras) return candidates;
  for (const episode of extras.episodes) {
    const base = [episode.title, episode.detail].filter((part) => part.length > 0).join('。');
    const anchorText = episode.anchors.length > 0 ? '原话：' + episode.anchors.join('；') : '';
    const text = base && anchorText ? base + ' ' + anchorText : base || anchorText;
    if (!text) continue;
    candidates.push({
      kind: 'episode',
      text,
      weight: 0.75,
      createdAt: episode.at,
    });
  }
  for (const anchor of extras.anchors) {
    candidates.push({ kind: 'quote', text: anchor, weight: 0.7 });
  }
  return candidates;
}

export class MemoryRetriever {
  private readonly options: ResolvedRetrieverOptions;

  constructor(
    private readonly source: MemoryDocSource,
    options: RetrieverOptions = {},
  ) {
    this.options = normalizeRetrieverOptions(options);
  }

  /** 返回 topK 记忆片段；无命中时返回空数组。 */
  retrieve(query: string, options: RetrieveOptions = {}): MemorySnippet[] {
    const now = toDate(options.now);
    const topK = Math.max(1, options.topK ?? 6);
    const maxPerDoc = Math.max(1, options.maxPerDoc ?? 3);
    const minScore = options.minScore ?? 0;
    const tokens = tokenizeQuery(query);
    const allowed = resolveAllowedDocIds(options, this.source.platform);
    const scopeFilter = options.scope === undefined
      ? undefined
      : typeof options.scope === 'string'
        ? [options.scope]
        : [...options.scope];

    const docs = this.source.listDocs(scopeFilter ? { scope: scopeFilter } : {});
    const hits: MemorySnippet[] = [];
    for (const doc of docs) {
      if (allowed && !allowed.includes(doc.id)) continue;
      const candidates = collectCandidates(doc, this.source);
      if (candidates.length === 0) continue;
      const docRecency = Math.exp(-ageInDays(doc.updatedAt, now) / 30);
      const scored: Array<{ candidate: Candidate; score: number }> = [];
      for (const candidate of candidates) {
        const base = scoreCandidate(tokens, candidate.text, candidate, now, this.options);
        const score = base > 0 ? base + this.options.recencyBoost * docRecency : 0;
        if (score <= 0) continue;
        const snippet = makeSnippet(candidate.text);
        if (!snippet) continue;
        scored.push({ candidate: { ...candidate, text: snippet }, score });
      }
      scored.sort((left, right) => right.score - left.score);
      const taken = scored.slice(0, maxPerDoc);
      for (const entry of taken) {
        if (entry.score < minScore) continue;
        const snippet: MemorySnippet = {
          docId: doc.id,
          displayName: doc.displayName,
          scope: doc.scope,
          kind: entry.candidate.kind,
          snippet: entry.candidate.text,
          score: Math.round(entry.score * 1000) / 1000,
        };
        if (entry.candidate.factId) snippet.factId = entry.candidate.factId;
        if (entry.candidate.category) snippet.category = entry.candidate.category;
        if (entry.candidate.createdAt) snippet.createdAt = entry.candidate.createdAt;
        hits.push(snippet);
      }
    }
    hits.sort((left, right) => right.score - left.score);
    return hits.slice(0, topK);
  }
}
