// ContextManager：把长期记忆注入上下文，并在超预算时做「细节保留式压缩」。
//
// 压缩原则：
// - 原始消息先归档（archive/，只增不删），再让 LLM 输出结构化 JSON；
// - summary 保留人物 / 事件 / 偏好 / 承诺 / 情绪 / 逐字原话锚点；
// - 摘要版本化写盘（summaries/<docId>/<timestamp>.json），可回溯；
// - 压缩后仍保留最近 keepRecentMessages 条原文，避免「压缩即失忆」。
import {
  addAnchors as appendAnchorsToExtras,
  appendEmotionPoint as appendEmotionToExtras,
  createMemoryFact,
  mergeFacts,
} from './docops';
import {
  normalizeExtraction,
  parseJsonLoose,
} from './extractor';
import { MemoryRetriever, normalizeRetrieverOptions } from './retriever';
import type { MemoryStore } from './store';
import { ageInDays, clampNumber, normalizeLine, normalizeText, toDate, toIso } from './time';
import { FACT_CATEGORY_LABELS, MemoryError, MemoryLlmError } from './types';
import type {
  BuildContextInput,
  BuildContextResult,
  CompactInput,
  CompactResult,
  ContextInputMessage,
  ExtractedEmotion,
  ExtractedFact,
  MemoryContextMessage,
  MemoryDoc,
  MemoryLlm,
  MemorySnippet,
  MessageRole,
  NormalizedMessage,
  RetrieverOptions,
} from './types';

export interface ContextManagerOptions {
  memoryStore: MemoryStore;
  maxTokens?: number;
  /** 达到 maxTokens * compactAtPercent 即视为需要压缩，0.1~0.99。 */
  compactAtPercent?: number;
  keepRecentMessages?: number;
  memoryTopK?: number;
  maxMemoryTokens?: number;
  detailPreservingCompression?: boolean;
  retriever?: MemoryRetriever;
  retrieverOptions?: RetrieverOptions;
  now?: () => Date;
}

const CJK_CHAR = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;
const MEMORY_FACT_BULLET_LIMIT = 6;

