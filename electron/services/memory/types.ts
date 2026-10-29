// 记忆系统内部类型。
// 共享领域模型来自 shared/types.ts（唯一真源），这里只做扩展与聚合，不重复定义。
import type {
  ChatMessage,
  MemoryDoc,
  MemoryFact,
  MemorySearchHit,
  MemorySummary,
  MessageRole,
  RelationshipState,
  Scene,
} from '../../../shared/types';

export type {
  ChatMessage,
  MemoryDoc,
  MemoryFact,
  MemorySearchHit,
  MemorySummary,
  MessageRole,
  RelationshipState,
  Scene,
};

export type MemoryScopeKind = MemoryDoc['scope'];
export type FactCategory = MemoryFact['category'];
export type MessageScene = Scene | 'local';
export type MemoryScene = Scene | 'global';

/** Markdown 记忆文档固定章节，顺序即渲染顺序。 */
export const MEMORY_SECTIONS = [
  '基本档案',
  '关系状态',
  '重要事实',
  '偏好与雷区',
  '共同经历时间线',
  '承诺与待办',
  '记忆锚点',
  '情绪轨迹',
] as const;
export type MemorySectionName = (typeof MEMORY_SECTIONS)[number];

/** 全局自我记忆文档 id。 */
export const GLOBAL_DOC_ID = 'global_self';
/** Markdown 中的机器可读数据块标记。 */
export const MEMORY_DATA_MARKER = 'memory:data';
/** 当前文档结构版本，用于后续迁移。 */
export const MEMORY_DOC_VERSION = 1;

export const FACT_CATEGORY_ORDER: readonly FactCategory[] = [
  'identity',
  'preference',
  'boundary',
  'event',
  'promise',
  'emotion',
  'other',
];

export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  identity: '身份',
  preference: '偏好',
  event: '事件',
  promise: '承诺',
  emotion: '情绪',
  boundary: '雷区',
  other: '其他',
};

/** 事实类别的半衰期（天），用于检索时间衰减。 */
export const FACT_HALF_LIFE_DAYS: Record<FactCategory, number> = {
  identity: 720,
  preference: 365,
  boundary: 720,
  event: 120,
  promise: 180,
  emotion: 30,
  other: 180,
};

export const RELATIONSHIP_AXES = [
  'affinity',
  'trust',
  'familiarity',
  'intimacy',
  'respect',
  'tension',
] as const;

export type RelationshipAxis = (typeof RELATIONSHIP_AXES)[number];
export type RelationshipDelta = Partial<Record<RelationshipAxis, number>>;

export const RELATIONSHIP_AXIS_LABELS: Record<RelationshipAxis, string> = {
  affinity: '好感度',
  trust: '信任',
  familiarity: '熟悉度',
  intimacy: '亲密度',
  respect: '尊重',
  tension: '紧张度',
};

/** 错误基类：所有记忆系统错误都带稳定 code，方便主进程映射到 UI。 */
export class MemoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
  }
}

export class PathSafetyError extends MemoryError {
  constructor(message: string) {
    super('path_unsafe', message);
    this.name = 'PathSafetyError';
  }
}

export class MemoryLlmError extends MemoryError {
  constructor(message: string) {
    super('llm_failed', message);
    this.name = 'MemoryLlmError';
  }
}

export class MemoryParseError extends MemoryError {
  constructor(message: string) {
    super('parse_failed', message);
    this.name = 'MemoryParseError';
  }
}

// ---------------------------------------------------------------------------
// LLM 注入接口：记忆系统不直接依赖 DeepSeek 模块，由主进程注入。
// ---------------------------------------------------------------------------

export interface MemoryLlmRequest {
  system: string;
  user: string;
  /** 期望返回 JSON（注入方可在支持时开启 JSON mode）。 */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  purpose?: 'extract' | 'compact' | 'summarize';
}

/** 只要求返回文本内容；结构化解析由记忆系统自己做（容错）。 */
export type MemoryLlm = (request: MemoryLlmRequest) => Promise<string>;

// ---------------------------------------------------------------------------
// 文档附带结构（Markdown 数据块中保存，MemoryDoc 本体沿用 shared/types.ts）
// ---------------------------------------------------------------------------

export interface MemoryEpisode {
  id: string;
  at: string;
  title: string;
  detail: string;
  anchors: string[];
}

export interface MemoryEmotionPoint {
  at: string;
  mood: string;
  valence: number;
  arousal: number;
  reason: string;
}

