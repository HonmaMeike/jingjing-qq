import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, ApiKeyStatus, ApiKeys, BootstrapData, Conversation, GrowthOverview, IntegrationStatus, NapCatStatus, Persona, PluginInfo } from '@shared/types';
import { api, events } from '@/lib/api';
import { useToast } from '@/components/ui';

export interface AppContextValue {
  data: BootstrapData | null;
  loading: boolean;
  error: string | null;
  settings: AppSettings;
  keyStatus: ApiKeyStatus;
  personas: Persona[];
  activePersona: Persona;
  conversations: Conversation[];
  overview: GrowthOverview;
  plugins: PluginInfo[];
  integrations: IntegrationStatus[];
  napcat: NapCatStatus;
  petAssets: BootstrapData['petAssets'];
  onboardingOpen: boolean;
  setOnboardingOpen: (open: boolean) => void;
  reload: () => Promise<void>;
  saveSettings: (patch?: Partial<AppSettings>, secrets?: Partial<ApiKeys>) => Promise<void>;
  refreshConversations: () => Promise<void>;
  refreshOverview: () => Promise<void>;
  refreshPlugins: () => Promise<void>;
  refreshIntegrations: () => Promise<void>;
  refreshNapcat: () => Promise<void>;
  refreshPersonas: () => Promise<void>;
  setConversations: React.Dispatch<React.SetStateAction<Conversation[]>>;
  setOverview: React.Dispatch<React.SetStateAction<GrowthOverview>>;
  setNapcat: React.Dispatch<React.SetStateAction<NapCatStatus>>;
  setPersonas: React.Dispatch<React.SetStateAction<Persona[]>>;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setOnboardingDone: () => Promise<void>;
  addConversation: (c: Conversation) => void;
  removeConversation: (id: string) => void;
  patchConversation: (c: Conversation) => void;
}

