import type { AppSettings, ApiKeyStatus, ApiKeys } from '../../shared/types';
import { DEFAULT_SETTINGS } from '../config/defaults';
import { JsonStore } from '../core/json-store';
import type { SecretsVault } from '../core/secrets';
import type { EventBus } from '../core/event-bus';
import type { Logger } from '../core/logger';

export class SettingsService {
  private constructor(
    private store: JsonStore<AppSettings>,
    private vault: SecretsVault,
    private events: EventBus,
    private logger: Logger,
  ) {}

  static async create(opts: { file: string; vault: SecretsVault; events: EventBus; logger: Logger }): Promise<SettingsService> {
    const store = await JsonStore.open<AppSettings>(opts.file, DEFAULT_SETTINGS);
    const service = new SettingsService(store, opts.vault, opts.events, opts.logger);
    await service.normalize();
    return service;
  }

  private async normalize(): Promise<void> {
    await this.store.update((t) => {
    if (!t.version) t.version = 1;
    const migrateToV2 = t.version < 2;
    const migrateToV3 = t.version < 3;
    // 2026-10：DeepSeek 官方模型已改为 deepseek-v4-pro / deepseek-flash。
    const legacyDeepSeek = new Set(['deepseek-chat', 'deepseek-reasoner', 'deepseek-v3', 'deepseek-v3.1', 'deepseek-v3.2', 'deepseek-v3.1-terminus']);
    const normalizeDeepSeek = (value: string | undefined): string => {
      if (!value) return 'deepseek-v4-pro';
      if (value === 'deepseek-chat' || value === 'deepseek-v3' || value === 'deepseek-v3.1' || value === 'deepseek-v3.2' || value === 'deepseek-v3.1-terminus') return 'deepseek-flash';
      if (value === 'deepseek-reasoner') return 'deepseek-v4-pro';
      return value;
    };
    t.models.deepseekChat = normalizeDeepSeek(t.models.deepseekChat);
    // v2 默认主模型改为便宜的 flash；旧版默认的 v4-pro 只迁移这一次。
    if (migrateToV2 && (t.models.deepseekChat === 'deepseek-v4-pro' || !t.models.deepseekChat)) t.models.deepseekChat = 'deepseek-flash';
    t.models.deepseekReasoning = normalizeDeepSeek(t.models.deepseekReasoning);
    t.deepseek.model = normalizeDeepSeek(t.deepseek.model);
    t.deepseek.reasoningModel = normalizeDeepSeek(t.deepseek.reasoningModel);
    if (!t.deepseek.reasoningEffort) t.deepseek.reasoningEffort = 'high';
    // 思考模式会消耗 completion token；旧的 1200 上限容易在思考阶段就耗尽。
    if (t.deepseek.useReasoningForChat && (!Number.isFinite(t.deepseek.maxTokens) || t.deepseek.maxTokens < 4096)) {
      t.deepseek.maxTokens = 4096;
    }
    // 2026-10：中国大陆版 MiniMax 与新的 Suno 官方网关。
    if (t.endpoints.minimaxBaseUrl === 'https://api.minimax.io') t.endpoints.minimaxBaseUrl = 'https://api.minimax.cn';
    if (t.endpoints.sunoBaseUrl === 'https://sunoapiorg.redpandaai.co') t.endpoints.sunoBaseUrl = 'https://api.sunoapi.org';
    // 旧的 DeepSeek 字段同步到统一端点，避免两处配置不一致。
    if (t.endpoints.deepseekBaseUrl !== t.deepseek.baseUrl && t.deepseek.baseUrl) {
      t.endpoints.deepseekBaseUrl = t.deepseek.baseUrl;
    }
    // 2026-10：旧的默认 Hailuo 视频模型升级到 MiniMax-H3。
    if (t.models.minimaxVideo === 'MiniMax-Hailuo-2.3' || t.models.minimaxVideo === 'MiniMax-Hailuo-02') {
      t.models.minimaxVideo = 'MiniMax-H3';
    }
    if (t.models.minimaxVideo.startsWith('MiniMax-H3')) {
      const allowed = t.models.minimaxVideo === 'MiniMax-H3' ? ['2K', '768P'] : (t.models.minimaxVideo === 'MiniMax-H3-Lite' || t.models.minimaxVideo === 'MiniMax-H3-Max' ? ['480P', '768P'] : ['768P']);
      if (!allowed.includes(t.models.minimaxVideoResolution)) {
        t.models.minimaxVideoResolution = t.models.minimaxVideo === 'MiniMax-H3' ? '2K' : '768P';
      }
      if (!Number.isFinite(t.models.minimaxVideoDuration) || t.models.minimaxVideoDuration < 4 || t.models.minimaxVideoDuration > 15) {
        t.models.minimaxVideoDuration = 6;
      }
    }
    if (migrateToV2) t.deepseek.model = 'deepseek-flash';
    if (t.deepseek.model !== t.models.deepseekChat) t.models.deepseekChat = t.deepseek.model;
    if (t.deepseek.reasoningModel && t.deepseek.reasoningModel !== t.models.deepseekReasoning) t.models.deepseekReasoning = t.deepseek.reasoningModel;
    if (t.general.theme !== 'light' && t.general.theme !== 'dark' && t.general.theme !== 'system') {
      t.general.theme = 'dark';
    }
    if (migrateToV3) { t.deepseek.useReasoningForChat = false; t.deepseek.reasoningEffort = 'low'; }
    // 旧版本有把 6 当成 6% 的配置；统一转换为 0..1，避免每条都合成语音。
    if (t.tts.voiceReplyChance > 1) t.tts.voiceReplyChance = Math.min(1, t.tts.voiceReplyChance / 100);
    t.version = 3;
    });
  }