/** 粗略 token 估算：中文 1 字≈1 token，其他字符 4 个≈1 token。 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    if (CJK_CHAR.test(char)) cjk += 1;
    else if (!/\s/.test(char)) other += 1;
  }
  return Math.ceil(cjk + other / 4);
}

export function estimateMessagesTokens(messages: readonly { content: string }[]): number {
  let total = 3;
  for (const message of messages) total += estimateTokens(message.content) + 4;
  return total;
}

function normalizeContextMessages(input: readonly ContextInputMessage[]): NormalizedMessage[] {
  const messages: NormalizedMessage[] = [];
  for (const message of input) {
    if (message.role === 'system') continue;
    const content = typeof message.content === 'string'
      ? message.content
      : typeof message.text === 'string'
        ? message.text
        : '';
    const text = normalizeText(content, 8000);
    if (!text) continue;
    const normalized: NormalizedMessage = { role: message.role, content: text };
    const name = typeof message.name === 'string' ? message.name : message.senderName;
    if (name) normalized.name = name;
    if (typeof message.createdAt === 'string') normalized.createdAt = message.createdAt;
    messages.push(normalized);
  }
  return messages;
}

function relativeInteraction(iso: string | undefined, now: Date): string {
  if (!iso) return '初次见面';
  const days = ageInDays(iso, now);
  if (days < 1) return '今天';
  if (days < 2) return '昨天';
  return Math.round(days) + ' 天前';
}

function buildRelationshipLine(doc: MemoryDoc, now: Date): string {
  const relationship = doc.relationship;
  return (
    '- 关系：好感 ' + Math.round(relationship.affinity) +
    ' · 信任 ' + Math.round(relationship.trust) +
    ' · 熟悉 ' + Math.round(relationship.familiarity) +
    ' · 最近互动 ' + relativeInteraction(relationship.lastInteractionAt, now) +
    ' · 最近情绪 ' + (relationship.lastMood || '平静')
  );
}

function topFacts(doc: MemoryDoc, limit: number): typeof doc.facts {
  return [...doc.facts]
    .sort((left, right) => right.weight - left.weight || Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

function snippetKey(text: string): string {
  return normalizeLine(text, 400).toLowerCase();
}

// ---------------------------------------------------------------------------
// 压缩提示词与结果归一化
// ---------------------------------------------------------------------------

const COMPACTION_SYSTEM = [
  '你是鲸鲸（QQ 智能体）长期记忆系统的「上下文压缩器」。',
  '把下面一段即将被丢弃的对话压缩成结构化记忆，供未来回忆使用。只输出一个 JSON 对象，不要输出解释、不要 Markdown 代码块。',
  '硬性要求：',
  '1. 细节保留优先：人物、事件经过、偏好、承诺、情绪变化、数字/时间/地点都必须保留；',
  '2. anchors 必须是对话里逐字出现的短引用（建议 3-6 条，每条 5-60 字），保留语气词与用词习惯，不要改写；',
  '3. 不得编造对话里没有的信息；',
  '4. facts 只写值得长期记住的事实，category 取 identity/preference/event/promise/emotion/boundary/other；',
  '5. 如果对话无信息量，输出 {"summary":"（本段无重要信息）","facts":[],"anchors":[]}。',
  '',
  '输出 JSON 结构：',
  '{',
  '  "summary": "300-600 字的结构化回忆，按人物/事件/偏好/承诺/情绪分点描述",',
  '  "people": [{"name": "称呼", "relation": "关系", "traits": ["特征"]}],',
  '  "events": [{"at": "时间", "what": "发生了什么", "detail": "经过", "quote": "逐字原话"}],',
  '  "preferences": {"likes": ["喜欢"], "dislikes": ["讨厌"]},',
  '  "promises": [{"content": "承诺内容", "deadline": "期限", "status": "状态"}],',
  '  "emotions": {"tone": "整体情绪基调", "changes": ["情绪变化"]},',
  '  "anchors": ["逐字原话"],',
  '  "facts": [{"text": "", "category": "other", "weight": 0.6}]',
  '}',
].join('\n');

function buildCompactionPrompt(messages: readonly NormalizedMessage[]): { system: string; user: string } {
  const lines = messages.map((message) => {
    const name = message.name ?? (message.role === 'user' ? '对方' : message.role === 'assistant' ? '鲸鲸' : '系统');
    return name + '：' + normalizeLine(message.content, 800);
  });
  return {
    system: COMPACTION_SYSTEM,
    user: '需要压缩的对话记录（从早到晚）：\n' + lines.join('\n'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapCompactionRoot(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  const wrappers = ['data', 'result', 'memory', 'compaction', 'output', 'response', '摘要'];
  let current: Record<string, unknown> = raw;
  for (let depth = 0; depth < 3; depth += 1) {
    const nested = wrappers
      .map((key) => current[key])
      .find((value): value is Record<string, unknown> => isRecord(value));
    if (!nested) break;
    current = nested;
  }
  return current;
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

function toStringArray(value: unknown, limit = 12): string[] {
  if (typeof value === 'string') return value.trim() ? [value] : [];
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

function toRecordArray(value: unknown, limit = 12): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).slice(0, limit);
}

function uniqueAnchors(values: readonly string[]): string[] {
  const anchors: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    let anchor = normalizeLine(raw, 300);
    if (!anchor) continue;
    anchor = anchor.replace(/^[「『"']+/, '').replace(/[」』"']+$/, '').trim();
    if (anchor.length < 2) continue;
    const key = snippetKey(anchor);
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push(anchor);
  }
  return anchors;
}

function structuredSummaryLines(root: Record<string, unknown>, anchors: string[]): string[] {
  const lines: string[] = [];
  const people = toRecordArray(root['people'] ?? root['人物'] ?? root['characters']);
  if (people.length > 0) {
    const text = people
      .map((person) => {
        const name = firstString(person, ['name', '称呼', 'relation', '关系']) ?? '';
        const traits = toStringArray(person['traits'] ?? person['特征'] ?? person['description'], 5).join('、');
        return [name, traits].filter((part) => part.length > 0).join('：');
      })
      .filter((part) => part.length > 0)
      .join('；');
    if (text) lines.push('人物：' + text);
  }
  const events = toRecordArray(root['events'] ?? root['事件'] ?? root['timeline'] ?? root['经历']);
  if (events.length > 0) {
    const parts: string[] = [];
    for (const event of events) {
      const at = firstString(event, ['at', 'time', '时间', 'date']) ?? '';
      const what = firstString(event, ['what', 'detail', '经过', '内容', 'description', 'summary']) ?? '';
      const quote = firstString(event, ['quote', '原话', '原话锚点']);
      if (quote) anchors.push(quote);
      const part = [at, what].filter((item) => item.length > 0).join(' ');
      if (part) parts.push(part);
    }
    if (parts.length > 0) lines.push('事件：' + parts.join('；'));
  }
  const preferences = root['preferences'] ?? root['偏好'] ?? root['likes'];
  if (isRecord(preferences)) {
    const likes = toStringArray(preferences['likes'] ?? preferences['喜欢'], 10);
    const dislikes = toStringArray(preferences['dislikes'] ?? preferences['讨厌'], 10);
    const parts: string[] = [];
    if (likes.length > 0) parts.push('喜欢 ' + likes.join('、'));
    if (dislikes.length > 0) parts.push('讨厌 ' + dislikes.join('、'));
    if (parts.length > 0) lines.push('偏好：' + parts.join('；'));
  } else {
    const list = toStringArray(preferences, 10);
    if (list.length > 0) lines.push('偏好：' + list.join('、'));
  }
  const promises = toRecordArray(root['promises'] ?? root['承诺'] ?? root['todo']);
  if (promises.length > 0) {
    const parts = promises
      .map((promise) => {
        const content = firstString(promise, ['content', '内容', 'text']) ?? '';
        const deadline = firstString(promise, ['deadline', '期限', 'status', '状态']) ?? '';
        if (!content) return '';
        return deadline ? content + '（' + deadline + '）' : content;
      })
      .filter((part) => part.length > 0);
    if (parts.length > 0) lines.push('承诺：' + parts.join('；'));
  }
  const emotions = root['emotions'] ?? root['情绪'] ?? root['emotion'];
  if (isRecord(emotions)) {
    const tone = firstString(emotions, ['tone', '基调', 'mood', '情绪']) ?? '';
    const changes = toStringArray(emotions['changes'] ?? emotions['变化'], 6);
    const parts = [tone, changes.join('；')].filter((part) => part.length > 0);
    if (parts.length > 0) lines.push('情绪：' + parts.join('；'));
  } else if (typeof emotions === 'string' && emotions.trim()) {
    lines.push('情绪：' + normalizeLine(emotions, 200));
  }
  return lines;
}

function normalizeEmotionSource(root: Record<string, unknown>): ExtractedEmotion | undefined {
  const source = root['emotion'] ?? root['情绪'] ?? root['mood'];
  if (typeof source === 'string' && source.trim()) {
    return { mood: normalizeLine(source, 40), valence: 0, arousal: 0.3, reason: '' };
  }
  if (!isRecord(source)) return undefined;
  const mood = firstString(source, ['mood', '情绪', '基调', 'tone', 'label']);
  if (!mood) return undefined;
  const valence = source['valence'] ?? source['愉悦度'];
  const arousal = source['arousal'] ?? source['唤醒度'];
  return {
    mood: normalizeLine(mood, 40),
    valence: typeof valence === 'number' && Number.isFinite(valence) ? clampNumber(valence, -1, 1) : 0,
    arousal: typeof arousal === 'number' && Number.isFinite(arousal) ? clampNumber(arousal, 0, 1) : 0.3,
    reason: normalizeLine(firstString(source, ['reason', '原因', 'trigger', '触发']) ?? '', 200),
  };
}

interface CompactionPayload {
  summary: string;
  facts: ExtractedFact[];
  anchors: string[];
  emotion?: ExtractedEmotion;
}

/** 把 LLM 压缩输出归一化；即使 JSON 残缺也不丢原话锚点。 */
export function normalizeCompactionPayload(
  raw: unknown,
  fallbackAnchors: readonly string[] = [],
): CompactionPayload {
  const root = unwrapCompactionRoot(raw);
  const facts: ExtractedFact[] = [];
  const anchors: string[] = [];
  let summary = '';
  if (root) {
    summary = normalizeText(firstString(root, ['summary', '摘要', 'recap', 'overview']) ?? '', 4000);
    const structured = structuredSummaryLines(root, anchors);
    anchors.push(...toStringArray(root['anchors'] ?? root['原话锚点'] ?? root['quotes'] ?? root['原话'], 12));
    const rawFacts = root['facts'] ?? root['事实'];
    if (rawFacts !== undefined) {
      facts.push(...normalizeExtraction({ facts: rawFacts }).facts);
    }
    const sections: string[] = [];
    if (summary) sections.push(summary);
    if (structured.length > 0) sections.push(structured.join('\n'));
    summary = sections.join('\n\n').trim();
  }
  const allAnchors = uniqueAnchors([...anchors, ...fallbackAnchors]);
  if (allAnchors.length > 0) {
    summary = summary ? summary + '\n\n原话锚点：\n' + allAnchors.map((anchor) => '- 「' + anchor + '」').join('\n') : '原话锚点：\n' + allAnchors.map((anchor) => '- 「' + anchor + '」').join('\n');
  }
  const payload: CompactionPayload = {
    summary: summary.slice(0, 6000),
    facts,
    anchors: allAnchors,
  };
  const emotion = root ? normalizeEmotionSource(root) : undefined;
  if (emotion) payload.emotion = emotion;
  return payload;
}