const AppContext = createContext<AppContextValue | null>(null);
const EMPTY_SETTINGS: AppSettings = {} as AppSettings;
const EMPTY_OVERVIEW: GrowthOverview = { emotion: { mood: '期待', moodEmoji: '🐋', valence: 0.4, arousal: 0.4, energy: 0.8, affection: 0.6, patience: 0.7, jealousy: 0.1, pride: 0.3, updatedAt: new Date().toISOString(), reason: '' }, growth: { level: 1, xp: 0, nextXp: 100, stage: 'stranger', stageName: '初见', stageProgress: 0, traits: {}, habits: [], selfImage: '', evolutionNotes: [], reflections: [], totalMessages: 0, totalDays: 1, streakDays: 1, lastGrownAt: '', personalityDrift: [] }, stages: [], activities: [], diaries: [], qzone: [], bilibili: [], learning: [] };
const EMPTY_NAP: NapCatStatus = { kind: 'stopped', installed: false, installDir: '', qqOnline: false, oneBotConnected: false, consoleLines: 0, uptimeSec: 0, webuiUrl: '' };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const toast = useToast();
  const [data, setData] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings>(EMPTY_SETTINGS);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({ deepseek: false, breezeblue: false, minimax: false, suno: false, serper: false });
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [overview, setOverview] = useState<GrowthOverview>(EMPTY_OVERVIEW);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [napcat, setNapcat] = useState<NapCatStatus>(EMPTY_NAP);
  const [petAssets, setPetAssets] = useState<BootstrapData['petAssets']>([]);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const loadedRef = useRef(false);

  const applyBootstrap = useCallback((b: BootstrapData) => {
    setData(b);
    setSettings(b.settings);
    setKeyStatus(b.keyStatus);
    setPersonas(b.personas);
    setConversations(b.conversations);
    setOverview(b.overview);
    setPlugins(b.plugins);
    setIntegrations(b.integrations);
    setNapcat(b.napcat);
    setPetAssets(b.petAssets);
    setOnboardingOpen(!b.settings.onboardingDone);
    applyTheme(b.settings);
  }, []);

  const reload = useCallback(async () => {
    try {
      setError(null);
      const b = await api.bootstrap();
      applyBootstrap(b);
      loadedRef.current = true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!loadedRef.current) toast.error('初始化失败', e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [applyBootstrap, toast]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    const unsubs = [
      events.on('settings:update', (p) => { setSettings(p.settings); setKeyStatus(p.keyStatus); applyTheme(p.settings); }),
      events.on('persona:change', () => { void api.personas.list().then(setPersonas).catch(() => undefined); }),
      events.on('growth:update', (o) => setOverview(o)),
      events.on('napcat:status', (s) => setNapcat(s)),
      events.on('integration:status', (s) => setIntegrations(s)),
      events.on('toast', (t) => toast.push(t)),
      events.on('chat:message', ({ conversation }) => {
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === conversation.id);
          if (idx < 0) return [conversation, ...prev];
          const next = [...prev]; next[idx] = conversation; return next;
        });
      }),
      events.on('memory:update', () => { /* memory page auto refreshes */ }),
      events.on('app:navigate', ({ route }) => { window.location.hash = `/${route}`; }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [toast]);

  const saveSettings = useCallback(async (patch?: Partial<AppSettings>, secrets?: Partial<ApiKeys>) => {
    const res = await api.settings.save(patch, secrets);
    setSettings(res.settings);
    setKeyStatus(res.keyStatus);
    applyTheme(res.settings);
  }, []);

  const refreshConversations = useCallback(async () => setConversations(await api.chat.conversations()), []);
  const refreshOverview = useCallback(async () => setOverview(await api.growth.overview()), []);
  const refreshPlugins = useCallback(async () => setPlugins(await api.plugins.list()), []);
  const refreshIntegrations = useCallback(async () => setIntegrations(await api.integrations.status()), []);
  const refreshNapcat = useCallback(async () => setNapcat(await api.napcat.status()), []);
  const refreshPersonas = useCallback(async () => setPersonas(await api.personas.list()), []);
  const setOnboardingDone = useCallback(async () => {
    const next = await api.completeOnboarding(true);
    setSettings(next);
    setOnboardingOpen(false);
  }, []);
  const addConversation = useCallback((c: Conversation) => setConversations((prev) => [c, ...prev.filter((x) => x.id !== c.id)]), []);
  const removeConversation = useCallback((id: string) => setConversations((prev) => prev.filter((c) => c.id !== id)), []);
  const patchConversation = useCallback((c: Conversation) => setConversations((prev) => prev.map((x) => x.id === c.id ? c : x)), []);

  const activePersona = useMemo(() => personas.find((p) => p.isActive) ?? personas.find((p) => p.id === settings.persona?.activeId) ?? personas[0], [personas, settings]);
  const value = useMemo<AppContextValue>(() => ({
    data, loading, error, settings, keyStatus, personas, activePersona, conversations, overview, plugins, integrations, napcat, petAssets,
    onboardingOpen, setOnboardingOpen, reload, saveSettings, refreshConversations, refreshOverview, refreshPlugins, refreshIntegrations, refreshNapcat, refreshPersonas,
    setConversations, setOverview, setNapcat, setPersonas, setSettings, setOnboardingDone, addConversation, removeConversation, patchConversation,
  }), [data, loading, error, settings, keyStatus, personas, activePersona, conversations, overview, plugins, integrations, napcat, petAssets, onboardingOpen, reload, saveSettings, refreshConversations, refreshOverview, refreshPlugins, refreshIntegrations, refreshNapcat, refreshPersonas, setOnboardingDone, addConversation, removeConversation, patchConversation]);
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

export function applyTheme(settings: AppSettings): void {
  const root = document.documentElement;
  const theme = settings.general?.theme ?? 'dark';
  const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  root.dataset.theme = resolved;
  root.dataset.accent = settings.general?.accent ?? 'ocean';
}
