import type { JingjingBridge } from '@shared/ipc';
import type {
  AppEventMap, AppEventName, AppSettings, ApiKeyStatus, ApiKeys, BootstrapData,
  ChatMessage, ChatSendParams, ChatSendResult, Conversation, DiaryEntry, DiaryGenerateResult,
  GeneratePersonaParams, GrowthOverview, IntegrationStatus, LearningNote, MediaJob,
  MemoryDoc, MemoryReadResult, MemorySearchHit, MemorySummary, NapCatDiagnostics,
  NapCatInstallResult, NapCatLogLine, NapCatStatus, Persona, PluginInfo, QzoneGenerateResult,
  QzonePost, RelationshipState, SearchResultItem, ServiceId, VoiceSyncResult, CreationItem, ActivityItem,
  AutonomyTriggerResult, ActivityType, BiliDiscovery, NeuralSnapshot, UsageSummary, UsageEntry,
  BillingSettings, ConsciousnessOverview, SeaPoint, ProviderBalance, StickerItem, StickerMood, StickerOverview, StickerSettings,
} from '@shared/types';

declare global {
  interface Window { jingjing: JingjingBridge; }
}

export function getBridge(): JingjingBridge {
  if (!window.jingjing) throw new Error('桌面桥接未加载，请通过鲸鲸桌面应用启动');
  return window.jingjing;
}

async function invoke<T>(method: string, params?: unknown): Promise<T> {
  const res = await getBridge().invoke(method as never, params as never);
  if (!res.ok) throw new Error(res.error || '操作失败');
  return res.data as T;
}

