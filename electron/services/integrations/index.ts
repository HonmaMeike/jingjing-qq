/**
 * 第三方 API 集成层统一出口。
 *
 * 主进程只需：
 * ```ts
 * const integrations = createIntegrationsFromSettings(settings, apiKeys);
 * const reply = await integrations.deepseek.chat(messages, { reasoning: false });
 * const voice = await integrations.breezeblue.synthesize({ text: '[轻笑]早上好呀' });
 * ```
 *
 * 所有客户端都允许在「未配置密钥」时先构建（方便设置页保存后重建容器），
 * 真正调用对应方法时才会抛出 code=MISSING_API_KEY 的 IntegrationError。
 * 所有网络错误统一为 IntegrationError（service / status / message / code / retryable）。
 */
import type {
  ApiKeys,
  AppSettings,
  EndpointSettings,
  IntegrationStatus,
  ModelSettings,
  ServiceId,
} from '../../../shared/types';
import { describeError, SERVICE_LABELS, type ConnectionTestResult } from './http';
import { DeepSeekClient, type DeepSeekClientOptions } from './deepseek';
import { BreezeBlueClient, type BreezeBlueClientOptions } from './breezeblue';
import { MinimaxClient, type MinimaxClientOptions } from './minimax';
import { SunoClient, type SunoClientOptions } from './suno';
import { SerperClient, type SerperClientOptions } from './serper';
import { BilibiliClient, type BilibiliClientOptions } from './bilibili';

export * from './http';
export * from './deepseek';
export * from './breezeblue';
export * from './minimax';
export * from './suno';
export * from './serper';
export * from './bilibili';

/** 集成层负责的服务（napcat 由 OneBot 通道单独处理）。 */
export type IntegrationServiceId = Exclude<ServiceId, 'napcat'>;

export const INTEGRATION_SERVICE_IDS: readonly IntegrationServiceId[] = [
  'deepseek',
  'breezeblue',
  'minimax',
  'suno',
  'serper',
  'bilibili',
];

export interface IntegrationConfig {
  apiKeys?: Partial<ApiKeys>;
  endpoints?: Partial<EndpointSettings>;
  models?: Partial<ModelSettings>;
  deepseek?: Partial<Omit<DeepSeekClientOptions, 'apiKey'>>;
  breezeblue?: Partial<Omit<BreezeBlueClientOptions, 'apiKey'>>;
  minimax?: Partial<Omit<MinimaxClientOptions, 'apiKey'>>;
  suno?: Partial<Omit<SunoClientOptions, 'apiKey'>>;
  serper?: Partial<Omit<SerperClientOptions, 'apiKey'>>;
  /** B 站无需密钥，cookie 可选。 */
  bilibili?: Partial<BilibiliClientOptions>;
  /** 全局默认超时（毫秒），各服务未单独指定时生效。 */
  timeoutMs?: number;
}

export interface IntegrationServices {
  readonly deepseek: DeepSeekClient;
  readonly breezeblue: BreezeBlueClient;
  readonly minimax: MinimaxClient;
  readonly suno: SunoClient;
  readonly serper: SerperClient;
  readonly bilibili: BilibiliClient;
  /** 构建容器时使用的原始配置（只读快照）。 */
  readonly config: IntegrationConfig;
  /** 是否已具备调用条件（B 站恒为 true，其余看密钥）。 */
  has(id: IntegrationServiceId): boolean;
  /** 同步状态快照（不发起网络请求），用于设置页/插件列表渲染。 */
  status(): IntegrationStatus[];
  /** 单个服务连通性探测，永不抛出。 */
  probe(id: IntegrationServiceId): Promise<IntegrationStatus>;
  /** 并发探测全部服务，单个失败不影响其它服务，永不抛出。 */
  probeAll(): Promise<IntegrationStatus[]>;
}

interface ProbeableClient {
  testConnection(): Promise<ConnectionTestResult>;
}

function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 构建集成服务容器（供主进程 service 容器注入）。
 * 未配置密钥的客户端也会被创建，调用时返回 MISSING_API_KEY，避免设置页保存前崩溃。
 */
