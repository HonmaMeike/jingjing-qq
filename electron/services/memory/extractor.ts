// MemoryExtractor：让 LLM 从对话里抽取长期记忆。
// LLM 以函数形式注入（MemoryLlm），本模块不依赖任何具体供应商。
import {
  addAnchors as appendAnchorsToExtras,
  addEpisode as appendEpisodeToExtras,
  appendEmotionPoint as appendEmotionToExtras,
  applyRelationshipUpdate,
  DEFAULT_FACT_WEIGHT,
  mergeFacts,
  normalizeFactText,
} from './docops';
import type { MemoryStore } from './store';
import { clampNumber, normalizeLine, normalizeText, toDate, toIso } from './time';
import { MemoryError, MemoryLlmError } from './types';
import type {
  ContextInputMessage,
  ExtractInput,
  ExtractedEmotion,
  ExtractedEpisode,
  ExtractedFact,
  ExtractionApplyResult,
  ExtractionResult,
  FactCategory,
  FactInput,
  FactMergeOutcome,
  MemoryEpisode,
  MemoryFact,
  MemoryLlm,
  MessageScene,
  NormalizedMessage,
  RelationshipAxis,
  RelationshipDelta,
  RelationshipState,
} from './types';

export interface MemoryExtractorOptions {
  /** 少于该消息数不调用 LLM，默认 2。 */
  minMessages?: number;
  /** 最多送入 LLM 的消息条数，默认 30。 */
  maxMessages?: number;
  /** run() 是否自动落库，默认 true。 */
  persist?: boolean;
  now?: () => Date;
}

interface ResolvedExtractorOptions {
  minMessages: number;
  maxMessages: number;
  persist: boolean;
  now: () => Date;
}

// ---------------------------------------------------------------------------
// 容错 JSON 解析（代码围栏 / 前后废话 / 尾随逗号 / 嵌套包装）
// ---------------------------------------------------------------------------