export const api = {
  bootstrap: () => invoke<BootstrapData>('app:bootstrap'),
  info: () => invoke<{ version: string; electron: string; platform: string; dataDir: string; logFile: string }>('app:info'),
  stats: () => invoke<{ totalMessages: number; todayMessages: number; contacts: number; groups: number; memoryFacts: number; diaryCount: number; qzoneCount: number; online: boolean; uptimeSec: number; tokensToday: number; actionsToday: number }>('app:stats'),
  completeOnboarding: (done = true) => invoke<AppSettings>('app:complete-onboarding', { done }),
  openExternal: (url: string) => invoke<boolean>('app:open-external', { url }),
  openPath: (path: string) => invoke<boolean>('app:open-path', { path }),
  quit: () => invoke<boolean>('app:quit'),
  resetData: () => invoke<{ removed: string[] }>('app:reset-data'),

  settings: {
    get: () => invoke<{ settings: AppSettings; keyStatus: ApiKeyStatus; maskedKeys: Partial<Record<keyof ApiKeys, string>> }>('settings:get'),
    save: (patch?: Partial<AppSettings>, secrets?: Partial<ApiKeys>) => invoke<{ settings: AppSettings; keyStatus: ApiKeyStatus }>('settings:save', { patch, secrets }),
    test: (service: ServiceId) => invoke<{ ok: boolean; message: string; latencyMs?: number; detail?: string }>('settings:test', { service }),
    clearDemo: () => invoke<{ ok: boolean; removed: number }>('settings:clear-demo'),
    reset: () => invoke<{ settings: AppSettings; keyStatus: ApiKeyStatus }>('settings:reset'),
    export: () => invoke<{ ok: boolean; path?: string; error?: string }>('settings:export'),
    pickAssets: () => invoke<{ path: string }>('settings:pick-assets'),
  },

  personas: {
    list: () => invoke<Persona[]>('personas:list'),
    setActive: (personaId: string) => invoke<{ persona: Persona; settings: AppSettings }>('personas:set-active', { personaId }),
    save: (persona: Partial<Persona> & { name: string }) => invoke<Persona>('personas:save', { persona }),
    remove: (personaId: string) => invoke<{ ok: boolean }>('personas:delete', { personaId }),
    generate: (params: GeneratePersonaParams) => invoke<Persona>('personas:generate', params),
    previewPrompt: (personaId?: string) => invoke<{ prompt: string; tokens: number }>('personas:preview-prompt', { personaId }),
  },

  chat: {
    conversations: () => invoke<Conversation[]>('chat:conversations'),
    messages: (conversationId: string, limit = 100) => invoke<ChatMessage[]>('chat:messages', { conversationId, limit }),
    send: (params: ChatSendParams) => invoke<ChatSendResult>('chat:send', params),
    shareCreation: (params: { kind: 'image' | 'video' | 'music' | 'voice' | 'file' | 'sticker'; url: string; title?: string }) => invoke<{ message: import('@shared/types').ChatMessage; conversation: Conversation }>('chat:share-creation', params),
    create: (peerName: string, scene: 'private' | 'group' = 'private', demo = false) => invoke<Conversation>('chat:create', { peerName, scene, demo }),
    clear: (conversationId: string) => invoke<{ ok: boolean }>('chat:clear', { conversationId }),
    remove: (conversationId: string) => invoke<{ ok: boolean }>('chat:delete', { conversationId }),
    setPersona: (conversationId: string, personaId: string) => invoke<Conversation>('chat:set-persona', { conversationId, personaId }),
    simulate: (conversationId: string, senderName: string, text: string) => invoke<ChatSendResult>('chat:simulate', { conversationId, senderName, text }),
  },

  memory: {
    summary: () => invoke<MemorySummary>('memory:summary'),
    read: (docId: string) => invoke<MemoryReadResult>('memory:read', { docId }),
    save: (docId: string, markdown: string) => invoke<MemoryReadResult>('memory:save', { docId, markdown }),
    search: (query: string) => invoke<MemorySearchHit[]>('memory:search', { query }),
    forget: (docId: string, factId?: string) => invoke<MemoryReadResult>('memory:forget', { docId, factId }),
    remove: (docId: string) => invoke<{ ok: boolean }>('memory:delete', { docId }),
    openFolder: () => invoke<boolean>('memory:open-folder'),
    relationship: (docId: string) => invoke<RelationshipState>('memory:relationship', { docId }),
  },

  growth: {
    overview: () => invoke<GrowthOverview>('growth:overview'),
    trigger: (kind: ActivityType, force = false) => invoke<AutonomyTriggerResult>('growth:trigger', { kind, force }),
    diaryGenerate: (force = false) => invoke<DiaryGenerateResult>('growth:diary-generate', { force }),
    diaryList: () => invoke<DiaryEntry[]>('growth:diary-list'),
    diaryRead: (id: string) => invoke<DiaryEntry>('growth:diary-read', { id }),
    qzoneGenerate: (prompt?: string, autoPost = false) => invoke<QzoneGenerateResult>('growth:qzone-generate', { prompt, autoPost }),
    qzoneList: () => invoke<QzonePost[]>('growth:qzone-list'),
    biliRefresh: () => invoke<BiliDiscovery[]>('growth:bili-refresh'),
    learn: (topic?: string) => invoke<LearningNote | { error: string }>('growth:learn', { topic }),
    activityList: (limit = 30) => invoke<ActivityItem[]>('growth:activity-list', { limit }),
  },

  plugins: {
    list: () => invoke<PluginInfo[]>('plugins:list'),
    toggle: (pluginId: string, enabled: boolean) => invoke<PluginInfo[]>('plugins:toggle', { pluginId, enabled }),
    configure: (pluginId: string, config: Record<string, unknown>) => invoke<PluginInfo[]>('plugins:configure', { pluginId, config }),
    run: (pluginId: string, action: string) => invoke<{ ok: boolean; message: string; data?: unknown }>('plugins:run', { pluginId, action }),
    import: () => invoke<import('@shared/types').PluginInfo | null>('plugins:import'),
    openFolder: () => invoke<boolean>('plugins:open-folder'),
  },

  napcat: {
    status: () => invoke<NapCatStatus>('napcat:status'),
    install: (method: 'onekey' | 'existing' = 'onekey') => invoke<NapCatInstallResult>('napcat:install', { method }),
    start: () => invoke<NapCatStatus>('napcat:start'),
    stop: () => invoke<NapCatStatus>('napcat:stop'),
    restart: () => invoke<NapCatStatus>('napcat:restart'),
    command: (command: string) => invoke<{ ok: boolean; message: string }>('napcat:command', { command }),
    logs: (limit = 300) => invoke<NapCatLogLine[]>('napcat:logs', { limit }),
    diagnostics: () => invoke<NapCatDiagnostics>('napcat:diagnostics'),
    save: (config: Partial<AppSettings['napcat']>) => invoke<NapCatStatus>('napcat:save', { config }),
    hideWindows: () => invoke<{ hidden: number }>('napcat:hide-windows'),
    openWebui: (url: string) => invoke<boolean>('napcat:open-webui', { url }),
    qr: () => invoke<{ dataUrl?: string; path?: string }>('napcat:qr'),
  },

  integrations: {
    status: () => invoke<IntegrationStatus[]>('integrations:status'),
    voices: (refresh = false) => invoke<VoiceSyncResult>('integrations:voices', { refresh }),
    test: (service: ServiceId) => invoke<{ ok: boolean; message: string; latencyMs?: number }>('integrations:test', { service }),
    search: (query: string, type: 'search' | 'news' | 'images' = 'search') => invoke<SearchResultItem[]>('integrations:search', { query, type }),
    fetch: (url: string) => invoke<{ url: string; title?: string; content: string; description?: string; siteName?: string; publishedAt?: string }>('integrations:fetch', { url }),
    image: (prompt: string, aspectRatio?: string) => invoke<MediaJob>('integrations:image', { prompt, aspectRatio }),
    video: (prompt: string, duration?: number, resolution?: string) => invoke<MediaJob>('integrations:video', { prompt, duration, resolution }),
    music: (params: { prompt: string; title?: string; instrumental?: boolean; style?: string; lyrics?: string; vocalGender?: 'm' | 'f' }) => invoke<MediaJob>('integrations:music', params),
    tts: (text: string, personaId?: string, voiceId?: string) => invoke<{ ok: boolean; url?: string; filePath?: string; error?: string }>('integrations:tts', { text, personaId, voiceId }),
    bili: (refresh = false) => invoke<BiliDiscovery[]>('integrations:bili', { refresh }),
  },

  pet: {
    list: () => invoke<BootstrapData['petAssets']>('pet:list'),
  },

  neural: {
    snapshot: () => invoke<NeuralSnapshot>('neural:snapshot'),
    clear: () => invoke<{ ok: boolean }>('neural:clear'),
  },

  media: {
    creations: () => invoke<CreationItem[]>('media:creations'),
  },
  usage: {
    summary: () => invoke<UsageSummary>('usage:summary'),
    list: (limit = 200) => invoke<UsageEntry[]>('usage:list', { limit }),
    clear: () => invoke<{ ok: boolean }>('usage:clear'),
    saveBilling: (billing: Partial<BillingSettings>) => invoke<{ settings: AppSettings; summary: UsageSummary }>('usage:billing', { billing }),
    balances: () => invoke<ProviderBalance[]>('usage:balances'),
  },

  consciousness: {
    overview: () => invoke<ConsciousnessOverview>('consciousness:overview'),
    search: (query: string, limit = 20) => invoke<SeaPoint[]>('consciousness:search', { query, limit }),
    resume: () => invoke<{ brief: string; overview: ConsciousnessOverview }>('consciousness:resume'),
  },

  stickers: {
    overview: () => invoke<StickerOverview>('stickers:overview'),
    save: (input: { dataUrl: string; name?: string; tags?: string[]; moods?: StickerMood[]; favorite?: boolean }) => invoke<StickerItem>('stickers:save', input),
    update: (id: string, patch: Partial<Pick<StickerItem, 'name' | 'favorite' | 'enabled' | 'tags' | 'moods' | 'description'>>) => invoke<StickerItem | null>('stickers:update', { id, patch }),
    remove: (id: string) => invoke<boolean>('stickers:delete', { id }),
    collect: () => invoke<StickerItem | null>('stickers:collect'),
    settings: (patch: Partial<StickerSettings>) => invoke<StickerSettings>('stickers:settings', patch),
  },
};

export const events = {
  on<K extends AppEventName>(channel: K, cb: (payload: AppEventMap[K]) => void): () => void {
    return getBridge().on(channel, cb);
  },
  once<K extends AppEventName>(channel: K, cb: (payload: AppEventMap[K]) => void): () => void {
    return getBridge().once(channel, cb);
  },
};

export const windowControls = {
  minimize: () => getBridge().window.minimize(),
  toggleMaximize: () => getBridge().window.toggleMaximize(),
  close: () => getBridge().window.close(),
  isMaximized: () => getBridge().window.isMaximized(),
  onMaximizeChange: (cb: (v: boolean) => void) => getBridge().window.onMaximizeChange(cb),
};

export type { ChatMessage, Conversation, AppSettings, Persona };
