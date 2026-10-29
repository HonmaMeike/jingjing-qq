import type {
  AppSettings, ApiKeyStatus, ApiKeys, BootstrapData, ChatMessage, ChatAttachment, ChatSendParams, ChatSendResult,
  Conversation, DiaryEntry, DiaryGenerateResult, GeneratePersonaParams, GrowthOverview, IntegrationStatus,
  LearningNote, MediaJob, MemoryDoc, MemoryReadResult, MemorySearchHit, MemorySummary, NapCatDiagnostics,
  NapCatInstallResult, NapCatLogLine, NapCatStatus, Persona, PluginInfo, QzoneGenerateResult, QzonePost,
  SearchResultItem, ServiceId, VoiceInfo, CreationItem, VoiceSyncResult, AppEventMap, AppEventName, ActivityType,
  AutonomyTriggerResult, ActivityItem, BiliDiscovery, RelationshipState, NeuralSnapshot, UsageSummary,
  UsageEntry, BillingSettings, ConsciousnessOverview, SeaPoint, ProviderBalance, StickerItem, StickerMood, StickerOverview, StickerSettings,
} from './types';

export const IPC_INVOKE = 'jingjing:invoke';
export const IPC_EVENT = 'jingjing:event';

export type InvokeParams = Record<string, unknown> | undefined;

export interface IpcMethodMap {
  'app:bootstrap': { params: undefined; result: BootstrapData };
  'media:creations': { params: undefined; result: CreationItem[] };
  'app:stats': { params: undefined; result: { totalMessages: number; todayMessages: number; contacts: number; groups: number; memoryFacts: number; diaryCount: number; qzoneCount: number; online: boolean; uptimeSec: number; tokensToday: number; actionsToday: number } };
  'app:info': { params: undefined; result: { version: string; electron: string; platform: string; dataDir: string; logFile: string } };
  'app:complete-onboarding': { params: { done: boolean }; result: AppSettings };
  'app:open-external': { params: { url: string }; result: boolean };
  'app:open-path': { params: { path: string }; result: boolean };
  'app:quit': { params: undefined; result: boolean };
  'app:reset-data': { params: undefined; result: { removed: string[] } };

  'settings:get': { params: undefined; result: { settings: AppSettings; keyStatus: ApiKeyStatus; maskedKeys: Partial<Record<keyof ApiKeys, string>> } };
  'settings:save': { params: { patch?: Partial<AppSettings>; secrets?: Partial<ApiKeys> }; result: { settings: AppSettings; keyStatus: ApiKeyStatus } };
  'settings:test': { params: { service: ServiceId }; result: { ok: boolean; message: string; latencyMs?: number; detail?: string } };
  'settings:clear-demo': { params: undefined; result: { ok: boolean; removed: number } };
  'settings:reset': { params: undefined; result: { settings: AppSettings; keyStatus: ApiKeyStatus } };
  'settings:export': { params: undefined; result: { ok: boolean; path?: string; error?: string } };
  'settings:pick-assets': { params: undefined; result: { path: string } };

  'personas:list': { params: undefined; result: Persona[] };
  'personas:set-active': { params: { personaId: string }; result: { persona: Persona; settings: AppSettings } };
  'personas:save': { params: { persona: Partial<Persona> & { name: string } }; result: Persona };
  'personas:delete': { params: { personaId: string }; result: { ok: boolean } };
  'personas:generate': { params: GeneratePersonaParams; result: Persona };
  'personas:preview-prompt': { params: { personaId?: string }; result: { prompt: string; tokens: number } };

  'chat:conversations': { params: undefined; result: Conversation[] };
  'chat:messages': { params: { conversationId: string; limit?: number }; result: ChatMessage[] };
  'chat:share-creation': { params: { kind: ChatAttachment['kind']; url: string; title?: string }; result: { message: ChatMessage; conversation: Conversation } };
  'chat:send': { params: ChatSendParams; result: ChatSendResult };
  'chat:create': { params: { peerName: string; scene?: 'private' | 'group'; peerId?: string; demo?: boolean }; result: Conversation };
  'chat:clear': { params: { conversationId: string }; result: { ok: boolean } };
  'chat:delete': { params: { conversationId: string }; result: { ok: boolean } };
  'chat:set-persona': { params: { conversationId: string; personaId: string }; result: Conversation };
  'chat:simulate': { params: { conversationId: string; senderName: string; text: string }; result: ChatSendResult };

  'memory:summary': { params: undefined; result: MemorySummary };
  'memory:read': { params: { docId: string }; result: MemoryReadResult };
  'memory:save': { params: { docId: string; markdown: string }; result: MemoryReadResult };
  'memory:search': { params: { query: string }; result: MemorySearchHit[] };
  'memory:forget': { params: { docId: string; factId?: string }; result: MemoryReadResult };
  'memory:delete': { params: { docId: string }; result: { ok: boolean } };
  'memory:open-folder': { params: undefined; result: boolean };
  'memory:relationship': { params: { docId: string }; result: RelationshipState };

  'growth:overview': { params: undefined; result: GrowthOverview };
  'growth:trigger': { params: { kind: ActivityType; force?: boolean }; result: AutonomyTriggerResult };
  'growth:diary-generate': { params: { force?: boolean }; result: DiaryGenerateResult };
  'growth:diary-list': { params: undefined; result: DiaryEntry[] };
  'growth:diary-read': { params: { id: string }; result: DiaryEntry };
  'growth:qzone-generate': { params: { prompt?: string; autoPost?: boolean }; result: QzoneGenerateResult };
  'growth:qzone-list': { params: undefined; result: QzonePost[] };
  'growth:bili-refresh': { params: undefined; result: BiliDiscovery[] };
  'growth:learn': { params: { topic?: string }; result: LearningNote | { error: string } };
  'growth:activity-list': { params: { limit?: number }; result: ActivityItem[] };