/** 不进入 shared MemoryDoc 但必须持久化的附加数据。 */
export interface MemoryDocExtras {
  anchors: string[];
  episodes: MemoryEpisode[];
  emotionTrail: MemoryEmotionPoint[];
  /** 用户手写的备注：自动流程永不覆盖。 */
  manualNote: string;
  /** 已生成的最新摘要版本号，0 表示还没有压缩摘要。 */
  summaryVersion: number;
}

export interface ParsedMemoryDoc {
  doc: MemoryDoc;
  extras: MemoryDocExtras;
}

export type MemoryStats = MemorySummary['stats'];

// ---------------------------------------------------------------------------
// MemoryStore
// ---------------------------------------------------------------------------

export interface MemoryStoreOptions {
  rootDir: string;
  /** 用于文件名大小写/保留名策略，默认 process.platform。 */
  platform?: string;
  /** 单个 Markdown 文档最大字节数，超出抛错防止意外写入。 */
  maxDocBytes?: number;
}

export interface EnsureUserDocInput {
  userId: string;
  nickname: string;
  scene: Scene;
  groupId?: string;
  groupName?: string;
  avatar?: string;
}

export interface EnsureGroupDocInput {
  groupId: string;
  groupName: string;
  avatar?: string;
}

export interface ListDocsFilter {
  scope?: MemoryScopeKind | readonly MemoryScopeKind[];
  scene?: MemoryScene;
  groupId?: string;
  /** 在 displayName / preview / facts 中做大小写不敏感子串过滤。 */
  search?: string;
  pinnedOnly?: boolean;
  limit?: number;
}

export interface FactInput {
  text: string;
  category?: FactCategory;
  weight?: number;
  source?: string;
  createdAt?: string;
}

export interface FactMergeOutcome {
  status: 'added' | 'updated' | 'skipped';
  fact: MemoryFact;
  /** 命中的已存在事实。 */
  existingId?: string;
  reason?: 'duplicate' | 'manual_protected' | 'empty';
}

export interface AppendFactsResult {
  added: MemoryFact[];
  updated: MemoryFact[];
  skipped: FactMergeOutcome[];
  doc: MemoryDoc;
}

export interface RelationshipUpdate {
  /** 增量（-100..100，实际结果 clamp 到 0..100）。 */
  deltas?: RelationshipDelta;
  /** 直接赋值（notes 用 note 追加）。 */
  set?: Partial<Omit<RelationshipState, 'notes'>>;
  mood?: string;
  note?: string;
  touch?: boolean;
  streakDays?: number;
}

export interface EpisodeInput {
  title: string;
  detail?: string;
  at?: string;
  anchors?: string[];
}

export interface EmotionInput {
  mood: string;
  valence?: number;
  arousal?: number;
  reason?: string;
  at?: string;
}

export interface SummarySaveInput {
  summary: string;
  facts?: MemoryFact[];
  anchors?: string[];
  keptMessageIds?: string[];
  archivedPath: string;
  tokensBefore: number;
  tokensAfter: number;
  messageCount: number;
}

export interface SummaryVersion {
  version: number;
  docId: string;
  createdAt: string;
  summary: string;
  facts: MemoryFact[];
  anchors: string[];
  keptMessageIds: string[];
  archivedPath: string;
  tokensBefore: number;
  tokensAfter: number;
  messageCount: number;
  path: string;
}

export interface ArchivedMessage {
  role: MessageRole;
  content: string;
  name?: string;
  createdAt?: string;
}

