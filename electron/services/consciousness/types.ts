// 意识结构内部类型：识海 / 原意识 / 心光 / 心流 / 遗忘。
// 对外的展示模型沿用 shared/types.ts（SeaPoint / OriginSelf / AttentionState / MindFlowState /
// ForgettingStat / ConsciousnessOverview）；这里只增加「来源、强化、深度历史」等实现细节。
import type {
  AttentionState,
  ConsciousnessOverview,
  ForgettingStat,
  GrowthState,
  MemoryDoc,
  MemorySearchHit,
  MindFlowState,
  MindFlowStep,
  OriginAnchor,
  OriginSelf,
  Persona,
  Scene,
  SeaDepth,
  SeaPoint,
  SeaPointKind,
} from '../../../shared/types';
import type { MemoryDocExtras } from '../memory/types';

export type {
  AttentionState,
  ConsciousnessOverview,
  ForgettingStat,
  GrowthState,
  MemoryDoc,
  MemoryDocExtras,
  MemorySearchHit,
  MindFlowState,
  MindFlowStep,
  OriginAnchor,
  OriginSelf,
  Persona,
  Scene,
  SeaDepth,
  SeaPoint,
  SeaPointKind,
};

/** 意识数据文件版本。 */
export const CONSCIOUSNESS_VERSION = 1;
export const SEA_FILE = 'sea.json';
export const ORIGIN_FILE = 'origin.json';
export const ATTENTION_FILE = 'attention.json';
export const FLOW_FILE = 'flow.json';

/** 识海容量与心流/话题长度上限。 */
export const MAX_SEA_POINTS = 700;
export const MAX_CONNECTIONS_PER_POINT = 12;
export const MAX_FLOW_STEPS = 12;
export const MAX_ATTENTION_TOPICS = 8;
export const MAX_UNRESOLVED = 8;
export const MAX_ORIGIN_ANCHORS = 64;
export const MAX_ATTENTION_HISTORY = 20;

/** 识海点来源类别（与 SeaPointKind 同构，但额外区分记忆内的事实/经历/原话）。 */
export type SeaPointSource =
  | 'fact'
  | 'episode'
  | 'quote'
  | 'diary'
  | 'qzone'
  | 'learning'
  | 'activity'
  | 'chat';

/** 每个识海点都必须带真实来源，便于追溯与测试。 */
export interface SeaPointProvenance {
  source: SeaPointSource;
  /** 来源对象自己的 id：fact.id / episode.id / diary.id / conversationId+timestamp 等。 */
  sourceId: string;
  /** 记忆文档 id（联系人 / 群 / global），内容类来源没有 docId。 */
  docId?: string;
  docScene?: Scene;
  groupId?: string;
  userId?: string;
  displayName?: string;
  /** 逐字原话（经历/锚点来源）。 */
  quote?: string;
  conversationId?: string;
}

/** 落盘的识海点：在共享 SeaPoint 之上保留重要度、来源与遗忘状态。 */
export interface SeaPointRecord extends SeaPoint {
  /** 来源本身的重要度（0..1），不随时间变化。 */
  importance: number;
  /** 该来源的遗忘半衰期（天）：身份/承诺比闲聊慢得多。 */
  halfLifeDays: number;
  provenance: SeaPointProvenance;
  firstSeenAt: string;
  /** 上次计算时的深度，用于识别「本周下沉」。 */
  lastDepth: SeaDepth;
  depthChangedAt?: string;
  /** 从更浅层沉入更深层的时间（只用于 fadedThisWeek 统计）。 */
  fadedAt?: string;
  /** 真实连接的其它识海点 id（同人 / 同时段 / 关键词）。 */
  connectionIds: string[];
  /** 被主动强化（strengthen）的次数。 */
  reinforced: number;
  updatedAt: string;
}

export type OriginAnchorSource = 'persona' | 'growth' | 'global-memory' | 'episode' | 'sea-point' | 'previous';

export interface OriginAnchorRecord extends OriginAnchor {
  source: OriginAnchorSource;
  refId?: string;
  docId?: string;
  createdAt: string;
  /** 被重复确认的次数（越大越稳）。 */
  timesSeen: number;
}

export interface OriginData {
  personaId: string;
  coreSelf: string;
  anchors: OriginAnchorRecord[];
  continuity: string;
  updatedAt: string;
  builtAt: string;
  lastSeenAt?: string;
  lastTopics: string[];
  openLoops: string[];
  sources: {
    personaId: string;
    personaName: string;
    selfImage: string;
    globalDocId?: string;
    anchorCount: number;
    seaPointCount: number;
  };
}

