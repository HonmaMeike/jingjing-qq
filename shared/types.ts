// 共享领域模型：主进程与渲染进程共用的唯一真源。
export type Scene = 'private' | 'group';
export type PermissionRole = 'owner' | 'admin' | 'whitelist' | 'guest';
export type ThemeMode = 'dark' | 'light' | 'system';
export type AccentColor = 'ocean' | 'sakura' | 'mint' | 'amber' | 'violet';
export type ServiceId = 'deepseek' | 'breezeblue' | 'minimax' | 'suno' | 'serper' | 'bilibili' | 'napcat';

export interface ApiKeys {
  deepseek: string;
  breezeblue: string;
  minimax: string;
  suno: string;
  serper: string;
}
export type ApiKeyStatus = Record<keyof ApiKeys, boolean>;

export interface GeneralSettings {
  botName: string;
  ownerQQ: string;
  theme: ThemeMode;
  accent: AccentColor;
  autoLaunch: boolean;
  closeToTray: boolean;
  minimizeToTray: boolean;
  startMinimized: boolean;
  assetsPath: string;
  checkUpdates: boolean;
  telemetry: false;
  demoMode: boolean;
}
export interface DeepSeekSettings {
  baseUrl: string;
  model: string;
  reasoningModel: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
  stream: boolean;
  /** DeepSeek V4 思考模式开关（新 API 的 thinking.type）。 */
  useReasoningForChat: boolean;
  /** 思考强度：low / high / max（新 API 的 reasoning_effort）。 */
  reasoningEffort: 'low' | 'high' | 'max';
  dailyTokenBudget: number;
}
export interface EndpointSettings {
  deepseekBaseUrl: string;
  breezeblueBaseUrl: string;
  minimaxBaseUrl: string;
  sunoBaseUrl: string;
  serperBaseUrl: string;
}
export interface ModelSettings {
  deepseekChat: string;
  deepseekReasoning: string;
  breezeTts: string;
  breezeVoiceId: string;
  breezeVoiceName: string;
  minimaxImage: string;
  minimaxVideo: string;
  minimaxVideoResolution: string;
  minimaxVideoDuration: number;
  suno: string;
}
export interface TtsSettings {
  enabled: boolean;
  autoSyncVoices: boolean;
  preferLatestVoice: boolean;
  language: string;
  instructions: string;
  guidanceScale: number;
  /** Breeze 语速倍率 0.5-2.0。 */
  speed: number;
  outputFormat: 'mp3' | 'wav';
  sendVoiceInQQ: boolean;
  voiceReplyChance: number;
  maxChars: number;
  playLocally: boolean;
}
export interface MediaSettings {
  imageEnabled: boolean;
  videoEnabled: boolean;
  musicEnabled: boolean;
  imageAspectRatio: string;
  /** 视频画幅比例（H3 T2V 必填，默认 16:9）。 */
  videoAspectRatio: string;
  imageCount: number;
  /** 统一画风；所有文生图/文生视频都会附带，避免风格漂移。 */
  imageStyle: string;
  videoStyle: string;
  /** 锁定角色外观与画风，不允许模型自由换风格。 */
  styleLock: boolean;
  promptOptimizer: boolean;
  autoIllustrateQzone: boolean;
}
export interface SearchSettings {
  enabled: boolean;
  includeNews: boolean;
  maxResults: number;
  autoLearn: boolean;
  /** auto：DeepSeek 可用时优先用官方搜索；否则 Serper。 */
  provider: 'auto' | 'deepseek' | 'serper';
}
export interface BilibiliSettings {
  enabled: boolean;
  interests: string[];
  cookie: string;
  fetchLimit: number;
}
export interface NapCatSettings {
  enabled: boolean;
  mode: 'embedded' | 'external';
  installDir: string;
  qqPath: string;
  oneBotHttpUrl: string;
  oneBotWsUrl: string;
  reverseWsPort: number;
  webuiUrl: string;
  webuiToken: string;
  botUin: string;
  autoStart: boolean;
  autoLogin: boolean;
  /** 是否允许在桌面聊天窗口直接向 QQ 会话发送消息（默认关闭，防止误代发）。 */
  allowDesktopSendToQq: boolean;
  hideQQWindows: boolean;
  autoHideDelayMs: number;
  autoRestart: boolean;
  messagePrefix: string;
  groupWakeWords: string[];
  privateWakeWords: string[];
  replyDelayMinMs: number;
  replyDelayMaxMs: number;
  splitReplies: boolean;
  maxRepliesPerMinute: number;
  emulateWhenOffline: boolean;
}
export interface PermissionSettings {
  owners: string[];
  admins: string[];
  whitelist: string[];
  groupWhitelist: string[];
  /** 群聊总开关：off 全部关闭；whitelist 仅白名单；all 全部允许。 */
  groupChatMode: 'off' | 'whitelist' | 'all';
  allowStrangers: boolean;
  requireAtInGroup: boolean;
  replyToOwnerAlways: boolean;
  adminCanSwitchPersona: boolean;
  adminCanForgetMemory: boolean;
  blacklist: string[];
  sensitiveWords: string[];
}
export interface AutonomySettings {
  enabled: boolean;
  tickSeconds: number;
  proactiveEnabled: boolean;
  proactiveTargets: 'owner' | 'close' | 'whitelist';
  proactiveMinGapMinutes: number;
  proactiveMaxPerDay: number;
  quietHoursEnabled: boolean;
  quietStart: string;
  quietEnd: string;
  diaryEnabled: boolean;
  diaryHour: number;
  qzoneEnabled: boolean;
  qzoneHour: number;
  qzoneMinGapHours: number;
  qzoneVisibility: 1 | 4 | 64;
  biliEnabled: boolean;
  biliMinGapHours: number;
  learnEnabled: boolean;
  learnMinGapHours: number;
  reflectEnabled: boolean;
  reflectHour: number;
  maxActionsPerDay: number;
  idleTriggerMinutes: number;
}
export interface ContextSettings {
  maxContextTokens: number;
  compactAtPercent: number;
  keepRecentMessages: number;
  memoryTopK: number;
  autoMemoryExtraction: boolean;
  detailPreservingCompression: boolean;
  maxMemoryTokens: number;
  crossSessionRecall: boolean;
}
export interface PersonaSettings {
  activeId: string;
  allowAutoSwitch: boolean;
  evolveEnabled: boolean;
  growthIntensity: 'slow' | 'normal' | 'fast';
  replyLength: 'short' | 'natural' | 'rich';
}
export interface UiSettings {
  lastRoute: string;
  sidebarCollapsed: boolean;
  denseMode: boolean;
  showPet: boolean;
  reduceMotion: boolean;
}
export interface AppSettings {
  version: number;
  onboardingDone: boolean;
  firstRunAt: string;
  general: GeneralSettings;
  deepseek: DeepSeekSettings;
  endpoints: EndpointSettings;
  models: ModelSettings;
  tts: TtsSettings;
  media: MediaSettings;
  search: SearchSettings;
  bilibili: BilibiliSettings;
  napcat: NapCatSettings;
  permissions: PermissionSettings;
  autonomy: AutonomySettings;
  context: ContextSettings;
  persona: PersonaSettings;
  plugins: Record<string, { enabled: boolean; config: Record<string, unknown> }>;
  billing: BillingSettings;
  stickers: StickerSettings;
  chatTools: ChatToolSettings;
  ui: UiSettings;
}