function firstSentence(text: string, limit = 80): string {
  const single = normalizeLine(text, limit * 2);
  const match = /^(.{2,}?)[。！？!?；;\n]/.exec(single);
  const sentence = match && match[1] ? match[1] : single;
  return sentence.slice(0, limit);
}

/** 从原始消息里抽取逐字原话，作为压缩的「细节保险」，不依赖 LLM。 */
export function extractQuoteAnchors(messages: readonly NormalizedMessage[], limit = 6): string[] {
  const anchors: string[] = [];
  const seen = new Set<string>();
  const candidates = messages.filter((message) => message.role === 'user' || message.role === 'assistant');
  const step = Math.max(1, Math.floor(candidates.length / Math.max(1, limit)));
  for (let index = 0; index < candidates.length && anchors.length < limit; index += step) {
    const message = candidates[index];
    if (!message) continue;
    const sentence = firstSentence(message.content, 80);
    if (sentence.length < 2) continue;
    const key = snippetKey(sentence);
    if (seen.has(key)) continue;
    seen.add(key);
    anchors.push(sentence);
  }
  return anchors;
}

function buildFallbackSummary(messages: readonly NormalizedMessage[], anchors: readonly string[]): string {
  const topics = messages
    .filter((message) => message.role === 'user')
    .map((message) => firstSentence(message.content, 40))
    .filter((topic) => topic.length > 0)
    .slice(0, 5);
  const parts: string[] = ['早期对话共 ' + messages.length + ' 条消息'];
  if (topics.length > 0) parts.push('主要谈到：' + topics.join('；'));
  if (anchors.length > 0) parts.push('原话保留：' + anchors.join('；'));
  return parts.join('。');
}