export function createIntegrationServices(config: IntegrationConfig = {}): IntegrationServices {
  const keys = config.apiKeys ?? {};
  const endpoints = config.endpoints ?? {};
  const models = config.models ?? {};
  const globalTimeoutMs = config.timeoutMs;

  const deepseek = new DeepSeekClient({
    ...config.deepseek,
    apiKey: keys.deepseek ?? '',
    baseUrl: endpoints.deepseekBaseUrl || config.deepseek?.baseUrl,
    model: models.deepseekChat || config.deepseek?.model,
    reasoningModel: models.deepseekReasoning || config.deepseek?.reasoningModel,
    timeoutMs: config.deepseek?.timeoutMs ?? globalTimeoutMs,
  });

  const breezeblue = new BreezeBlueClient({
    ...config.breezeblue,
    apiKey: keys.breezeblue ?? '',
    baseUrl: endpoints.breezeblueBaseUrl || config.breezeblue?.baseUrl,
    modelId: models.breezeTts || config.breezeblue?.modelId,
    voiceId: models.breezeVoiceId || config.breezeblue?.voiceId,
    timeoutMs: config.breezeblue?.timeoutMs ?? globalTimeoutMs,
  });

  const minimax = new MinimaxClient({
    ...config.minimax,
    apiKey: keys.minimax ?? '',
    baseUrl: endpoints.minimaxBaseUrl || config.minimax?.baseUrl,
    imageModel: models.minimaxImage || config.minimax?.imageModel,
    videoModel: models.minimaxVideo || config.minimax?.videoModel,
    videoResolution: models.minimaxVideoResolution || config.minimax?.videoResolution,
    videoDuration: models.minimaxVideoDuration ?? config.minimax?.videoDuration,
    timeoutMs: config.minimax?.timeoutMs ?? globalTimeoutMs,
  });

  const suno = new SunoClient({
    ...config.suno,
    apiKey: keys.suno ?? '',
    baseUrl: endpoints.sunoBaseUrl || config.suno?.baseUrl,
    model: models.suno || config.suno?.model,
    timeoutMs: config.suno?.timeoutMs ?? globalTimeoutMs,
  });

  const serper = new SerperClient({
    ...config.serper,
    apiKey: keys.serper ?? '',
    baseUrl: endpoints.serperBaseUrl || config.serper?.baseUrl,
    timeoutMs: config.serper?.timeoutMs ?? globalTimeoutMs,
  });

  const bilibili = new BilibiliClient({
    ...config.bilibili,
    timeoutMs: config.bilibili?.timeoutMs ?? globalTimeoutMs,
  });

  const clients: Record<IntegrationServiceId, ProbeableClient> = {
    deepseek,
    breezeblue,
    minimax,
    suno,
    serper,
    bilibili,
  };

  const configured: Record<IntegrationServiceId, boolean> = {
    deepseek: hasValue(keys.deepseek),
    breezeblue: hasValue(keys.breezeblue),
    minimax: hasValue(keys.minimax),
    suno: hasValue(keys.suno),
    serper: hasValue(keys.serper),
    // B 站公开 API 无需密钥
    bilibili: true,
  };

  const labelOf = (id: IntegrationServiceId): string => SERVICE_LABELS[id];

  const has = (id: IntegrationServiceId): boolean => configured[id] === true;

  const status = (): IntegrationStatus[] =>
    INTEGRATION_SERVICE_IDS.map((id) => ({
      id,
      label: labelOf(id),
      configured: has(id),
      connected: false,
      detail: has(id) ? '尚未检测' : '未配置 API Key',
    }));

  const probe = async (id: IntegrationServiceId): Promise<IntegrationStatus> => {
    const label = labelOf(id);
    if (!has(id)) {
      return {
        id,
        label,
        configured: false,
        connected: false,
        detail: '未配置 API Key',
        lastChecked: new Date().toISOString(),
      };
    }
    const startedAt = Date.now();
    try {
      const result = await clients[id].testConnection();
      return {
        id,
        label,
        configured: true,
        connected: result.ok,
        detail: result.detail,
        lastChecked: result.checkedAt,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      return {
        id,
        label,
        configured: true,
        connected: false,
        detail: describeError(error),
        lastChecked: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
      };
    }
  };

  const probeAll = async (): Promise<IntegrationStatus[]> =>
    Promise.all(INTEGRATION_SERVICE_IDS.map((id) => probe(id)));

  return {
    deepseek,
    breezeblue,
    minimax,
    suno,
    serper,
    bilibili,
    config,
    has,
    status,
    probe,
    probeAll,
  };
}

/**
 * 从应用设置 + 已解密密钥直接构建集成容器（主进程最常用的入口）。
 * 端点与模型设置变更后重建容器即可热生效。
 */
export function createIntegrationsFromSettings(
  settings: AppSettings,
  apiKeys: ApiKeys,
): IntegrationServices {
  return createIntegrationServices({
    apiKeys: { ...apiKeys },
    endpoints: settings.endpoints,
    models: settings.models,
    bilibili: { cookie: settings.bilibili.cookie },
  });
}

/** 服务容器上的便捷导出：探测全部服务并返回 IntegrationStatus[]。 */
export async function probeIntegrations(
  services: IntegrationServices,
): Promise<IntegrationStatus[]> {
  return services.probeAll();
}