  'plugins:list': { params: undefined; result: PluginInfo[] };
  'plugins:toggle': { params: { pluginId: string; enabled: boolean }; result: PluginInfo[] };
  'plugins:configure': { params: { pluginId: string; config: Record<string, unknown> }; result: PluginInfo[] };
  'plugins:run': { params: { pluginId: string; action: string }; result: { ok: boolean; message: string; data?: unknown } };
  'plugins:import': { params: undefined; result: PluginInfo | null };
  'plugins:open-folder': { params: undefined; result: boolean };

  'napcat:status': { params: undefined; result: NapCatStatus };
  'napcat:install': { params: { method?: 'onekey' | 'existing' }; result: NapCatInstallResult };
  'napcat:start': { params: undefined; result: NapCatStatus };
  'napcat:stop': { params: undefined; result: NapCatStatus };
  'napcat:restart': { params: undefined; result: NapCatStatus };
  'napcat:command': { params: { command: string }; result: { ok: boolean; message: string } };
  'napcat:logs': { params: { limit?: number }; result: NapCatLogLine[] };
  'napcat:diagnostics': { params: undefined; result: NapCatDiagnostics };
  'napcat:save': { params: { config: Partial<AppSettings['napcat']> }; result: NapCatStatus };
  'napcat:hide-windows': { params: undefined; result: { hidden: number } };
  'napcat:open-webui': { params: { url: string }; result: boolean };
  'napcat:qr': { params: undefined; result: { dataUrl?: string; path?: string } };

  'integrations:status': { params: undefined; result: IntegrationStatus[] };
  'integrations:voices': { params: { refresh?: boolean }; result: VoiceSyncResult };
  'integrations:test': { params: { service: ServiceId }; result: { ok: boolean; message: string; latencyMs?: number } };
  'integrations:search': { params: { query: string; type?: 'search' | 'news' | 'images' }; result: SearchResultItem[] };
  'integrations:fetch': { params: { url: string }; result: { url: string; title?: string; content: string; description?: string; siteName?: string; publishedAt?: string } };
  'integrations:image': { params: { prompt: string; aspectRatio?: string }; result: MediaJob };
  'integrations:video': { params: { prompt: string; duration?: number; resolution?: string }; result: MediaJob };
  'integrations:music': { params: { prompt: string; title?: string; instrumental?: boolean; style?: string; lyrics?: string; vocalGender?: 'm' | 'f' }; result: MediaJob };
  'integrations:tts': { params: { text: string; personaId?: string; voiceId?: string }; result: { ok: boolean; url?: string; filePath?: string; error?: string } };
  'integrations:bili': { params: { refresh?: boolean }; result: BiliDiscovery[] };

  'pet:list': { params: undefined; result: BootstrapData['petAssets'] };

  'neural:snapshot': { params: undefined; result: NeuralSnapshot };
  'neural:clear': { params: undefined; result: { ok: boolean } };
  'usage:summary': { params: undefined; result: UsageSummary };
  'usage:list': { params: { limit?: number }; result: UsageEntry[] };
  'usage:clear': { params: undefined; result: { ok: boolean } };
  'usage:billing': { params: { billing: Partial<BillingSettings> }; result: { settings: AppSettings; summary: UsageSummary } };
  'usage:balances': { params: undefined; result: ProviderBalance[] };
  'consciousness:overview': { params: undefined; result: ConsciousnessOverview };
  'consciousness:search': { params: { query: string; limit?: number }; result: SeaPoint[] };
  'consciousness:resume': { params: undefined; result: { brief: string; overview: ConsciousnessOverview } };

  'stickers:overview': { params: undefined; result: StickerOverview };
  'stickers:save': { params: { dataUrl: string; name?: string; tags?: string[]; moods?: StickerMood[]; favorite?: boolean }; result: StickerItem };
  'stickers:update': { params: { id: string; patch: Partial<Pick<StickerItem, 'name' | 'favorite' | 'enabled' | 'tags' | 'moods' | 'description'>> }; result: StickerItem | null };
  'stickers:delete': { params: { id: string }; result: boolean };
  'stickers:collect': { params: undefined; result: StickerItem | null };
  'stickers:settings': { params: Partial<StickerSettings>; result: StickerSettings };
}
export type IpcMethod = keyof IpcMethodMap;
export interface IpcRequest<M extends IpcMethod = IpcMethod> { method: M; params: IpcMethodMap[M]['params']; }
export interface IpcResponse<T = unknown> { ok: boolean; data?: T; error?: string; code?: string; }
export type IpcEventPayload = { channel: AppEventName; payload: AppEventMap[AppEventName] };

export interface WindowControls {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onMaximizeChange(cb: (maximized: boolean) => void): () => void;
}
export interface JingjingBridge {
  invoke<M extends IpcMethod>(method: M, params?: IpcMethodMap[M]['params']): Promise<IpcResponse<IpcMethodMap[M]['result']>>;
  on<K extends AppEventName>(channel: K, cb: (payload: AppEventMap[K]) => void): () => void;
  once<K extends AppEventName>(channel: K, cb: (payload: AppEventMap[K]) => void): () => void;
  window: WindowControls;
  platform: NodeJS.Platform;
  versions: { app: string; electron: string; chrome: string; node: string };
}