function noCompaction(
  messages: NormalizedMessage[],
  tokens: number,
  summaryVersion: number,
): CompactResult {
  return {
    summary: '',
    facts: [],
    keptMessages: messages,
    archivedPath: '',
    summaryVersion,
    compacted: false,
    tokensBefore: tokens,
    tokensAfter: tokens,
    anchors: [],
    archivedCount: 0,
  };
}

export class ContextManager {
  private readonly store: MemoryStore;
  private readonly retriever: MemoryRetriever;
  private readonly maxTokens: number;
  private readonly compactAtPercent: number;
  private readonly keepRecentMessages: number;
  private readonly memoryTopK: number;
  private readonly maxMemoryTokens: number;
  private readonly detailPreserving: boolean;
  private readonly now: () => Date;

  constructor(options: ContextManagerOptions) {
    if (!options || !options.memoryStore) {
      throw new MemoryError('invalid_store', 'ContextManager 需要 memoryStore');
    }
    this.store = options.memoryStore;
    this.maxTokens = Math.max(256, options.maxTokens ?? 32000);
    this.compactAtPercent = clampNumber(options.compactAtPercent ?? 0.75, 0.1, 0.99);
    this.keepRecentMessages = Math.max(1, options.keepRecentMessages ?? 12);
    this.memoryTopK = Math.max(1, options.memoryTopK ?? 8);
    this.maxMemoryTokens = Math.max(256, options.maxMemoryTokens ?? 1200);
    this.detailPreserving = options.detailPreservingCompression !== false;
    this.now = options.now ?? (() => new Date());
    this.retriever = options.retriever ??
      new MemoryRetriever(this.store, normalizeRetrieverOptions(options.retrieverOptions));
  }