  get(): AppSettings { return this.store.get(); }
  getKeyStatus(): ApiKeyStatus { return this.vault.getStatus(); }
  getApiKeys(): ApiKeys { return this.vault.get(); }

  async save(patch: Partial<AppSettings>, secrets?: Partial<ApiKeys>): Promise<{ settings: AppSettings; keyStatus: ApiKeyStatus }> {
    let updated = this.store.get();
    if (patch && Object.keys(patch).length) {
      updated = await this.store.patch(patch);
    }
    if (secrets && Object.keys(secrets).length) {
      await this.vault.set(secrets);
    }
    if (patch?.deepseek?.baseUrl) {
      updated.endpoints.deepseekBaseUrl = patch.deepseek.baseUrl;
      await this.store.patch({ endpoints: { deepseekBaseUrl: patch.deepseek.baseUrl } });
    }
    if (patch?.models?.deepseekChat) {
      updated.deepseek.model = patch.models.deepseekChat;
      await this.store.patch({ deepseek: { model: patch.models.deepseekChat } });
    }
    if (patch?.models?.deepseekReasoning) {
      await this.store.patch({ deepseek: { reasoningModel: patch.models.deepseekReasoning } });
    }
    if (patch?.general?.theme) {
      this.events.emit('theme:change', patch.general.theme);
    }
    const payload = { settings: this.get(), keyStatus: this.getKeyStatus() };
    this.events.emit('settings:update', payload);
    this.logger.info('settings', '设置已保存');
    return payload;
  }

  async setKeyStatusOnly(): Promise<ApiKeyStatus> { return this.vault.getStatus(); }
  async completeOnboarding(): Promise<AppSettings> { return this.store.patch({ onboardingDone: true }); }
  async setDemoMode(enabled: boolean): Promise<AppSettings> { return this.store.patch({ general: { demoMode: enabled } }); }
  getSecret(id: keyof ApiKeys): string { return this.vault.get()[id]; }
  hasSecret(id: keyof ApiKeys): boolean { return this.vault.has(id); }
  maskSecret(id: keyof ApiKeys): string { return this.vault.mask(id); }

  isConfigured(): boolean { return this.vault.has('deepseek'); }

  summary() {
    return {
      botName: this.get().general.botName,
      online: false,
      theme: this.get().general.theme,
      accent: this.get().general.accent,
    };
  }
}
