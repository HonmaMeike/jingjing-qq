/**
 * 第三方 API 集成层 —— 基础 HTTP 模块。
 *
 * 设计要点：
 * - 只使用 Node 内置 fetch（Node 20+/Electron 38），不引入任何第三方依赖。
 * - 统一处理：超时、重试（指数退避）、JSON / 文本 / 二进制解析、错误归一化。
 * - 所有错误都归一化为 IntegrationError（含 service / status / message / code / retryable）。
 * - 密钥只通过参数传入：本模块不会打印、记录或持久化任何密钥。
 */
import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

/** 集成服务标识；用于错误归因与 UI 展示。 */
export type IntegrationService =
  | 'deepseek'
  | 'breezeblue'
  | 'minimax'
  | 'suno'
  | 'serper'
  | 'bilibili'
  | 'http';

/** 服务中文标签，供 Toast / 集成状态页复用。 */
export const SERVICE_LABELS: Record<IntegrationService, string> = {
  deepseek: 'DeepSeek 对话',
  breezeblue: 'Breeze 语音合成',
  minimax: 'MiniMax 图像/视频',
  suno: 'Suno 音乐',
  serper: 'Serper 搜索',
  bilibili: '哔哩哔哩',
  http: 'HTTP 请求',
};

export type IntegrationErrorCode =
  | 'MISSING_API_KEY'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'NETWORK'
  | 'BAD_RESPONSE'
  | 'CONFIG'
  | 'UPSTREAM'
  | 'UNKNOWN';

export interface IntegrationErrorParams {
  service: IntegrationService;
  message: string;
  code?: IntegrationErrorCode;
  /** HTTP 状态码；0 表示未拿到响应（网络/超时/取消）。 */
  status?: number;
  retryable?: boolean;
  /** 上游返回的原始错误体（可能出现敏感信息时不建议透传到 UI）。 */
  details?: unknown;
  cause?: unknown;
}

/** 集成层统一错误：调用方只需 catch 这一种类型。 */
export class IntegrationError extends Error {
  readonly service: IntegrationService;
  readonly code: IntegrationErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: unknown;

  constructor(params: IntegrationErrorParams) {
    super(params.message, params.cause === undefined ? undefined : { cause: params.cause });
    this.name = 'IntegrationError';
    this.service = params.service;
    this.code = params.code ?? 'UNKNOWN';
    this.status = params.status ?? 0;
    this.retryable = params.retryable ?? false;
    this.details = params.details;
  }

  /** 便于日志/网格展示的结构化快照（不含密钥）。 */
  toJSON(): {
    name: string;
    service: IntegrationService;
    code: IntegrationErrorCode;
    status: number;
    retryable: boolean;
    message: string;
  } {
    return {
      name: this.name,
      service: this.service,
      code: this.code,
      status: this.status,
      retryable: this.retryable,
      message: this.message,
    };
  }

  toString(): string {
    return this.message;
  }
}

export function isIntegrationError(value: unknown): value is IntegrationError {
  return value instanceof IntegrationError;
}

/** 把任意异常归一化为 IntegrationError，保证上层错误处理只有一条路径。 */
export function toIntegrationError(
  error: unknown,
  service: IntegrationService = 'http',
): IntegrationError {
  if (error instanceof IntegrationError) return error;
  if (isAbortError(error)) {
    return new IntegrationError({ service, code: 'ABORTED', message: '请求已取消', cause: error });
  }
  const record = error as { message?: string; code?: string; cause?: unknown };
  const cause = record?.cause as { code?: string; message?: string } | undefined;
  const detail =
    cause?.code ?? cause?.message ?? record?.code ?? record?.message ?? String(error ?? '未知错误');
  return new IntegrationError({
    service,
    code: 'NETWORK',
    message: `网络请求失败：${detail}`,
    retryable: true,
    cause: error,
  });
}