  // -------------------------------------------------------------------------
  // 构建上下文
  // -------------------------------------------------------------------------

  async buildContext(input: BuildContextInput): Promise<BuildContextResult> {
    const now = toDate(input.now ?? this.now());
    const userId = normalizeLine(input.userId, 128);
    if (!userId) throw new MemoryError('invalid_user', 'buildContext 需要 userId');
    const isGroup = input.scene === 'group';
    let groupId: string | undefined;
    let groupName: string | undefined;
    if (isGroup) {
      groupId = normalizeLine(input.groupId ?? '', 128);
      if (!groupId) throw new MemoryError('missing_group', '群聊上下文必须提供 groupId');
      groupName = input.groupName;
    }

    // 确保基础文档存在：私聊=用户文档；群聊=群文档 + 当前发言人成员文档。
    const globalDoc = await this.store.ensureGlobalDoc();
    const primaryDoc = isGroup && groupId
      ? await this.store.ensureGroupDoc({ groupId, groupName: groupName ?? '群 ' + groupId })
      : await this.store.ensureUserDoc({ userId, nickname: input.userName, scene: 'private' });
    const memberDoc = isGroup && groupId
      ? await this.store.ensureUserDoc({
          userId,
          nickname: input.userName,
          scene: 'group',
          groupId,
          groupName,
        })
      : undefined;
    const primaryDocId = input.docId && this.store.hasDoc(input.docId) ? input.docId : primaryDoc.id;

    // 场景隔离白名单：只允许 global + 当前群 + 当前发言人（私聊则只有 global + 本人）。
    const allowedDocIds: string[] = [globalDoc.id, primaryDoc.id];
    if (memberDoc) allowedDocIds.push(memberDoc.id);

    const lines: string[] = [];
    let usedMemoryTokens = 0;
    let memoryHits = 0;
    const shownFacts = new Set<string>();
    const push = (line: string): boolean => {
      const cost = estimateTokens(line) + 1;
      if (usedMemoryTokens + cost > this.maxMemoryTokens) return false;
      usedMemoryTokens += cost;
      lines.push(line);
      return true;
    };
    const pushFactBullet = (text: string, label?: string): boolean => {
      const key = snippetKey(text);
      if (shownFacts.has(key)) return true;
      const ok = push('- ' + (label ? '[' + label + '] ' : '') + text);
      if (ok) {
        shownFacts.add(key);
        memoryHits += 1;
      }
      return ok;
    };
    const appendDocCard = (doc: MemoryDoc, title: string, factLimit: number, showRelationship: boolean): void => {
      push('▍' + title);
      if (showRelationship && !push(buildRelationshipLine(doc, now))) {
        // 预算不足就停止该卡片
      }
      for (const fact of topFacts(doc, factLimit)) {
        if (!pushFactBullet(fact.text, FACT_CATEGORY_LABELS[fact.category])) break;
      }
      const extras = this.store.getExtras(doc.id);
      if (extras) {
        for (const anchor of extras.anchors.slice(-2)) {
          if (!push('- 原话：「' + anchor + '」')) break;
          memoryHits += 1;
        }
      }
    };

    push('【长期记忆】');
    appendDocCard(globalDoc, '鲸鲸的自我记忆', 3, false);
    if (isGroup && groupId) {
      appendDocCard(primaryDoc, '当前群：' + primaryDoc.displayName + '（群号 ' + groupId + '）', 4, true);
      if (memberDoc) {
        appendDocCard(memberDoc, '本群发言人：' + memberDoc.displayName, 4, true);
      }
    } else {
      appendDocCard(primaryDoc, '当前联系人：' + primaryDoc.displayName + '（私聊）', MEMORY_FACT_BULLET_LIMIT, true);
    }

    const snippets: MemorySnippet[] = this.retriever.retrieve(input.query ?? '', {
      docIds: allowedDocIds,
      topK: this.memoryTopK,
      now,
    });
    if (snippets.length > 0) {
      push('▍相关记忆片段：');
      for (const snippet of snippets) {
        if (shownFacts.has(snippetKey(snippet.snippet))) continue;
        if (!push('- ' + snippet.snippet + '（' + snippet.displayName + '）')) break;
        memoryHits += 1;
      }
    }

    const latestSummary = await this.store.getLatestSummary(primaryDocId);
    if (latestSummary && latestSummary.summary) {
      push('▍历史对话摘要（v' + latestSummary.version + '，原始消息已归档可追溯）：');
      for (const line of latestSummary.summary.split('\n')) {
        if (!push(line)) break;
      }
    }

    const systemParts: string[] = [];
    if (input.personaPrompt && input.personaPrompt.trim()) systemParts.push(input.personaPrompt.trim());
    if (input.extraSystem && input.extraSystem.trim()) systemParts.push(input.extraSystem.trim());
    if (lines.length > 0) systemParts.push(lines.join('\n'));
    const systemContent = systemParts.join('\n\n');

    const recent = normalizeContextMessages(input.recentMessages);
    const messages: MemoryContextMessage[] = [{ role: 'system', content: systemContent }];
    for (const message of recent) {
      messages.push({ role: message.role, content: message.content });
    }

    const threshold = Math.floor(this.maxTokens * this.compactAtPercent);
    let estimatedTokens = estimateMessagesTokens(messages);
    let compacted = false;
    const keep = Math.min(this.keepRecentMessages, recent.length);
    while (estimatedTokens > threshold && messages.length - 1 > keep) {
      messages.splice(1, 1);
      compacted = true;
      estimatedTokens = estimateMessagesTokens(messages);
    }
    if (compacted) {
      const first = messages[0];
      if (first) {
        first.content = first.content + '\n\n（较早的聊天已压缩，原始消息已归档；如需细节请参考摘要与原话锚点。）';
        estimatedTokens = estimateMessagesTokens(messages);
      }
    }

    return {
      messages,
      estimatedTokens,
      memoryHits,
      compacted,
      summaryVersion: latestSummary?.version ?? (await this.store.getSummaryVersion(primaryDocId)),
      allowedDocIds,
      primaryDocId,
      memoryBlock: lines.join('\n'),
    };
  }