export interface AttentionRecord extends AttentionState {
  personaId: string;
  /** 最近一次回忆到的记忆条数（用于统计「心光被点亮」）。 */
  recallCount: number;
  history: { at: string; focus: string }[];
  lastUserText?: string;
  lastUserName?: string;
}

export interface FlowRecord extends MindFlowState {
  personaId: string;
  /** 该会话累计生成的心流步数。 */
  stepCount: number;
}

export interface SeaData {
  points: SeaPointRecord[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// 持久化文件形状（每个文件内部按 personaId 分区，实现人设隔离）
// ---------------------------------------------------------------------------

export interface SeaFile {
  version: number;
  updatedAt: string;
  byPersona: Record<string, SeaData>;
}
export interface OriginFile {
  version: number;
  updatedAt: string;
  byPersona: Record<string, OriginData>;
}
export interface AttentionFile {
  version: number;
  updatedAt: string;
  byPersona: Record<string, Record<string, AttentionRecord>>;
}
export interface FlowFile {
  version: number;
  updatedAt: string;
  byPersona: Record<string, Record<string, FlowRecord>>;
}

// ---------------------------------------------------------------------------
// 服务输入 / 输出
// ---------------------------------------------------------------------------

export interface ObserveExchangeInput {
  personaId?: string;
  conversationId: string;
  userName: string;
  userId: string;
  scene?: Scene | 'local';
  groupId?: string;
  userText: string;
  assistantText?: string;
  /** 允许使用的记忆文档白名单；不传则根据 userId/scene/groupId 自动推导。 */
  docIds?: string[];
}

export interface ObserveResult {
  personaId: string;
  conversationId: string;
  attention: AttentionState;
  flow: MindFlowState;
  /** 本次新增的识海点（通常是一条对话点）。 */
  addedPointId?: string;
  /** 被唤醒/强化的识海点。 */
  recalled: SeaPoint[];
  addedPoints: number;
  reinforced: number;
  memoryHits: number;
  /** 可读的变化摘要，便于主进程写日志或 UI 展示。 */
  changes: string[];
}

export interface BuildContextBlockInput {
  personaId?: string;
  conversationId: string;
  userName: string;
  userId?: string;
  scene?: Scene | 'local';
  groupId?: string;
  query?: string;
  /** 显式记忆白名单（只允许这些 docId 的点进入上下文）。 */
  docIds?: string[];
  maxChars?: number;
}

export interface SearchSeaOptions {
  limit?: number;
  topK?: number;
  docIds?: string[];
  userId?: string;
  scene?: Scene | 'local';
  groupId?: string;
  conversationId?: string;
  kinds?: SeaPointKind[];
  /** 是否给命中点记一次回忆（默认 true）。 */
  touch?: boolean;
  minSalience?: number;
  personaId?: string;
}

export interface ResumeInput {
  personaId?: string;
  conversationId?: string;
}

export interface ResumeResult {
  brief: string;
  overview: ConsciousnessOverview;
  personaId: string;
  conversationId?: string;
  lastSeenAt?: string;
  lastTopics: string[];
  openLoops: string[];
}

export interface ConsciousnessServiceOptions {
  /** 意识数据根目录：服务会在其下创建 consciousness/。 */
  dataDir: string;
  memory: import('../memory').MemoryService;
  content: import('../content').ContentStore;
  personas: import('../personas').PersonaService;
  growth: import('../growth').GrowthService;
  getPersonaId: () => string;
  llm?: import('../memory').MemoryLlm;
  events?: import('../../core/event-bus').EventBus;
  logger?: ConsciousnessLogger;
  /** 注入时钟，便于测试遗忘衰减。 */
  now?: () => Date;
  /** 是否允许用 LLM 润色心流，默认 false（规则已可用）。 */
  useLlmForFlow?: boolean;
  /** 创建时是否自动重建识海/原意识，默认 true。 */
  autoBuild?: boolean;
}

export interface ConsciousnessLogger {
  info(scope: string, ...args: unknown[]): void;
  warn(scope: string, ...args: unknown[]): void;
  error(scope: string, ...args: unknown[]): void;
}

export interface ConsciousnessStats {
  personas: number;
  conversations: number;
  seaPoints: number;
  depth: Record<SeaDepth, number>;
  files: string[];
}

export class ConsciousnessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ConsciousnessError';
    this.code = code;
  }
}