/** 面向 UI 的简短错误文案。 */
export function describeError(error: unknown): string {
  if (error instanceof IntegrationError) return error.message;
  if (error instanceof Error) return error.message || '未知错误';
  return String(error ?? '未知错误');
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  return (error as { name?: string }).name === 'AbortError';
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type HttpAccept = 'json' | 'text' | 'buffer';
export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;
export type HttpBody =
  | string
  | Uint8Array
  | URLSearchParams
  | Record<string, unknown>
  | readonly unknown[];

export interface HttpRequestOptions {
  method?: HttpMethod;
  headers?: Record<string, string>;
  query?: QueryParams;
  /** 对象会被序列化为 JSON；string / Uint8Array / URLSearchParams 原样发送。 */
  body?: HttpBody;
  /** 单次尝试的超时（包含读取响应体），默认 30s。 */
  timeoutMs?: number;
  /** 重试次数（不含首次），默认 0。仅对网络错误、429、5xx 生效。 */
  retries?: number;
  /** 退避基数，默认 400ms。 */
  retryDelayMs?: number;
  /** 需要重试的额外状态码。 */
  retryStatuses?: readonly number[];
  /** 外部取消信号（例如窗口关闭、任务取消）。 */
  signal?: AbortSignal;
  /** 错误归因用的服务标识。 */
  service?: IntegrationService;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15_000;
const MAX_ERROR_DETAIL_CHARS = 600;

/** 拼接 URL：baseUrl + 路径 + 查询参数；pathname 本身是完整 URL 时直接使用。 */
export function buildUrl(baseUrl: string, pathname = '', query?: QueryParams): string {
  const base = (baseUrl ?? '').trim();
  if (!base) {
    throw new IntegrationError({ service: 'http', code: 'CONFIG', message: '未配置接口地址（baseUrl）' });
  }
  let full: string;
  if (/^https?:\/\//i.test(pathname)) {
    full = pathname;
  } else if (!pathname) {
    full = base;
  } else {
    full = `${base.replace(/\/+$/, '')}/${pathname.replace(/^\/+/, '')}`;
  }
  let url: URL;
  try {
    url = new URL(full);
  } catch (error) {
    throw new IntegrationError({
      service: 'http',
      code: 'CONFIG',
      message: `接口地址格式不正确：${full}`,
      cause: error,
    });
  }
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/** 校验并返回去掉首尾空白的 API Key。 */
export function requireApiKey(
  apiKey: unknown,
  service: IntegrationService,
  label: string,
): string {
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new IntegrationError({
      service,
      code: 'MISSING_API_KEY',
      message: `尚未配置 ${label} 的 API Key`,
    });
  }
  return apiKey.trim();
}

export interface RawHttpResult {
  status: number;
  ok: boolean;
  headers: Headers;
  url: string;
  contentType: string;
  buffer: Buffer;
}

export interface BufferHttpResult {
  buffer: Buffer;
  contentType: string;
  status: number;
  url: string;
}

export interface DownloadResult {
  filePath: string;
  bytes: number;
  contentType: string;
}

interface AbortContext {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
}

function createAbortContext(timeoutMs: number, external?: AbortSignal): AbortContext {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
  }
  const onAbort = (): void => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      external?.removeEventListener('abort', onAbort);
    },
  };
}

function timeoutError(service: IntegrationService, timeoutMs: number): IntegrationError {
  return new IntegrationError({
    service,
    code: 'TIMEOUT',
    message: `请求超时（${Math.round(timeoutMs / 1000)}s），请检查网络或稍后重试`,
    retryable: true,
  });
}

function abortedError(service: IntegrationService): IntegrationError {
  return new IntegrationError({ service, code: 'ABORTED', message: '请求已取消' });
}

