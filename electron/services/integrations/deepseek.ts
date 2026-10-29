/**
 * DeepSeek 对话客户端（OpenAI 兼容 /chat/completions，官方 2026-10 版本）。
 *
 * 官方模型（2026-10）：
 * - deepseek-v4-pro（DeepSeek-V4-Pro-0813）
 * - deepseek-flash（DeepSeek-V4.1-Flash-1017）
 * 两者均支持 1M 上下文、最大 384K 输出、JSON / 工具调用；thinking 模式默认开启，
 * 通过 reasoning_effort（low / high / max）控制思考强度，thinking 模式下仍返回 reasoning_content。
 *
 * 支持：
 * - 非流式与流式（SSE）两种模式，流式通过回调逐段返回 content / reasoning_content。
 * - thinking 开关（thinking.type）与 reasoning_effort（仅新模型；旧模型名自动忽略）。
 * - 新模型支持 temperature 与 JSON mode；旧版 deepseek-chat / deepseek-reasoner
 *   仅保留兼容分支（reasoner 自动规避 temperature / response_format），不再作为默认值。
 * - 返回 content、reasoning_content 与 usage，供上下文预算统计。
 *
 * 密钥仅保存在实例字段中，任何方法都不会将其写入日志或错误信息。
 */
import {
  buildUrl,
  httpJson,
  httpStream,
  runConnectionTest,
  toIntegrationError,
  IntegrationError,
  type ConnectionTestResult,
} from './http';

export interface DeepSeekClientOptions {
  apiKey: string;
  /** 默认 https://api.deepseek.com（可带 /v1）。 */
  baseUrl?: string;
  /** 默认对话模型：deepseek-v4-pro（2026-10 官方）。 */
  model?: string;
  /** 默认推理模型：deepseek-v4-pro（2026-10 两个官方模型均支持 thinking）。 */
  reasoningModel?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** 流式读取时两段数据之间的最大空闲时间，默认 60s。 */
  idleTimeoutMs?: number;
  /** thinking 模式默认值，默认 true（官方默认 enabled）。 */
  thinking?: boolean;
  /** reasoning_effort 默认值，默认 high（官方默认）。 */
  reasoningEffort?: ReasoningEffort;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessageContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessageInput {
  role: ChatRole;
  /** 纯文本，或多模态内容数组（DeepSeek 兼容 OpenAI 图片格式）。 */
  content: string | ChatMessageContentPart[];
}

export interface DeepSeekUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** thinking 模式的思维链 token 数（completion_tokens_details.reasoning_tokens）。 */
  reasoningTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  /** reasoning_content；非推理模型为空字符串。 */
  reasoning: string;
  usage?: DeepSeekUsage;
  model: string;
  finishReason?: string;
}

export interface StreamDelta {
  /** 本段新增正文。 */
  content: string;
  /** 本段新增思维链（推理模型）。 */
  reasoning: string;
}

/** 思考强度（官方 reasoning_effort），仅在 thinking 开启时生效。 */
export type ReasoningEffort = 'low' | 'high' | 'max';

export interface ChatOptions {
  model?: string;
  /**
   * 思考模式开关，对应官方 thinking.type（true → enabled，false → disabled）。
   * 默认 enabled；仅 2026-10 新模型生效，旧模型名会自动忽略。
   */
  thinking?: boolean;
  /** 思考强度，对应官方 reasoning_effort，默认 high。 */
  reasoningEffort?: ReasoningEffort;
  /**
   * 旧字段（兼容保留）：true = 使用 reasoningModel（旧 deepseek-reasoner 语义）。
   * 2026-10 两个官方模型都自带 thinking，新代码请直接用 thinking / reasoningEffort。
   */
  reasoning?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** 要求模型返回 JSON（新模型与 deepseek-chat 支持；旧 reasoner 会自动忽略）。 */
  jsonMode?: boolean;
  /** true 时走 SSE 流式；需要同时提供 onDelta。 */
  stream?: boolean;
  /** 每收到一段增量就回调一次。 */
  onDelta?: (delta: StreamDelta) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  /** 网络/5xx 重试次数，默认 0（对话重试可能产生重复计费，谨慎开启）。 */
  retries?: number;
  stop?: string[];
  /** 透传给上游的附加字段（例如 top_p）。 */
  extraBody?: Record<string, unknown>;
}

interface DeepSeekChatResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: { role?: string; content?: string | null; reasoning_content?: string | null };
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