export interface PersonaTts {
  voiceHint: string;
  instructions: string;
  tags: string[];
  pitch: number;
  speed: number;
}
export interface PersonaExample { user: string; assistant: string; }
export interface Persona {
  id: string;
  name: string;
  nickname: string;
  title: string;
  avatar: string;
  animation: string;
  color: string;
  tagline: string;
  description: string;
  baseTemplateId?: string;
  isBuiltin: boolean;
  isActive?: boolean;
  traits: string[];
  catchphrases: string[];
  quirks: string[];
  temper: string;
  likes: string[];
  dislikes: string[];
  background: string;
  speechStyle: string;
  relationshipStyle: string;
  boundaries: string[];
  interests: string[];
  examples: PersonaExample[];
  corePrompt: string;
  greeting: string;
  tts: PersonaTts;
  /** 绑定的 BreezeBlue 音色；切换人设时同步到全局 TTS 音色，可手动覆盖。 */
  voiceId?: string;
  voiceName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface RelationshipState {
  affinity: number;
  trust: number;
  familiarity: number;
  intimacy: number;
  respect: number;
  tension: number;
  interactions: number;
  streakDays: number;
  firstMetAt: string;
  lastInteractionAt: string;
  lastMood: string;
  notes: string[];
}
export interface MemoryFact {
  id: string;
  text: string;
  category: 'identity' | 'preference' | 'event' | 'promise' | 'emotion' | 'boundary' | 'other';
  weight: number;
  createdAt: string;
  source?: string;
}
export type MemoryScope = 'user' | 'group' | 'global' | 'persona';
export interface MemoryDoc {
  id: string;
  scope: MemoryScope;
  externalId: string;
  displayName: string;
  avatar?: string;
  scene: Scene | 'global';
  groupId?: string;
  groupName?: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  facts: MemoryFact[];
  relationship: RelationshipState;
  tags: string[];
  preview: string;
  messageCount: number;
  episodeCount: number;
  pinned?: boolean;
}
export interface MemorySummary {
  docs: MemoryDoc[];
  groups: { id: string; name: string; memberCount: number; updatedAt: string; preview: string }[];
  stats: { users: number; groups: number; facts: number; docs: number; storageBytes: number };
}
export interface MemorySearchHit { docId: string; displayName: string; scope: string; snippet: string; score: number; }

export interface GrowthStage {
  key: string;
  name: string;
  description: string;
  minXp: number;
  color: string;
}
export interface EmotionState {
  /** 今天发生的一件小事，用于注入日常连续感。 */
  dailyEvent?: string;
  mood: string;
  moodEmoji: string;
  valence: number;
  arousal: number;
  energy: number;
  affection: number;
  patience: number;
  jealousy: number;
  pride: number;
  updatedAt: string;
  reason: string;
}
export interface GrowthState {
  level: number;
  xp: number;
  nextXp: number;
  stage: string;
  stageName: string;
  stageProgress: number;
  traits: Record<string, number>;
  habits: string[];
  selfImage: string;
  evolutionNotes: string[];
  reflections: string[];
  totalMessages: number;
  totalDays: number;
  streakDays: number;
  lastGrownAt: string;
  personalityDrift: { key: string; label: string; value: number }[];
}
export type ActivityType = 'proactive' | 'diary' | 'qzone' | 'bilibili' | 'learning' | 'reflection' | 'growth' | 'system' | 'chat';
export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  summary: string;
  detail?: string;
  createdAt: string;
  personaId: string;
  status: 'pending' | 'done' | 'failed' | 'skipped';
  image?: string;
  link?: string;
  metadata?: Record<string, unknown>;
}
export interface DiaryEntry {
  id: string;
  date: string;
  title: string;
  content: string;
  mood: string;
  moodEmoji: string;
  highlights: string[];
  images: string[];
  createdAt: string;
  personaId: string;
  private: boolean;
}
export interface QzonePost {
  id: string;
  content: string;
  images: string[];
  createdAt: string;
  personaId: string;
  status: 'draft' | 'posted' | 'failed';
  tid?: string;
  error?: string;
  visibility: number;
}
export interface BiliDiscovery {
  id: string;
  title: string;
  url: string;
  cover?: string;
  upName?: string;
  play?: number;
  duration?: string;
  reason: string;
  comment: string;
  createdAt: string;
  personaId: string;
}
export interface LearningNote {
  id: string;
  topic: string;
  summary: string;
  points: string[];
  sources: { title: string; url: string }[];
  createdAt: string;
  personaId: string;
}
export interface GrowthOverview {
  emotion: EmotionState;
  growth: GrowthState;
  stages: GrowthStage[];
  activities: ActivityItem[];
  diaries: DiaryEntry[];
  qzone: QzonePost[];
  bilibili: BiliDiscovery[];
  learning: LearningNote[];
  relationship?: RelationshipState;
}