function networkError(error: unknown, service: IntegrationService): IntegrationError {
  const normalized = toIntegrationError(error, service);
  if (normalized.code === 'ABORTED') return normalized;
  return normalized;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortedError('http'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortedError('http'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 可取消的延时（轮询类接口复用）。 */
export function sleepWithSignal(ms: number, signal?: AbortSignal): Promise<void> {
  return sleep(ms, signal);
}

function backoffMs(attempt: number, baseDelayMs: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 120);
  return Math.min(exponential + jitter, MAX_RETRY_DELAY_MS);
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(raw);
  if (!Number.isNaN(at)) return Math.max(0, at - Date.now());
  return undefined;
}

function codeForStatus(status: number): IntegrationErrorCode {
  if (status === 400 || status === 422) return 'BAD_REQUEST';
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 408) return 'TIMEOUT';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  return 'UPSTREAM';
}

function isRetryableCode(code: IntegrationErrorCode): boolean {
  return code === 'RATE_LIMITED' || code === 'SERVER_ERROR' || code === 'NETWORK' || code === 'TIMEOUT';
}

function truncate(value: string, max = MAX_ERROR_DETAIL_CHARS): string {
  const text = value.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 从上游错误体里尽力提取人类可读的 message。 */
function extractUpstreamMessage(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    const found = pickMessage(parsed, 0);
    if (found) return truncate(found);
    return undefined;
  } catch {
    return truncate(text.replace(/\s+/g, ' '));
  }
}

function pickMessage(value: unknown, depth: number): string | undefined {
  if (depth > 4 || typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const directKeys = ['message', 'msg', 'detail', 'error_msg', 'errorMsg', 'status_msg', 'statusMessage', 'error_description'];
  for (const key of directKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  const nestedKeys = ['error', 'errors', 'base_resp', 'data', 'response'];
  for (const key of nestedKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const found = pickMessage(item, depth + 1);
        if (found) return found;
      }
    } else if (typeof candidate === 'object' && candidate !== null) {
      const found = pickMessage(candidate, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function statusError(
  service: IntegrationService,
  response: Response,
  bodyText: string,
): IntegrationError {
  const code = codeForStatus(response.status);
  const upstream = extractUpstreamMessage(bodyText);
  const label = SERVICE_LABELS[service];
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  const message = upstream
    ? `${label} 请求失败（${response.status}${statusText}）：${upstream}`
    : `${label} 请求失败（${response.status}${statusText}）`;
  return new IntegrationError({
    service,
    code,
    status: response.status,
    message,
    retryable: isRetryableCode(code),
    details: upstream,
  });
}

function prepareBody(
  body: HttpBody | undefined,
  headers: Record<string, string>,
): BodyInit | undefined {
  if (body === undefined) return undefined;
  const hasContentType = Object.keys(headers).some((key) => key.toLowerCase() === 'content-type');
  if (typeof body === 'string') return body;
  // TS 5.7 起 Uint8Array<ArrayBufferLike> 与 DOM 的 BodyInit 存在泛型不匹配，此处按运行时行为强转。
  if (body instanceof Uint8Array) return body as unknown as BodyInit;
  if (body instanceof URLSearchParams) return body;
  if (!hasContentType) headers['Content-Type'] = 'application/json';
  return JSON.stringify(body);
}

/**
 * 底层请求：失败自动重试，成功时返回原始 Buffer + 响应头。
 * 适用于二进制（音频/图片/视频）下载或需要读取响应头的场景。
 */

/** 优先 Electron net.fetch（走系统代理/证书），测试环境回退 Node fetch。 */
async function integrationFetch(input: string, init: RequestInit): Promise<Response> {
  try {
    const electron = await import('electron').catch(() => null);
    const net = electron && 'net' in electron ? (electron as { net?: { fetch?: typeof fetch } }).net : undefined;
    if (net?.fetch) return await net.fetch(input, init);
  } catch { /* fall back */ }
  return fetch(input, init);
}

export async function httpRaw(url: string, options: HttpRequestOptions = {}): Promise<RawHttpResult> {
  const service = options.service ?? 'http';
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = Math.max(1, (options.retries ?? 0) + 1);
  const retryDelayMs = options.retryDelayMs ?? 400;
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  const body = prepareBody(options.body, headers);

  let lastError: IntegrationError | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const ctx = createAbortContext(timeoutMs, options.signal);
    let response: Response;
    try {
      response = await integrationFetch(url, {
        method,
        headers,
        body,
        signal: ctx.signal,
        redirect: 'follow',
      });
    } catch (error) {
      ctx.cleanup();
      const mapped = ctx.timedOut()
        ? timeoutError(service, timeoutMs)
        : options.signal?.aborted
          ? abortedError(service)
          : networkError(error, service);
      lastError = mapped;
      if (attempt + 1 < attempts && mapped.retryable) {
        const delay = backoffMs(attempt, retryDelayMs);
        try {
          await sleep(delay, options.signal);
        } catch {
          throw abortedError(service);
        }
        continue;
      }
      throw mapped;
    }

    if (!response.ok) {
      const text = await safeReadText(response);
      ctx.cleanup();
      const mapped = statusError(service, response, text);
      lastError = mapped;
      const extraRetry = options.retryStatuses?.includes(response.status) ?? false;
      if (attempt + 1 < attempts && (mapped.retryable || extraRetry)) {
        const delay = backoffMs(attempt, retryDelayMs, parseRetryAfterMs(response.headers));
        try {
          await sleep(delay, options.signal);
        } catch {
          throw abortedError(service);
        }
        continue;
      }
      throw mapped;
    }

    try {
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        status: response.status,
        ok: true,
        headers: response.headers,
        url: response.url || url,
        contentType: response.headers.get('content-type') ?? '',
        buffer,
      };
    } catch (error) {
      const mapped = ctx.timedOut()
        ? timeoutError(service, timeoutMs)
        : options.signal?.aborted
          ? abortedError(service)
          : networkError(error, service);
      lastError = mapped;
      if (attempt + 1 < attempts && mapped.retryable) {
        try {
          await sleep(backoffMs(attempt, retryDelayMs), options.signal);
        } catch {
          throw abortedError(service);
        }
        continue;
      }
      throw mapped;
    } finally {
      ctx.cleanup();
    }
  }
  throw lastError ?? new IntegrationError({ service, code: 'UNKNOWN', message: '请求失败' });
}

/** 以 JSON 解析响应体；空响应体返回 null。 */
export async function httpJson<T = unknown>(
  url: string,
  options: HttpRequestOptions = {},
): Promise<T> {
  const service = options.service ?? 'http';
  const result = await httpRaw(url, options);
  const text = result.buffer.toString('utf8').trim();
  if (!text) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const label = SERVICE_LABELS[service];
    throw new IntegrationError({
      service,
      code: 'BAD_RESPONSE',
      status: result.status,
      message: `${label} 返回了无法解析的 JSON：${truncate(text, 200)}`,
      details: truncate(text),
      cause: error,
    });
  }
}

/** 以文本返回响应体。 */
export async function httpText(
  url: string,
  options: HttpRequestOptions = {},
): Promise<string> {
  const result = await httpRaw(url, options);
  return result.buffer.toString('utf8');
}

/** 二进制下载（音频/图片/视频），默认带 1 次重试。 */
export async function httpBuffer(
  url: string,
  options: HttpRequestOptions = {},
): Promise<BufferHttpResult> {
  const result = await httpRaw(url, {
    retries: 1,
    ...options,
  });
  return {
    buffer: result.buffer,
    contentType: result.contentType,
    status: result.status,
    url: result.url,
  };
}

/**
 * 建立 SSE 长连接（仅用于流式对话）。
 * 超时只约束「建立连接与首包之前」；读取阶段的空闲超时由调用方处理。
 */
export async function httpStream(
  url: string,
  options: HttpRequestOptions = {},
): Promise<{
  response: Response;
  status: number;
  headers: Headers;
  /** 读完流后调用，释放外部取消监听。 */
  dispose: () => void;
}> {
  const service = options.service ?? 'http';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    ...(options.headers ?? {}),
  };
  const body = prepareBody(options.body, headers);
  const controller = new AbortController();
  const external = options.signal;
  const onAbort = (): void => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();

  try {
    const response = await integrationFetch(url, {
      method: options.method ?? 'POST',
      headers,
      body,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok) {
      const text = await safeReadText(response);
      external?.removeEventListener('abort', onAbort);
      throw statusError(service, response, text);
    }
    if (!response.body) {
      external?.removeEventListener('abort', onAbort);
      throw new IntegrationError({
        service,
        code: 'BAD_RESPONSE',
        message: `${SERVICE_LABELS[service]} 未返回可读的流式数据`,
      });
    }
    return {
      response,
      status: response.status,
      headers: response.headers,
      // 保留外部取消监听直到调用方读完流，确保能中断进行中的读取。
      dispose: () => external?.removeEventListener('abort', onAbort),
    };
  } catch (error) {
    external?.removeEventListener('abort', onAbort);
    if (error instanceof IntegrationError) throw error;
    if (timedOut) throw timeoutError(service, timeoutMs);
    if (external?.aborted || isAbortError(error)) throw abortedError(service);
    throw networkError(error, service);
  } finally {
    clearTimeout(timer);
  }
}

/** 判断内容类型对应的文件扩展名。 */
export function extensionFromContentType(contentType: string | null | undefined): string | undefined {
  const value = (contentType ?? '').toLowerCase();
  if (value.includes('audio/mpeg') || value.includes('audio/mp3')) return 'mp3';
  if (value.includes('audio/wav') || value.includes('audio/x-wav')) return 'wav';
  if (value.includes('audio/mp4') || value.includes('audio/aac')) return 'm4a';
  if (value.includes('audio/ogg')) return 'ogg';
  if (value.includes('image/png')) return 'png';
  if (value.includes('image/jpeg') || value.includes('image/jpg')) return 'jpg';
  if (value.includes('image/webp')) return 'webp';
  if (value.includes('video/mp4')) return 'mp4';
  if (value.includes('video/webm')) return 'webm';
  if (value.includes('application/json')) return 'json';
  return undefined;
}

/** 清洗文件名中的非法字符。 */
export function sanitizeFileBaseName(name: string, fallback = 'output'): string {
  const cleaned = (name || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80)
    .replace(/^[.\-]+|[.\-]+$/g, '');
  return cleaned || fallback;
}

/** 生成带时间戳与随机后缀的媒体文件名（避免覆盖）。 */
export function createMediaFileName(prefix: string, extension: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const random = Math.random().toString(36).slice(2, 8);
  const ext = extension.replace(/^\./, '') || 'bin';
  return `${sanitizeFileBaseName(prefix, 'media')}-${stamp}-${random}.${ext}`;
}

/** 确保目录存在并写入二进制文件，返回绝对路径。 */
export async function saveBinaryFile(
  filePath: string,
  data: Uint8Array | Buffer,
): Promise<string> {
  const absolute = path.resolve(filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, data);
  return absolute;
}

/** 下载远程资源到指定文件（自动带 1 次重试）。 */
export async function downloadToFile(
  url: string,
  filePath: string,
  options: HttpRequestOptions = {},
): Promise<DownloadResult> {
  const result = await httpBuffer(url, options);
  const absolute = await saveBinaryFile(filePath, result.buffer);
  return {
    filePath: absolute,
    bytes: result.buffer.byteLength,
    contentType: result.contentType,
  };
}

/** 安全地把 unknown 当成对象读取。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** 安全地把 unknown 当成数组读取。 */
export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** 非空字符串才返回。 */
export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/** 有限数字才返回。 */
export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** 依次取第一个非空字符串。 */
export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const found = asString(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** 依次取第一个有限数字。 */
export function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const found = asNumber(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

export interface ConnectionTestResult {
  ok: boolean;
  /** 面向 UI 的中文说明（成功示例：「连接正常，可用模型 3 个」）。 */
  detail: string;
  latencyMs: number;
  checkedAt: string;
  status?: number;
  error?: IntegrationError;
}

/**
 * 统一的连通性测试包装：传入一个返回「成功说明」的探测函数，
 * 失败时自动归一化为中文错误信息，且绝不抛出异常。
 */
export async function runConnectionTest(
  service: IntegrationService,
  probe: () => Promise<string>,
): Promise<ConnectionTestResult> {
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();
  try {
    const detail = await probe();
    return { ok: true, detail, latencyMs: Date.now() - startedAt, checkedAt };
  } catch (error) {
    const mapped = toIntegrationError(error, service);
    return {
      ok: false,
      detail: mapped.message,
      latencyMs: Date.now() - startedAt,
      checkedAt,
      status: mapped.status || undefined,
      error: mapped,
    };
  }
}