  // -------------------------------------------------------------------------
  // 细节保留式压缩
  // -------------------------------------------------------------------------

  async maybeCompact(input: CompactInput): Promise<CompactResult> {
    const doc = this.store.getDoc(input.docId);
    if (!doc) throw new MemoryError('doc_not_found', '记忆文档不存在：' + input.docId);
    const now = input.now ? toDate(input.now) : this.now();
    const messages = normalizeContextMessages(input.messages);
    const tokensBefore = estimateMessagesTokens(messages);
    const maxTokens = Math.max(256, input.maxTokens ?? this.maxTokens);
    const threshold = Math.floor(maxTokens * this.compactAtPercent);
    const currentVersion = await this.store.getSummaryVersion(input.docId);
    const keep = Math.max(1, this.keepRecentMessages);
    const keptMessages = messages.length > keep ? messages.slice(-keep) : messages;

    const needed = input.force === true || tokensBefore > threshold || messages.length > keep * 4;
    if (!needed) {
      return noCompaction(messages, tokensBefore, currentVersion);
    }
    if (!input.llm) {
      if (input.force === true) {
        throw new MemoryLlmError('强制压缩需要注入 LLM');
      }
      return noCompaction(messages, tokensBefore, currentVersion);
    }

    // 1) 先归档原始消息，绝不删除。
    const archive = await this.store.archiveMessages(input.docId, messages, {
      reason: 'context_compaction',
      compressedAt: toIso(now),
      tokensBefore,
      messageCount: messages.length,
      detailPreserving: this.detailPreserving,
    });

    // 2) LLM 输出结构化摘要（人物/事件/偏好/承诺/情绪/原话锚点）。
    const prompt = buildCompactionPrompt(messages);
    let raw: string;
    try {
      raw = await input.llm({
        system: prompt.system,
        user: prompt.user,
        json: true,
        temperature: 0.2,
        maxTokens: 1200,
        purpose: 'compact',
      });
    } catch (error) {
      throw new MemoryLlmError('上下文压缩 LLM 调用失败：' + (error instanceof Error ? error.message : String(error)));
    }

    // 3) 容错归一化 + 原话保险（LLM 漏掉的逐字原话由本地补）。
    const fallbackAnchors = extractQuoteAnchors(messages, 6);
    const payload = normalizeCompactionPayload(parseJsonLoose(raw), fallbackAnchors);
    const summary = payload.summary || buildFallbackSummary(messages, payload.anchors);
    const facts = payload.facts.map((fact) =>
      createMemoryFact(
        {
          text: fact.text,
          category: fact.category,
          weight: fact.weight,
          source: 'compact',
        },
        now,
      ),
    );
    const tokensAfter = estimateMessagesTokens(keptMessages);

    // 4) 摘要版本化落盘。
    const saved = await this.store.saveSummary(input.docId, {
      summary,
      facts,
      anchors: payload.anchors,
      archivedPath: archive.path,
      tokensBefore,
      tokensAfter,
      messageCount: messages.length,
    });

    // 5) 事实 / 锚点 / 情绪回流到长期记忆文档（不覆盖手动内容）。
    if (input.persist !== false && (facts.length > 0 || payload.anchors.length > 0 || payload.emotion)) {
      await this.store.mutateDoc(input.docId, (memoryDoc, extras) => {
        if (facts.length > 0) {
          mergeFacts(
            memoryDoc,
            facts.map((fact) => ({
              text: fact.text,
              category: fact.category,
              weight: fact.weight,
              source: 'compact',
            })),
            now,
            { protectManual: true, source: 'compact' },
          );
        }
        if (payload.anchors.length > 0) appendAnchorsToExtras(extras, payload.anchors);
        if (payload.emotion) appendEmotionToExtras(memoryDoc, extras, payload.emotion, now);
      });
    }

    return {
      summary,
      facts,
      keptMessages,
      archivedPath: archive.path,
      summaryPath: saved.path,
      summaryVersion: saved.version,
      compacted: true,
      tokensBefore,
      tokensAfter,
      anchors: payload.anchors,
      archivedCount: Math.max(0, messages.length - keptMessages.length),
    };
  }

  /** 供主进程/测试使用：当前上下文预算。 */
  get tokenBudget(): { maxTokens: number; compactAtPercent: number; maxMemoryTokens: number } {
    return {
      maxTokens: this.maxTokens,
      compactAtPercent: this.compactAtPercent,
      maxMemoryTokens: this.maxMemoryTokens,
    };
  }
}