export interface ArchiveResult {
  path: string;
  count: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 检索
// ---------------------------------------------------------------------------

export type MemorySnippetKind = 'fact' | 'episode' | 'quote';

export interface MemorySnippet {
  docId: string;
  displayName: string;
  scope: MemoryScopeKind;
  kind: MemorySnippetKind;
  snippet: string;
  score: number;
  factId?: string;
  category?: FactCategory;
  createdAt?: string;
}

export interface RetrieveOptions {
  topK?: number;
  /** 显式白名单：只能在调用方给出的文档内检索。 */
  docIds?: string[];
  scope?: MemoryScopeKind | readonly MemoryScopeKind[];
  scene?: MessageScene | 'global';
  userId?: string;
  groupId?: string;
  now?: Date | number | string;
  minScore?: number;
  maxPerDoc?: number;
  includeGlobal?: boolean;
}

export interface RetrieverOptions {
  /** 默认半衰期（天）。 */
  halfLifeDays?: number;
  bigramWeight?: number;
  keywordWeight?: number;
  factWeight?: number;
  recencyBoost?: number;
}

/** 检索器对存储层的最小依赖，避免 store <-> retriever 循环引用。 */
export interface MemoryDocSource {
  /** 文件名大小写/保留名策略，用于反推文档 id。 */
  readonly platform?: string;
  getDoc(id: string): MemoryDoc | undefined;
  getExtras(id: string): MemoryDocExtras | undefined;
  listDocs(filter?: ListDocsFilter): MemoryDoc[];
}

// ---------------------------------------------------------------------------
// 上下文构建与压缩
// ---------------------------------------------------------------------------

export interface ContextInputMessage {
  role: MessageRole;
  content?: string;
  /** 兼容 ChatMessage 的 text 字段。 */
  text?: string;
  name?: string;
  senderName?: string;
  createdAt?: string;
}

export interface NormalizedMessage {
  role: MessageRole;
  content: string;
  name?: string;
  createdAt?: string;
}

export interface MemoryContextMessage {
  role: MessageRole;
  content: string;
}

export interface BuildContextInput {
  personaPrompt: string;
  userName: string;
  userId: string;
  scene: MessageScene;
  groupId?: string;
  groupName?: string;
  recentMessages: readonly ContextInputMessage[];
  query?: string;
  extraSystem?: string;
  /** 覆盖摘要归属文档；默认私聊=用户文档，群聊=群文档。 */
  docId?: string;
  now?: Date | number | string;
}

export interface BuildContextResult {
  messages: MemoryContextMessage[];
  estimatedTokens: number;
  memoryHits: number;
  compacted: boolean;
  summaryVersion: number;
  /** 本次上下文注入的文档（便于调试与审计隔离）。 */
  allowedDocIds: string[];
  primaryDocId: string;
  memoryBlock: string;
}

export interface CompactInput {
  docId: string;
  messages: readonly ContextInputMessage[];
  llm?: MemoryLlm;
  maxTokens?: number;
  force?: boolean;
  now?: Date | number | string;
  /** 是否把摘要与事实写回文档，默认 true。 */
  persist?: boolean;
}

export interface CompactResult {
  summary: string;
  facts: MemoryFact[];
  keptMessages: NormalizedMessage[];
  archivedPath: string;
  summaryPath?: string;
  summaryVersion: number;
  compacted: boolean;
  tokensBefore: number;
  tokensAfter: number;
  anchors: string[];
  /** 被压缩归档的消息数量。 */
  archivedCount: number;
}

// ---------------------------------------------------------------------------
// 抽取
// ---------------------------------------------------------------------------

export interface ExtractedFact {
  text: string;
  category: FactCategory;
  weight: number;
  evidence?: string;
}

export interface ExtractedEpisode {
  title: string;
  detail: string;
  at?: string;
  anchors: string[];
}

export interface ExtractedEmotion {
  mood: string;
  valence: number;
  arousal: number;
  reason: string;
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  episode?: ExtractedEpisode;
  relationshipDelta: RelationshipDelta;
  emotion?: ExtractedEmotion;
  raw: string;
}

export interface ExtractInput {
  docId: string;
  messages: readonly ContextInputMessage[];
  scene?: MessageScene;
  nickname?: string;
  groupName?: string;
  now?: Date | number | string;
}

export interface ExtractionApplyResult {
  doc: MemoryDoc;
  addedFacts: MemoryFact[];
  updatedFacts: MemoryFact[];
  skippedFacts: FactMergeOutcome[];
  episode?: MemoryEpisode;
  relationship: RelationshipState;
}

// ---------------------------------------------------------------------------
// 聚合服务
// ---------------------------------------------------------------------------

export interface MemoryEngineSettings {
  maxContextTokens: number;
  compactAtPercent: number;
  keepRecentMessages: number;
  memoryTopK: number;
  autoMemoryExtraction: boolean;
  detailPreservingCompression: boolean;
  maxMemoryTokens: number;
  crossSessionRecall: boolean;
}

export const DEFAULT_MEMORY_SETTINGS: MemoryEngineSettings = {
  maxContextTokens: 32000,
  compactAtPercent: 0.75,
  keepRecentMessages: 12,
  memoryTopK: 8,
  autoMemoryExtraction: true,
  detailPreservingCompression: true,
  maxMemoryTokens: 1200,
  crossSessionRecall: true,
};

export interface MemoryServiceOptions {
  rootDir: string;
  llm?: MemoryLlm;
  settings?: Partial<MemoryEngineSettings>;
  platform?: string;
  retrieverOptions?: RetrieverOptions;
  now?: () => Date;
}

export interface EnsureConversationMemoryInput extends EnsureUserDocInput {}

export interface ConversationMemoryDocs {
  primaryDocId: string;
  userDoc: MemoryDoc;
  memberDoc?: MemoryDoc;
  groupDoc?: MemoryDoc;
  globalDoc?: MemoryDoc;
}

export interface SeedResult {
  created: string[];
  skipped: string[];
  summary: MemorySummary;
}