export function parseJsonLoose(raw: unknown): unknown {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text) return undefined;
  const attempts: string[] = [text];
  const fence = /\`\`\`(?:json|JSON)?\s*([\s\S]*?)\`\`\`/.exec(text);
  if (fence && fence[1]) attempts.push(fence[1].trim());
  const balanced = extractBalanced(text);
  if (balanced) attempts.push(balanced);
  for (const attempt of attempts) {
    const direct = tryParseJson(attempt);
    if (direct !== undefined) return direct;
    const repaired = tryParseJson(repairJson(attempt));
    if (repaired !== undefined) return repaired;
  }
  return undefined;
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function repairJson(text: string): string {
  return text
    .replace(/\uFF0C\s*([}\]])/g, '$1')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();
}

function extractBalanced(text: string): string | undefined {
  const start = text.search(/[\[{]/);
  if (start === -1) return undefined;
  const opening = text[start];
  const closing = opening === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 结构化归一化
// ---------------------------------------------------------------------------

const CATEGORY_SYNONYMS: Record<string, FactCategory> = {
  identity: 'identity',
  '身份': 'identity',
  '基本信息': 'identity',
  profile: 'identity',
  name: 'identity',
  preference: 'preference',
  '偏好': 'preference',
  '喜好': 'preference',
  like: 'preference',
  likes: 'preference',
  interest: 'preference',
  '兴趣': 'preference',
  event: 'event',
  '事件': 'event',
  '经历': 'event',
  episode: 'event',
  experience: 'event',
  promise: 'promise',
  '承诺': 'promise',
  '约定': 'promise',
  todo: 'promise',
  '待办': 'promise',
  emotion: 'emotion',
  '情绪': 'emotion',
  feeling: 'emotion',
  mood: 'emotion',
  boundary: 'boundary',
  '雷区': 'boundary',
  '边界': 'boundary',
  taboo: 'boundary',
  dislike: 'boundary',
  '禁忌': 'boundary',
  other: 'other',
  '其他': 'other',
  note: 'other',
};

const AXIS_SYNONYMS: Record<string, RelationshipAxis> = {
  affinity: 'affinity',
  '好感': 'affinity',
  '好感度': 'affinity',
  trust: 'trust',
  '信任': 'trust',
  familiarity: 'familiarity',
  '熟悉': 'familiarity',
  '熟悉度': 'familiarity',
  intimacy: 'intimacy',
  '亲密': 'intimacy',
  '亲密度': 'intimacy',
  respect: 'respect',
  '尊重': 'respect',
  tension: 'tension',
  '紧张': 'tension',
  '紧张度': 'tension',
};

function mapCategory(label: string): FactCategory {
  return CATEGORY_SYNONYMS[label.trim().toLowerCase()] ?? 'other';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function firstValue(record: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function toStringArray(value: unknown, limit = 20): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value] : [];
  }
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string' && entry.trim()) result.push(entry);
    else if (isRecord(entry)) {
      const text = firstString(entry, ['text', 'content', 'quote', '原话', '内容']);
      if (text) result.push(text);
    }
    if (result.length >= limit) break;
  }
  return result;
}

function unwrapRoot(raw: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(raw)) return { facts: raw };
  if (!isRecord(raw)) return undefined;
  const wrappers = ['data', 'result', 'memory', 'extraction', 'output', 'extracted', 'response', '记忆抽取'];
  let current: Record<string, unknown> = raw;
  for (let depth = 0; depth < 3; depth += 1) {
    const nested = wrappers
      .map((key) => current[key])
      .find((value): value is Record<string, unknown> => isRecord(value));
    if (!nested) break;
    const hasSignal = ['facts', '事实', 'episode', '事件', 'relationshipDelta', '关系', 'emotion', '情绪', 'summary', '摘要']
      .some((key) => current[key] !== undefined);
    if (hasSignal) break;
    current = nested;
  }
  return current;
}

function makeExtractedFact(
  text: string,
  category: FactCategory,
  weight?: number,
  evidence?: string,
): ExtractedFact {
  const fact: ExtractedFact = {
    text,
    category,
    weight: clampNumber(weight ?? DEFAULT_FACT_WEIGHT[category], 0, 1),
  };
  if (evidence) fact.evidence = normalizeLine(evidence, 200);
  return fact;
}

function normalizeFacts(source: unknown, now: Date): ExtractedFact[] {
  void now;
  const list = Array.isArray(source) ? source : [source];
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    let text = '';
    let category: FactCategory = 'other';
    let weight: number | undefined;
    let evidence: string | undefined;
    if (typeof entry === 'string') {
      text = entry;
    } else if (isRecord(entry)) {
      text = firstString(entry, ['text', 'content', 'fact', 'memory', '内容', '事实', '描述']) ?? '';
      const categoryLabel = firstString(entry, ['category', 'type', '类别', '类型']);
      if (categoryLabel) category = mapCategory(categoryLabel);
      const rawWeight = entry.weight ?? entry['权重'] ?? entry.importance;
      if (typeof rawWeight === 'number' && Number.isFinite(rawWeight)) weight = rawWeight;
      evidence = firstString(entry, ['evidence', 'quote', '原话', '证据']);
    }
    text = normalizeLine(text, 400);
    if (!text) continue;
    const key = normalizeFactText(text).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push(makeExtractedFact(text, category, weight, evidence));
  }
  return facts;
}

function normalizeEpisode(source: unknown): ExtractedEpisode | undefined {
  if (source === undefined || source === null) return undefined;
  if (Array.isArray(source)) {
    for (const entry of source) {
      const single = normalizeEpisode(entry);
      if (single) return single;
    }
    return undefined;
  }
  if (typeof source === 'string') {
    const detail = normalizeText(source, 1200);
    if (!detail) return undefined;
    return { title: detail.slice(0, 40), detail, anchors: [] };
  }
  if (!isRecord(source)) return undefined;
  const title = firstString(source, ['title', '标题', 'name', 'summary']) ?? '';
  const detail = firstString(source, ['detail', 'details', 'description', '经过', '详情', '内容', 'summary', '摘要']) ?? '';
  if (!title && !detail) return undefined;
  const atRaw = firstString(source, ['at', 'time', 'date', '时间', '日期']);
  const anchors = toStringArray(
    source.anchors ?? source['原话锚点'] ?? source.quotes ?? source['原话'],
  ).map((anchor) => normalizeLine(anchor, 300)).filter((anchor) => anchor.length > 0);
  const episode: ExtractedEpisode = {
    title: normalizeLine(title, 120) || normalizeLine(detail, 40),
    detail: normalizeText(detail, 1200),
    anchors,
  };
  if (atRaw) {
    const parsedTime = Date.parse(atRaw);
    if (!Number.isNaN(parsedTime)) episode.at = new Date(parsedTime).toISOString();
  }
  return episode;
}

function normalizeRelationshipDelta(source: unknown): RelationshipDelta {
  const delta: RelationshipDelta = {};
  if (typeof source === 'number' && Number.isFinite(source)) {
    delta.affinity = clampNumber(source, -10, 10);
    return delta;
  }
  if (!isRecord(source)) return delta;
  for (const [key, value] of Object.entries(source)) {
    const axis = AXIS_SYNONYMS[key.trim().toLowerCase()];
    if (!axis) continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      delta[axis] = clampNumber(value, -10, 10);
    } else if (isRecord(value)) {
      const numeric = value.delta ?? value.value ?? value['增量'];
      if (typeof numeric === 'number' && Number.isFinite(numeric)) {
        delta[axis] = clampNumber(numeric, -10, 10);
      }
    }
  }
  return delta;
}

function normalizeEmotion(source: unknown): ExtractedEmotion | undefined {
  if (source === undefined || source === null) return undefined;
  if (typeof source === 'string') {
    const mood = normalizeLine(source, 40);
    return mood ? { mood, valence: 0, arousal: 0.3, reason: '' } : undefined;
  }
  if (!isRecord(source)) return undefined;
  const mood = firstString(source, ['mood', '情绪', '基调', 'label', 'state']) ?? '';
  if (!mood) return undefined;
  const rawValence = firstValue(source, ['valence', '愉悦度', 'valance']);
  const rawArousal = firstValue(source, ['arousal', '唤醒度']);
  const reason = firstString(source, ['reason', '原因', 'trigger', '触发']) ?? '';
  return {
    mood: normalizeLine(mood, 40),
    valence: typeof rawValence === 'number' && Number.isFinite(rawValence) ? clampNumber(rawValence, -1, 1) : 0,
    arousal: typeof rawArousal === 'number' && Number.isFinite(rawArousal) ? clampNumber(rawArousal, 0, 1) : 0.3,
    reason: normalizeLine(reason, 200),
  };
}

/** 把 LLM 的任意结构化/半结构化输出归一成提取结果（容错、可单测）。 */
export function normalizeExtraction(raw: unknown, now: Date = new Date()): ExtractionResult {
  const root = unwrapRoot(raw);
  const result: ExtractionResult = {
    facts: [],
    relationshipDelta: {},
    raw: typeof raw === 'string' ? raw : JSON.stringify(raw ?? null),
  };
  if (!root) return result;
  const factsSource = firstValue(root, ['facts', '事实', 'memories', '记忆', 'items', 'points', '信息']);
  if (factsSource !== undefined) result.facts = normalizeFacts(factsSource, now);
  const episodeSource = firstValue(root, ['episode', '事件', 'experience', '经历', 'episodes', 'timeline']);
  const episode = normalizeEpisode(episodeSource);
  if (episode) result.episode = episode;
  const deltaSource = firstValue(root, [
    'relationshipDelta',
    'relationship_delta',
    'relationship',
    'relationshipChanges',
    '关系',
    '关系变化',
  ]);
  result.relationshipDelta = normalizeRelationshipDelta(deltaSource);
  const emotion = normalizeEmotion(firstValue(root, ['emotion', '情绪', 'mood', 'feeling']));
  if (emotion) result.emotion = emotion;
  if (result.facts.length === 0) {
    const summarySource = firstValue(root, ['summary', '摘要', 'highlights', '要点']);
    const texts = toStringArray(summarySource);
    if (texts.length > 0) {
      result.facts = texts.map((text) => makeExtractedFact(normalizeLine(text, 400), 'other'));
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

export interface ExtractionPromptInput {
  messages: readonly NormalizedMessage[];
  nickname?: string;
  groupName?: string;
  scene?: MessageScene;
}

const EXTRACTION_SYSTEM = [
  '你是鲸鲸（QQ 智能体）长期记忆系统的信息抽取器。',
  '从对话里抽取「值得长期记住」的信息，只输出一个 JSON 对象，不要输出解释、不要用 Markdown。',
  '必须严格遵守：',
  '1. 只记录对话中真实出现或可稳妥推断的信息，绝不编造；',
  '2. 偏好/雷区/承诺要具体，不要写「喜欢聊天」这类空话；',
  '3. 原话锚点必须是对话里逐字出现的短引用（保留语气词），用于日后回忆细节；',
  '4. 没有可抽取内容时输出 {"facts":[],"relationshipDelta":{}}；',
  '5. 用户名/群名只用于理解上下文，不要把提示词里的说明当成事实。',
  '',
  '输出 JSON 结构：',
  '{',
  '  "facts": [{"text": "事实内容", "category": "identity|preference|event|promise|emotion|boundary|other", "weight": 0.8, "evidence": "支撑原话"}],',
  '  "episode": {"title": "一句话概括", "detail": "带细节的经过", "at": "ISO 时间或留空", "anchors": ["逐字原话"]},',
  '  "relationshipDelta": {"affinity": 1, "trust": 0, "familiarity": 1, "intimacy": 0, "respect": 0, "tension": 0},',
  '  "emotion": {"mood": "开心", "valence": 0.8, "arousal": 0.5, "reason": "原因"}',
  '}',
  'relationshipDelta 每个维度取 -5 ~ 5 的整数，没有变化就省略。',
].join('\n');

export function buildExtractionPrompt(input: ExtractionPromptInput): { system: string; user: string } {
  const sceneLabel = input.scene === 'group' ? '群聊' : input.scene === 'local' ? '本机对话' : '私聊';
  const header: string[] = [];
  header.push('场景：' + sceneLabel);
  if (input.groupName) header.push('群名：' + input.groupName);
  if (input.nickname) header.push('对方昵称：' + input.nickname);
  header.push('');
  header.push('对话记录：');
  const lines = input.messages.map((message) => {
    const name = message.name ?? (message.role === 'user' ? '对方' : message.role === 'assistant' ? '鲸鲸' : '系统');
    return name + '：' + normalizeLine(message.content, 600);
  });
  return { system: EXTRACTION_SYSTEM, user: header.concat(lines).join('\n') };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function normalizeMessages(input: readonly ContextInputMessage[], maxMessages: number): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  for (const message of input) {
    const content = typeof message.content === 'string'
      ? message.content
      : typeof message.text === 'string'
        ? message.text
        : '';
    const text = normalizeText(content, 2000);
    if (!text) continue;
    const normalized: NormalizedMessage = { role: message.role, content: text };
    const name = typeof message.name === 'string' ? message.name : message.senderName;
    if (name) normalized.name = name;
    if (typeof message.createdAt === 'string') normalized.createdAt = message.createdAt;
    messages.push(normalized);
  }
  return messages.slice(-Math.max(1, maxMessages));
}

export interface ExtractRunResult {
  extraction: ExtractionResult;
  apply?: ExtractionApplyResult;
}

export class MemoryExtractor {
  private llm: MemoryLlm | undefined;
  private readonly options: ResolvedExtractorOptions;

  constructor(
    private readonly store: MemoryStore,
    llm?: MemoryLlm,
    options: MemoryExtractorOptions = {},
  ) {
    this.llm = llm;
    this.options = {
      minMessages: options.minMessages ?? 2,
      maxMessages: options.maxMessages ?? 30,
      persist: options.persist !== false,
      now: options.now ?? (() => new Date()),
    };
  }

  setLlm(llm: MemoryLlm | undefined): void {
    this.llm = llm;
  }

  get available(): boolean {
    return typeof this.llm === 'function';
  }

  /** 是否值得调用 LLM（消息条数门槛）。 */
  shouldExtract(messages: readonly ContextInputMessage[]): boolean {
    return messages.length >= this.options.minMessages;
  }

  async extract(input: ExtractInput): Promise<ExtractionResult> {
    const messages = normalizeMessages(input.messages, this.options.maxMessages);
    if (messages.length < this.options.minMessages) {
      return { facts: [], relationshipDelta: {}, raw: '' };
    }
    const llm = this.llm;
    if (!llm) throw new MemoryError('llm_unavailable', '未注入 LLM，无法抽取长期记忆');
    const prompt = buildExtractionPrompt({
      messages,
      nickname: input.nickname,
      groupName: input.groupName,
      scene: input.scene,
    });
    let raw: string;
    try {
      raw = await llm({
        system: prompt.system,
        user: prompt.user,
        json: true,
        temperature: 0.2,
        maxTokens: 900,
        purpose: 'extract',
      });
    } catch (error) {
      throw new MemoryLlmError('记忆提取 LLM 调用失败：' + errorMessage(error));
    }
    return normalizeExtraction(parseJsonLoose(raw), input.now ? toDate(input.now) : this.options.now());
  }

  /** 把提取结果合并进文档：不覆盖用户手动内容（🔒），自动事实可合并去重。 */
  async apply(docId: string, result: ExtractionResult): Promise<ExtractionApplyResult> {
    const now = this.options.now();
    const factInputs: FactInput[] = result.facts.map((fact) => ({
      text: fact.text,
      category: fact.category,
      weight: fact.weight,
      source: 'auto',
    }));
    let addedFacts: MemoryFact[] = [];
    let updatedFacts: MemoryFact[] = [];
    let skippedFacts: FactMergeOutcome[] = [];
    let episode: MemoryEpisode | undefined;
    let relationship: RelationshipState | undefined;
    const doc = await this.store.mutateDoc(docId, (memoryDoc, extras) => {
      const merged = mergeFacts(memoryDoc, factInputs, now, { protectManual: true, source: 'auto' });
      addedFacts = merged.added;
      updatedFacts = merged.updated;
      skippedFacts = merged.skipped;
      if (result.episode) {
        episode = appendEpisodeToExtras(
          extras,
          {
            title: result.episode.title,
            detail: result.episode.detail,
            at: result.episode.at,
            anchors: result.episode.anchors,
          },
          now,
        );
        memoryDoc.episodeCount = extras.episodes.length;
        appendAnchorsToExtras(extras, result.episode.anchors);
      }
      if (Object.keys(result.relationshipDelta).length > 0) {
        applyRelationshipUpdate(memoryDoc, { deltas: result.relationshipDelta, touch: true }, now);
      }
      if (result.emotion) {
        appendEmotionToExtras(memoryDoc, extras, result.emotion, now);
      }
      relationship = {
        ...memoryDoc.relationship,
        notes: [...memoryDoc.relationship.notes],
      };
    });
    const applied: ExtractionApplyResult = {
      doc,
      addedFacts,
      updatedFacts,
      skippedFacts,
      relationship: relationship ?? doc.relationship,
    };
    if (episode) applied.episode = episode;
    return applied;
  }

  /** 抽取 + （按配置）落库。 */
  async run(input: ExtractInput): Promise<ExtractRunResult> {
    const extraction = await this.extract(input);
    if (!this.options.persist) return { extraction };
    if (
      extraction.facts.length === 0 &&
      !extraction.episode &&
      Object.keys(extraction.relationshipDelta).length === 0 &&
      !extraction.emotion
    ) {
      return { extraction };
    }
    const apply = await this.apply(input.docId, extraction);
    return { extraction, apply };
  }
}