// ---------------------------------------------------------------------------
// 神经中枢 / 实时可观测性
// ---------------------------------------------------------------------------
export type NeuralNodeId =
  | 'user' | 'core' | 'persona' | 'memories' | 'origin' | 'attention' | 'flow' | 'forget'
  | 'deepseek' | 'tools' | 'tts' | 'media' | 'search' | 'napcat' | 'qq' | 'emotion' | 'growth' | 'storage';
export type NeuralEventType =
  | 'message_in' | 'thought' | 'memory' | 'context' | 'llm_start' | 'llm_delta' | 'llm_end'
  | 'tool' | 'tts' | 'media' | 'state' | 'reply' | 'cost' | 'napcat' | 'error' | 'system';
export interface NeuralEvent {
  id: string;
  at: string;
  type: NeuralEventType;
  node: NeuralNodeId;
  target?: NeuralNodeId;
  label: string;
  detail?: string;
  value?: number;
  progress?: number;
  durationMs?: number;
  tokens?: number;
  conversationId?: string;
  data?: Record<string, unknown>;
}
export interface NeuralNodeState {
  id: NeuralNodeId;
  label: string;
  kind: 'core' | 'memory' | 'model' | 'channel' | 'tool' | 'state';
  status: 'idle' | 'active' | 'busy' | 'error' | 'offline';
  activity: number;
  lastEventAt?: string;
  latencyMs?: number;
  detail?: string;
}
export interface NeuralEdge { from: NeuralNodeId; to: NeuralNodeId; weight: number; active: number; }
export interface NeuralSnapshot {
  events: NeuralEvent[];
  nodes: NeuralNodeState[];
  edges: NeuralEdge[];
  stats: {
    thinking: boolean; phase: string; progress: number; eventsPerMin: number;
    tokensThisTurn: number; latencyMs: number; conversationId?: string; startedAt?: string;
  };
  costToday: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 真实用量与费用
// ---------------------------------------------------------------------------
export interface BillingSettings {
  monthlyBudgetCny: number;
  deepseekInputPerMillion: number;
  deepseekOutputPerMillion: number;
  deepseekReasonerInputPerMillion: number;
  deepseekReasonerOutputPerMillion: number;
  breezePerKChar: number;
  minimaxImage: number;
  minimaxVideoSecond: number;
  sunoTrack: number;
  serperSearch: number;
  deepseekSearchPerCall: number;
}
export interface ProviderBalance {
  provider: 'deepseek' | 'breezeblue' | 'minimax' | 'suno' | 'serper';
  label: string;
  available: boolean;
  balance?: number;
  currency?: string;
  unit?: string;
  detail?: string;
  error?: string;
  updatedAt: string;
  sourceUrl?: string;
}

export type UsageProvider = 'deepseek' | 'breezeblue' | 'minimax' | 'suno' | 'serper' | 'bilibili' | 'napcat' | 'memory' | 'other';
export type UsageKind = 'llm' | 'tts' | 'image' | 'video' | 'music' | 'search' | 'message' | 'other';
export interface UsageEntry {
  id: string;
  at: string;
  provider: UsageProvider;
  service: string;
  kind: UsageKind;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  units: number;
  unit: 'tokens' | 'characters' | 'images' | 'seconds' | 'tracks' | 'requests' | 'messages';
  costCny: number;
  meta?: Record<string, unknown>;
}
export interface UsageTotals { calls: number; costCny: number; inputTokens: number; outputTokens: number; totalTokens: number; units: number; }
export interface UsageByProvider { provider: UsageProvider; label: string; calls: number; costCny: number; units: number; unit: string; tokens: number; percent: number; }
export interface UsageDay { date: string; costCny: number; calls: number; tokens: number; }
export interface UsageSummary {
  today: UsageTotals;
  month: UsageTotals;
  all: UsageTotals;
  byProvider: UsageByProvider[];
  byDay: UsageDay[];
  recent: UsageEntry[];
  budget: { monthlyCny: number; usedCny: number; remainingCny: number; percent: number };
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// 意识结构：识海 / 原意识 / 心光 / 心流 / 遗忘
// ---------------------------------------------------------------------------
export type SeaPointKind = 'episode' | 'fact' | 'quote' | 'diary' | 'qzone' | 'learning' | 'chat' | 'activity';
export type SeaDepth = 'surface' | 'shallow' | 'deep' | 'abyss';
export interface SeaPoint {
  id: string;
  kind: SeaPointKind;
  title: string;
  text: string;
  at: string;
  docId?: string;
  salience: number;
  depth: SeaDepth;
  connections: number;
  accessCount: number;
  lastRecalledAt?: string;
  tags?: string[];
}
export interface OriginAnchor {
  id: string;
  kind: 'identity' | 'value' | 'promise' | 'first' | 'core';
  text: string;
  weight: number;
  at?: string;
}
export interface OriginSelf {
  personaId: string;
  coreSelf: string;
  anchors: OriginAnchor[];
  updatedAt: string;
  continuity: string;
}
export interface AttentionState {
  conversationId: string;
  focus: string;
  topics: string[];
  unresolved: string[];
  mood: string;
  intensity: number;
  updatedAt: string;
}
export interface MindFlowStep {
  id: string;
  at: string;
  from: string;
  to: string;
  label: string;
  kind: 'perception' | 'association' | 'recall' | 'reason' | 'reply' | 'reflection';
}
export interface MindFlowState {
  conversationId: string;
  current: string;
  chain: MindFlowStep[];
  updatedAt: string;
}
export interface ForgettingStat {
  surface: number;
  shallow: number;
  deep: number;
  abyss: number;
  fadedThisWeek: number;
  reinforced: number;
}
export interface ConsciousnessOverview {
  origin: OriginSelf;
  attention: AttentionState[];
  flows: MindFlowState[];
  points: SeaPoint[];
  forgetting: ForgettingStat;
  continuity: { lastSeenAt: string; lastTopics: string[]; openLoops: string[]; brief: string };
  generatedAt: string;
}

export type MessageRole = 'user' | 'assistant' | 'system';
export type StickerSource = 'builtin' | 'saved' | 'generated' | 'collected';
export type StickerMood = 'happy' | 'sad' | 'angry' | 'tired' | 'shy' | 'comfort' | 'food' | 'work' | 'greeting' | 'tease' | 'love' | 'neutral';

/** 一张属于她的表情包：内置鲸鱼娘、用户收藏、或她自主生成/收集的。 */
export interface StickerItem {
  id: string;
  name: string;
  url: string;
  /** 落盘文件（用户上传或生成时），内置素材为空。 */
  file?: string;
  source: StickerSource;
  tags: string[];
  moods: StickerMood[];
  description?: string;
  favorite: boolean;
  enabled: boolean;
  whale: boolean;
  createdAt: string;
  lastUsedAt?: string;
  useCount: number;
  width?: number;
  height?: number;
}

export interface ChatToolSettings {
  enabled: boolean;
  imageEnabled: boolean;
  videoEnabled: boolean;
  musicEnabled: boolean;
  allowedRoles: PermissionRole[];
  imageDailyLimit: number;
  videoDailyLimit: number;
  musicDailyLimit: number;
  cooldownSeconds: number;
}

export interface StickerSettings {
  enabled: boolean;
  autoSendInChat: boolean;
  autoAttachInQzone: boolean;
  autoCollect: boolean;
  autoCollectPerDay: number;
  autoSendChance: number;
  qzoneChance: number;
}

export interface StickerOverview {
  items: StickerItem[];
  total: number;
  favorites: number;
  generated: number;
  tags: string[];
  lastCollectedAt?: string;
  todayGenerated: number;
  autoCollect: boolean;
}

export interface ChatAttachment {
  kind: 'image' | 'voice' | 'video' | 'music' | 'file' | 'sticker';
  url?: string;
  localPath?: string;
  name?: string;
  durationMs?: number;
}
export interface ChatMessage {
  id: string;
  conversationId: string;
  role: MessageRole;
  text: string;
  createdAt: string;
  senderId?: string;
  senderName?: string;
  avatar?: string;
  scene: Scene | 'local';
  attachments?: ChatAttachment[];
  meta?: {
    personaId?: string;
    mood?: string;
    tokens?: number;
    model?: string;
    source?: 'qq' | 'local' | 'autonomy';
    error?: string;
    memoryFacts?: string[];
    compressed?: boolean;
    voiceUrl?: string;
    reasoning?: string;
  };
}
export interface Conversation {
  id: string;
  scene: Scene;
  peerId: string;
  peerName: string;
  peerAvatar?: string;
  groupId?: string;
  groupName?: string;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
  messageCount: number;
  personaId: string;
  pinned?: boolean;
  isDemo?: boolean;
}
export interface ChatContextInfo {
  estimatedTokens: number;
  maxTokens: number;
  compacted: boolean;
  memoryHits: number;
  rawMessages: number;
  summaryVersion: number;
}

export interface PluginConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select' | 'textarea';
  description?: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
  default?: unknown;
}
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  category: 'core' | 'channel' | 'creation' | 'knowledge' | 'autonomy' | 'utility';
  icon: string;
  enabled: boolean;
  builtin: boolean;
  configured: boolean;
  status: 'ready' | 'needs-config' | 'disabled' | 'error';
  actions: { id: string; label: string; description?: string }[];
  configFields: PluginConfigField[];
  config: Record<string, unknown>;
  usage?: string;
}
export interface IntegrationStatus {
  id: ServiceId;
  label: string;
  configured: boolean;
  connected: boolean;
  detail: string;
  lastChecked?: string;
  latencyMs?: number;
}
export interface VoiceInfo {
  voiceId: string;
  name: string;
  language?: string;
  gender?: string;
  age?: string;
  accent?: string;
  tone?: string[];
  createdAt?: string;
  previewUrl?: string;
  category?: string;
  isLatest?: boolean;
}
export interface MediaJob {
  id: string;
  kind: 'image' | 'video' | 'music' | 'tts' | 'search';
  status: 'queued' | 'running' | 'done' | 'failed';
  prompt: string;
  createdAt: string;
  result?: { urls?: string[]; audioUrl?: string; coverUrl?: string; title?: string; durationSec?: number; text?: string; sources?: { title: string; url: string; snippet?: string }[] };
  error?: string;
  provider: string;
}