/** 2026-10 官方模型 ID（设置页默认值参考）。 */
export const DEEPSEEK_MODEL_IDS = ['deepseek-v4-pro', 'deepseek-flash'] as const;
export type DeepSeekModelId = (typeof DEEPSEEK_MODEL_IDS)[number];

/** 默认对话模型：DeepSeek-V4-Pro-0813。 */
const DEFAULT_MODEL: DeepSeekModelId = 'deepseek-v4-pro';
/** 默认推理模型：同一模型即支持 thinking，无需再切换旧 reasoner。 */
const DEFAULT_REASONING_MODEL: DeepSeekModelId = 'deepseek-v4-pro';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'high';
const DEFAULT_THINKING = true;

/** 旧模型名（仅兼容分支使用，不参与默认值）。 */
const LEGACY_CHAT_MODEL_PATTERN = /deepseek-chat/i;
const LEGACY_REASONER_MODEL_PATTERN = /deepseek-reasoner/i;

function normalizeUsage(usage: DeepSeekChatResponse['usage']): DeepSeekUsage | undefined {
  if (!usage) return undefined;
  const reasoningTokens = usage.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
    ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
  };
}


export interface DeepSeekSearchResult {
  title: string;
  url: string;
  snippet: string;
  summary?: string;
  content?: string;
  siteName?: string;
  publishedAt?: string;
  authority?: number;
  score?: number;
}

export interface DeepSeekFetchResult {
  url: string;
  title?: string;
  content: string;
  description?: string;
  siteName?: string;
  publishedAt?: string;
}