export type NapCatStatusKind = 'stopped' | 'starting' | 'running' | 'online' | 'error' | 'installing' | 'waiting-login';
export interface NapCatStatus {
  kind: NapCatStatusKind;
  installed: boolean;
  installDir: string;
  version?: string;
  uin?: string;
  nickname?: string;
  qqOnline: boolean;
  oneBotConnected: boolean;
  consoleLines: number;
  startedAt?: string;
  uptimeSec: number;
  webuiUrl: string;
  qrCodeDataUrl?: string;
  lastError?: string;
  loginQrPath?: string;
  hiddenWindowCount?: number;
  autoInstallHint?: string;
}
export interface NapCatLogLine { id: number; time: string; level: 'info' | 'warn' | 'error' | 'debug' | 'chat'; text: string; }
export interface NapCatFileStatus { label: string; path: string; exists: boolean; }

export interface BootstrapData {
  settings: AppSettings;
  keyStatus: ApiKeyStatus;
  personas: Persona[];
  conversations: Conversation[];
  memory: MemorySummary;
  overview: GrowthOverview;
  plugins: PluginInfo[];
  integrations: IntegrationStatus[];
  napcat: NapCatStatus;
  petAssets: PetAsset[];
  version: string;
  dataDir: string;
  isFirstRun: boolean;
}
export interface PetAsset {
  name: string;
  webm?: string;
  gif?: string;
  category: 'animation' | 'gif' | 'meme';
  description?: string;
  local?: boolean;
}
export interface AppStats {
  totalMessages: number;
  todayMessages: number;
  contacts: number;
  groups: number;
  memoryFacts: number;
  diaryCount: number;
  qzoneCount: number;
  online: boolean;
  uptimeSec: number;
  tokensToday: number;
  actionsToday: number;
}
export interface CreationItem {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'voice' | 'file';
  url: string;
  size: number;
  createdAt: string;
  relativePath: string;
}