export class DeepSeekClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly defaultReasoningModel: string;
  private readonly defaultTemperature: number;
  private readonly defaultMaxTokens: number;
  private readonly defaultTimeoutMs: number;
  private readonly defaultIdleTimeoutMs: number;
  private readonly defaultThinking: boolean;
  private readonly defaultReasoningEffort: ReasoningEffort;

  constructor(options: DeepSeekClientOptions) {
    // 允许先创建实例（未配置密钥时调用方法再报错），便于设置页保存后热更新。
    this.apiKey = (options.apiKey ?? '').trim();
    this.baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this.defaultModel = options.model?.trim() || DEFAULT_MODEL;
    this.defaultReasoningModel = options.reasoningModel?.trim() || DEFAULT_REASONING_MODEL;
    this.defaultTemperature = options.temperature ?? 0.8;
    this.defaultMaxTokens = options.maxTokens ?? 4096;
    this.defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.defaultIdleTimeoutMs = options.idleTimeoutMs ?? 60_000;
    this.defaultThinking = options.thinking ?? DEFAULT_THINKING;
    this.defaultReasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
  }

  /** 调用前校验密钥，未配置时抛出统一的 MISSING_API_KEY。 */
  private requireKey(): string {
    if (!this.apiKey) {
      throw new IntegrationError({
        service: 'deepseek',
        code: 'MISSING_API_KEY',
        message: '尚未配置 DeepSeek API Key，请在设置 → API 密钥中填写',
      });
    }
    return this.apiKey;
  }

  /** 当前默认对话模型名（供设置页展示）。 */
  get model(): string {
    return this.defaultModel;
  }

  /** 当前推理模型名（2026-10 与对话模型同源，均为 deepseek-v4-pro）。 */
  get reasoningModel(): string {
    return this.defaultReasoningModel;
  }

  private resolveModel(options: ChatOptions): string {
    if (options.model) return options.model;
    // reasoning 为旧字段兼容：true 时走 reasoningModel（默认已与对话模型同源）。
    return options.reasoning ? this.defaultReasoningModel : this.defaultModel;
  }

  private buildBody(
    messages: readonly ChatMessageInput[],
    options: ChatOptions,
    model: string,
    stream: boolean,
  ): Record<string, unknown> {
    // 2026-10 官方模型支持 thinking / reasoning_effort / temperature / JSON；
    // 仅旧版 deepseek-reasoner 需要规避 temperature 与 response_format。
    const legacyReasoner = LEGACY_REASONER_MODEL_PATTERN.test(model);
    const legacyChat = LEGACY_CHAT_MODEL_PATTERN.test(model);
    const supportsThinking = !legacyReasoner && !legacyChat;
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((message) => ({ role: message.role, content: message.content })),
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      stream,
    };
    if (!legacyReasoner) {
      body.temperature = options.temperature ?? this.defaultTemperature;
      if (options.jsonMode === true) body.response_format = { type: 'json_object' };
    }
    if (supportsThinking) {
      // 官方默认 thinking enabled；disabled 时同样兼容（不返回 reasoning_content）。
      const thinkingEnabled = options.thinking ?? this.defaultThinking;
      body.thinking = { type: thinkingEnabled ? 'enabled' : 'disabled' };
      body.reasoning_effort = options.reasoningEffort ?? this.defaultReasoningEffort;
    }
    if (options.stop && options.stop.length > 0) body.stop = options.stop;
    if (stream) {
      // 让上游在最后一个 chunk 返回 usage（OpenAI 兼容字段）。
      body.stream_options = { include_usage: true };
    }
    if (options.extraBody) {
      for (const [key, value] of Object.entries(options.extraBody)) {
        if (value !== undefined) body[key] = value;
      }
    }
    return body;
  }

  private endpoint(pathname: string): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    // 兼容 https://api.deepseek.com 与 https://api.deepseek.com/v1 两种写法。
    if (/\/v1$/i.test(base)) return buildUrl(base, pathname);
    return buildUrl(base, pathname);
  }

  /** 列出账号可用模型（也用作密钥有效性探测）。 */
  async listModels(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string[]> {
    const apiKey = this.requireKey();
    const url = this.endpoint('models');
    try {
      const data = await httpJson<{ data?: Array<{ id?: string }> }>(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        service: 'deepseek',
        timeoutMs: options.timeoutMs ?? 20_000,
        signal: options.signal,
      });
      return (data?.data ?? [])
        .map((item) => item?.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0);
    } catch (error) {
      throw toIntegrationError(error, 'deepseek');
    }
  }


  /** DeepSeek 官方网页搜索（POST /v1/tools/search）。 */
  async searchWeb(params: { query: string; count?: number; needContent?: boolean; oriQuestion?: string; localization?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<DeepSeekSearchResult[]> {
    const apiKey = this.requireKey();
    const query = (params.query ?? '').trim();
    if (!query) throw new IntegrationError({ service: 'deepseek', code: 'BAD_REQUEST', message: '搜索词不能为空' });
    const base = this.baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
    const body: Record<string, unknown> = {
      query: query.slice(0, 128),
      count: Math.max(1, Math.min(10, Math.floor(params.count ?? 8))),
    };
    if (params.needContent) body.need_content = true;
    if (params.oriQuestion) body.ori_question = params.oriQuestion.slice(0, 128);
    if (params.localization) body.localization = params.localization;
    const data = await httpJson<{ results?: Array<Record<string, unknown>> }>(buildUrl(base, '/v1/tools/search'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body,
      service: 'deepseek',
      timeoutMs: params.timeoutMs ?? 30_000,
      signal: params.signal,
    });
    return (data.results ?? []).flatMap((item) => {
      const title = typeof item.title === 'string' ? item.title : '';
      const url = typeof item.url === 'string' ? item.url : '';
      if (!title || !url) return [];
      return [{
        title, url,
        snippet: String(item.snippet ?? ''),
        ...(typeof item.summary === 'string' ? { summary: item.summary } : {}),
        ...(typeof item.content === 'string' ? { content: item.content } : {}),
        ...(typeof item.site_name === 'string' ? { siteName: item.site_name } : {}),
        ...(typeof item.date === 'string' ? { publishedAt: item.date } : {}),
        ...(typeof item.authority === 'number' ? { authority: item.authority } : {}),
        ...(typeof item.rerank_score === 'number' ? { score: item.rerank_score } : {}),
      }];
    });
  }

  /** DeepSeek 官方网页抓取（POST /v1/tools/fetch），返回 Markdown 正文。 */
  async fetchPage(url: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<DeepSeekFetchResult> {
    const apiKey = this.requireKey();
    const target = (url ?? '').trim();
    if (!/^https?:\/\//i.test(target)) throw new IntegrationError({ service: 'deepseek', code: 'BAD_REQUEST', message: '抓取地址必须是 http(s) URL' });
    const base = this.baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
    const data = await httpJson<Record<string, unknown>>(buildUrl(base, '/v1/tools/fetch'), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: { url: target },
      service: 'deepseek',
      timeoutMs: options.timeoutMs ?? 30_000,
      signal: options.signal,
    });
    return {
      url: typeof data.url === 'string' ? data.url : target,
      title: typeof data.title === 'string' ? data.title : undefined,
      content: String(data.content ?? ''),
      description: typeof data.description === 'string' ? data.description : undefined,
      siteName: typeof data.site_name === 'string' ? data.site_name : undefined,
      publishedAt: typeof data.published_at === 'string' ? data.published_at : undefined,
    };
  }


  /** 查询账户余额（GET /user/balance）。 */
  async getBalance(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<{ available: boolean; currency: string; total: number; granted: number; toppedUp: number } | null> {
    const apiKey = this.requireKey();
    const base = this.baseUrl.replace(/\/v1\/?$/i, '').replace(/\/+$/, '');
    const data = await httpJson<Record<string, unknown>>(buildUrl(base, '/user/balance'), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
      service: 'deepseek',
      timeoutMs: options.timeoutMs ?? 20_000,
      signal: options.signal,
    });
    const infos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
    const info = infos.map((item) => item as Record<string, unknown>).find((item) => item.currency === 'CNY') ?? infos[0] as Record<string, unknown> | undefined;
    if (!info) return null;
    return {
      available: data.is_available === true,
      currency: String(info.currency ?? 'CNY'),
      total: Number(info.total_balance ?? 0),
      granted: Number(info.granted_balance ?? 0),
      toppedUp: Number(info.topped_up_balance ?? 0),
    };
  }

  /** 非流式对话。 */
  async chat(
    messages: readonly ChatMessageInput[],
    options: ChatOptions = {},
  ): Promise<ChatCompletionResult> {
    if (options.stream && options.onDelta) {
      return this.streamChat(messages, options, options.onDelta);
    }
    const apiKey = this.requireKey();
    const model = this.resolveModel(options);
    const url = this.endpoint('chat/completions');
    const body = this.buildBody(messages, { ...options, stream: false }, model, false);
    try {
      const data = await httpJson<DeepSeekChatResponse>(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        service: 'deepseek',
        timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
        retries: options.retries ?? 0,
        signal: options.signal,
      });
      const choice = data?.choices?.[0];
      const content = choice?.message?.content ?? '';
      const reasoning = choice?.message?.reasoning_content ?? '';
      if (!choice) {
        throw new IntegrationError({
          service: 'deepseek',
          code: 'BAD_RESPONSE',
          message: 'DeepSeek 返回结构异常：缺少 choices',
        });
      }
      return {
        content,
        reasoning,
        model: data?.model ?? model,
        finishReason: choice.finish_reason ?? undefined,
        usage: normalizeUsage(data?.usage),
      };
    } catch (error) {
      throw toIntegrationError(error, 'deepseek');
    }
  }

  /** 流式对话（SSE），每段增量通过 onDelta 回调，最终仍返回完整结果。 */
  async streamChat(
    messages: readonly ChatMessageInput[],
    options: ChatOptions,
    onDelta: (delta: StreamDelta) => void,
  ): Promise<ChatCompletionResult> {
    const apiKey = this.requireKey();
    const model = this.resolveModel(options);
    const url = this.endpoint('chat/completions');
    const body = this.buildBody(messages, { ...options, stream: true }, model, true);
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const idleTimeoutMs = options.idleTimeoutMs ?? this.defaultIdleTimeoutMs;

    try {
      const { response, dispose } = await httpStream(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body,
        service: 'deepseek',
        timeoutMs,
        signal: options.signal,
      });
      const reader = response.body?.getReader();
      if (!reader) {
        dispose();
        throw new IntegrationError({
          service: 'deepseek',
          code: 'BAD_RESPONSE',
          message: 'DeepSeek 未返回可读的流式数据',
        });
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let content = '';
      let reasoning = '';
      let finishReason: string | undefined;
      let usage: DeepSeekUsage | undefined;
      let responseModel = model;
      let idle = false;
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const armIdleTimer = (): void => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idle = true;
          void reader.cancel('idle-timeout').catch(() => undefined);
        }, idleTimeoutMs);
        if (typeof idleTimer.unref === 'function') idleTimer.unref();
      };

      try {
        armIdleTimer();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          armIdleTimer();
          buffer += decoder.decode(value, { stream: true });
          let index = buffer.indexOf('\n');
          while (index >= 0) {
            const rawLine = buffer.slice(0, index).replace(/\r$/, '');
            buffer = buffer.slice(index + 1);
            index = buffer.indexOf('\n');
            if (!rawLine || rawLine.startsWith(':')) continue;
            if (!rawLine.startsWith('data:')) continue;
            const payload = rawLine.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let chunk: DeepSeekChatResponse;
            try {
              chunk = JSON.parse(payload) as DeepSeekChatResponse;
            } catch {
              continue; // 忽略无法解析的保活/碎片行
            }
            if (chunk.model) responseModel = chunk.model;
            const choice = chunk.choices?.[0];
            const delta = choice?.delta;
            const pieceContent = delta?.content ?? '';
            const pieceReasoning = delta?.reasoning_content ?? '';
            if (pieceContent) {
              content += pieceContent;
              onDelta({ content: pieceContent, reasoning: '' });
            }
            if (pieceReasoning) {
              reasoning += pieceReasoning;
              onDelta({ content: '', reasoning: pieceReasoning });
            }
            if (choice?.finish_reason) finishReason = choice.finish_reason;
            const chunkUsage = normalizeUsage(chunk.usage);
            if (chunkUsage) usage = chunkUsage;
          }
        }
        // 处理最后一行没有换行符的残留数据
        const tail = buffer.trim();
        if (tail.startsWith('data:')) {
          const payload = tail.slice(5).trim();
          if (payload && payload !== '[DONE]') {
            try {
              const chunk = JSON.parse(payload) as DeepSeekChatResponse;
              const choice = chunk.choices?.[0];
              const pieceContent = choice?.delta?.content ?? '';
              const pieceReasoning = choice?.delta?.reasoning_content ?? '';
              if (pieceContent) {
                content += pieceContent;
                onDelta({ content: pieceContent, reasoning: '' });
              }
              if (pieceReasoning) {
                reasoning += pieceReasoning;
                onDelta({ content: '', reasoning: pieceReasoning });
              }
              if (choice?.finish_reason) finishReason = choice.finish_reason;
              const chunkUsage = normalizeUsage(chunk.usage);
              if (chunkUsage) usage = chunkUsage;
            } catch {
              // 忽略
            }
          }
        }
      } finally {
        if (idleTimer) clearTimeout(idleTimer);
        reader.releaseLock();
        dispose();
      }

      if (idle) {
        throw new IntegrationError({
          service: 'deepseek',
          code: 'TIMEOUT',
          message: `流式响应空闲超时（${Math.round(idleTimeoutMs / 1000)}s）`,
          retryable: true,
        });
      }
      if (!content && !reasoning) {
        throw new IntegrationError({
          service: 'deepseek',
          code: 'BAD_RESPONSE',
          message: 'DeepSeek 流式响应为空',
        });
      }
      return { content, reasoning, model: responseModel, finishReason, usage };
    } catch (error) {
      throw toIntegrationError(error, 'deepseek');
    }
  }

  /**
   * JSON 模式对话：要求模型输出 JSON 并安全解析（新模型与 deepseek-chat 均支持）。
   * 会剥离 ```json 代码围栏，兼容模型偶发的解释性前后缀。
   */
  async chatJson<T = unknown>(
    messages: readonly ChatMessageInput[],
    options: ChatOptions = {},
  ): Promise<{ data: T; result: ChatCompletionResult }> {
    const result = await this.chat(messages, {
      ...options,
      jsonMode: true,
      thinking: options.thinking ?? false,
      stream: false,
      onDelta: undefined,
    });
    const data = parseJsonResponse<T>(result.content);
    return { data, result };
  }

  /** 连通性与密钥有效性测试（GET /models）。 */
  async testConnection(): Promise<ConnectionTestResult> {
    return runConnectionTest('deepseek', async () => {
      const models = await this.listModels({ timeoutMs: 15_000 });
      if (models.length === 0) return '连接正常（未返回模型列表）';
      // 展示时优先新模型，旧模型名仅作为兜底（不假设账号里一定有旧模型）。
      const preferred = models.filter(
        (id) => !LEGACY_CHAT_MODEL_PATTERN.test(id) && !LEGACY_REASONER_MODEL_PATTERN.test(id),
      );
      const shown = (preferred.length > 0 ? preferred : models).slice(0, 3);
      return `连接正常，可用模型 ${models.length} 个：${shown.join(' / ')}`;
    });
  }
}

/** 从模型输出中提取 JSON（容忍代码围栏与前后缀）。 */
export function parseJsonResponse<T = unknown>(content: string): T {
  const text = (content ?? '').trim();
  if (!text) {
    throw new IntegrationError({
      service: 'deepseek',
      code: 'BAD_RESPONSE',
      message: '模型未返回 JSON 内容',
    });
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const first = candidate.indexOf('{');
    const last = candidate.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(candidate.slice(first, last + 1)) as T;
      } catch {
        // 继续抛出统一错误
      }
    }
  }
  throw new IntegrationError({
    service: 'deepseek',
    code: 'BAD_RESPONSE',
    message: `模型返回的 JSON 无法解析：${candidate.slice(0, 160)}`,
  });
}