export interface ApiResult<T = unknown> { ok: boolean; data?: T; error?: string; code?: string; }
export interface ToastPayload { type: 'success' | 'error' | 'info' | 'warning'; title: string; message?: string; }
export interface AppEventMap {
  'toast': ToastPayload;
  'neural:event': NeuralEvent;
  'neural:snapshot': NeuralSnapshot;
  'usage:update': UsageSummary;
  'consciousness:update': ConsciousnessOverview;
  'stickers:update': StickerOverview;
  'chat:message': { message: ChatMessage; conversation: Conversation };
  'chat:typing': { conversationId: string; typing: boolean };
  'napcat:log': NapCatLogLine;
  'napcat:status': NapCatStatus;
  'napcat:qr': { dataUrl: string; path?: string };
  'activity:new': ActivityItem;
  'growth:update': GrowthOverview;
  'persona:change': { personaId: string };
  'memory:update': MemorySummary;
  'settings:update': { settings: AppSettings; keyStatus: ApiKeyStatus };
  'integration:status': IntegrationStatus[];
  'app:navigate': { route: string };
  'app:ready': { version: string };
}
export type AppEventName = keyof AppEventMap;

export interface ChatSendParams { conversationId: string; text: string; simulate?: boolean; personaId?: string; attachments?: ChatAttachment[]; }
export interface ChatSendResult { userMessage?: ChatMessage; reply?: ChatMessage; conversation: Conversation; context?: ChatContextInfo; error?: string; }
export interface GeneratePersonaParams { baseId: string; name: string; traits: string; style: string; userPrompt: string; }
export interface SavePersonaParams { persona: Partial<Persona> & { id?: string; name: string }; }
export interface VoiceSyncResult { voices: VoiceInfo[]; latestVoiceId?: string; total: number; syncedAt: string; }
export interface SearchResultItem { title: string; url: string; snippet: string; source?: string; date?: string; }
export interface MemoryReadResult { doc: MemoryDoc; markdown: string; path: string; }
export interface DiaryGenerateResult { entry: DiaryEntry; path: string; }
export interface QzoneGenerateResult { post: QzonePost; posted: boolean; error?: string; }
export interface NapCatInstallResult { ok: boolean; installDir?: string; message: string; log?: string[]; }
export interface NapCatDiagnostics {
  files: NapCatFileStatus[];
  ports: { name: string; port: number; listening: boolean }[];
  qqProcesses: { pid: number; name: string; title?: string; hidden?: boolean }[];
  recommendations: string[];
}
export interface AutonomyTriggerResult { activity?: ActivityItem; message?: string; skippedReason?: string; }
