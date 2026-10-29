/**
 * Suno 音乐生成客户端（sunoapi.org 官方网关）。
 *
 * 关键接口事实：
 * - 基础地址：https://api.sunoapi.org
 * - 鉴权：Authorization: Bearer <apiKey>
 * - POST {baseUrl}/api/v1/generate
 *   body 必填：customMode、instrumental、callBackUrl、model
 *   可选：prompt（歌词或描述）、style、title、negativeTags、vocalGender、duration 等
 * - GET  {baseUrl}/api/v1/generate/record-info?taskId=
 *   任务状态：PENDING / TEXT_SUCCESS / FIRST_SUCCESS / SUCCESS，失败态含 CREATE_TASK_FAILED 等
 *   音频地址：data.response.sunoData[].audioUrl（兼容 data.data 的 snake_case 结构）
 * - 回调模式不使用 true 回调：callBackUrl 填占位地址，统一走轮询。
 *
 * 密钥仅来自构造参数；轮询支持超时与 AbortSignal 取消。
 */
import * as os from 'node:os';
import * as path from 'node:path';
import {
  asNumber,
  asRecord,
  buildUrl,
  createMediaFileName,
  extensionFromContentType,
  firstNumber,
  firstString,
  httpBuffer,
  httpJson,
  IntegrationError,
  runConnectionTest,
  sanitizeFileBaseName,
  saveBinaryFile,
  sleepWithSignal,
  type ConnectionTestResult,
} from './http';

export interface SunoClientOptions {
  apiKey: string;
  /** 默认 https://api.sunoapi.org。 */
  baseUrl?: string;
  /** 默认 V6。 */
  model?: string;
  /** 轮询模式下使用的占位回调地址。 */
  callBackUrl?: string;
  timeoutMs?: number;
  /** 轮询间隔，默认 10s。 */
  pollIntervalMs?: number;
  /** 轮询总超时，默认 8 分钟。 */
  pollTimeoutMs?: number;
}

export interface SunoGenerateParams {
  /** customMode=true 时为歌词；false 时为音乐描述。 */
  prompt: string;
  /** 默认 true（自定义歌词模式）。 */
  customMode?: boolean;
  /** 默认 false。 */
  instrumental?: boolean;
  style?: string;
  title?: string;
  negativeTags?: string;
  vocalGender?: 'm' | 'f';
  duration?: number;
  model?: string;
  callBackUrl?: string;
  personaId?: string;
  styleWeight?: number;
  weirdnessConstraint?: number;
  audioWeight?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SunoTrack {
  id: string;
  title: string;
  audioUrl: string;
  streamAudioUrl?: string;
  coverUrl?: string;
  durationSec?: number;
  tags?: string;
  modelName?: string;
  /** 下载后的本地音频绝对路径。 */
  audioPath?: string;
  /** 下载后的本地封面绝对路径。 */
  coverPath?: string;
}

export interface SunoRecord {
  taskId: string;
  status: string;
  tracks: SunoTrack[];
  failReason?: string;
  raw?: unknown;
}

export interface SunoWaitOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (record: SunoRecord) => void;
}

export interface SunoDownloadOptions {
  /** 音频保存目录，默认系统临时目录。 */
  audioDir?: string;
  /** 封面保存目录，默认与音频同目录。 */
  coverDir?: string;
  /** false 时只返回 URL 不落盘。 */
  enabled?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = 'https://api.sunoapi.org';
const DEFAULT_MODEL = 'V6';
const DEFAULT_CALLBACK_URL = 'https://example.com/callback';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
const DEFAULT_POLL_TIMEOUT_MS = 8 * 60_000;
const SUCCESS_STATUSES = new Set(['SUCCESS', 'FIRST_SUCCESS', 'COMPLETE', 'COMPLETED']);
const FAILURE_STATUSES = new Set([
  'CREATE_TASK_FAILED',
  'GENERATE_AUDIO_FAILED',
  'CALLBACK_EXCEPTION',
  'SENSITIVE_WORD_ERROR',
  'GENERATE_FAILED',
  'FAILED',
]);

function defaultAudioDir(): string {
  return path.join(os.tmpdir(), 'jingjing-media', 'suno');
}

function toSunoError(error: unknown): IntegrationError {
  return error instanceof IntegrationError
    ? error
    : new IntegrationError({
        service: 'suno',
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
}

function abortError(): IntegrationError {
  return new IntegrationError({ service: 'suno', code: 'ABORTED', message: '音乐生成任务已取消' });
}

/** 校验网关信封（{ code, msg, data }）；非 200/0 视为业务错误。 */
function assertSunoOk(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  const rawCode = root.code;
  const code = asNumber(rawCode) ?? (typeof rawCode === 'string' ? Number(rawCode) : undefined);
  if (code === undefined || code === 0 || code === 200) return root;
  const message = firstString(root.msg, root.message) ?? '未知错误';
  if (code === 401 || code === 403) {
    throw new IntegrationError({
      service: 'suno',
      code: 'UNAUTHORIZED',
      message: `Suno 网关鉴权失败（${code}）：${message}`,
      details: root,
    });
  }
  if (code === 429) {
    throw new IntegrationError({
      service: 'suno',
      code: 'RATE_LIMITED',
      message: `Suno 网关限流（${code}）：${message}`,
      retryable: true,
      details: root,
    });
  }
  throw new IntegrationError({
    service: 'suno',
    code: 'UPSTREAM',
    message: `Suno 网关返回错误（${code}）：${message}`,
    details: root,
  });
}

function normalizeTrack(raw: unknown, index: number): SunoTrack | undefined {
  const record = asRecord(raw);
  const audioUrl = firstString(record.audioUrl, record.audio_url, record.sourceAudioUrl);
  if (!audioUrl) return undefined;
  const metadata = asRecord(record.metadata);
  const duration = firstNumber(record.duration, metadata.duration);
  return {
    id: firstString(record.id, record.audioId, record.audio_id) ?? `track-${index + 1}`,
    title: firstString(record.title, record.name) ?? '未命名作品',
    audioUrl,
    streamAudioUrl: firstString(record.streamAudioUrl, record.stream_audio_url),
    coverUrl: firstString(record.imageUrl, record.image_url, record.coverUrl, record.cover_url),
    durationSec: duration,
    tags: firstString(record.tags, record.style),
    modelName: firstString(record.modelName, record.model_name),
  };
}

function extractTracks(data: Record<string, unknown>): SunoTrack[] {
  const response = asRecord(data.response);
  const candidates: unknown[] = [
    response.sunoData,
    response.suno_data,
    data.sunoData,
    data.suno_data,
    data.data,
    response.data,
  ];
  let list: unknown[] | undefined;
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      list = candidate;
      break;
    }
  }
  if (!list) return [];
  const tracks: SunoTrack[] = [];
  list.forEach((item, index) => {
    const track = normalizeTrack(item, index);
    if (track) tracks.push(track);
  });
  return tracks;
}

function describeTaskStatus(status: string): string {
  switch (status) {
    case 'PENDING':
      return '排队中';
    case 'TEXT_SUCCESS':
      return '歌词已完成，等待音频';
    case 'FIRST_SUCCESS':
      return '首段音频已生成';
    case 'SUCCESS':
      return '生成完成';
    default:
      return status;
  }
}

export class SunoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly callBackUrl: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(options: SunoClientOptions) {
    this.apiKey = (options.apiKey ?? '').trim();
    this.baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this.model = options.model?.trim() || DEFAULT_MODEL;
    this.callBackUrl = options.callBackUrl?.trim() || DEFAULT_CALLBACK_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
  }

  /** 调用前校验密钥，未配置时抛出统一的 MISSING_API_KEY。 */
  private requireKey(): string {
    if (!this.apiKey) {
      throw new IntegrationError({
        service: 'suno',
        code: 'MISSING_API_KEY',
        message: '尚未配置 Suno API Key，请在设置 → API 密钥中填写',
      });
    }
    return this.apiKey;
  }

  /** 当前默认模型。 */
  get defaultModel(): string {
    return this.model;
  }

  /**
   * 创建音乐生成任务：POST /api/v1/generate
   * 返回 taskId，随后用 waitForTask / generateAndWait 轮询结果。
   */
  async generate(
    params: SunoGenerateParams,
  ): Promise<{ taskId: string; raw: unknown }> {
    this.requireKey();
    const prompt = (params.prompt ?? '').trim();
    if (!prompt) {
      throw new IntegrationError({
        service: 'suno',
        code: 'BAD_REQUEST',
        message: '音乐描述/歌词（prompt）不能为空',
      });
    }
    const customMode = params.customMode ?? true;
    const instrumental = params.instrumental ?? false;
    const body: Record<string, unknown> = {
      prompt,
      customMode,
      instrumental,
      callBackUrl: params.callBackUrl?.trim() || this.callBackUrl,
      model: params.model?.trim() || this.model,
    };
    if (params.style?.trim()) body.style = params.style.trim();
    if (params.title?.trim()) body.title = params.title.trim();
    if (params.negativeTags?.trim()) body.negativeTags = params.negativeTags.trim();
    if (params.vocalGender) body.vocalGender = params.vocalGender;
    if (typeof params.duration === 'number') body.duration = params.duration;
    if (params.personaId?.trim()) body.personaId = params.personaId.trim();
    if (typeof params.styleWeight === 'number') body.styleWeight = params.styleWeight;
    if (typeof params.weirdnessConstraint === 'number') body.weirdnessConstraint = params.weirdnessConstraint;
    if (typeof params.audioWeight === 'number') body.audioWeight = params.audioWeight;

    try {
      const payload = await httpJson<unknown>(buildUrl(this.baseUrl, '/api/v1/generate'), {
        method: 'POST',
        headers: this.headers(),
        body,
        service: 'suno',
        timeoutMs: params.timeoutMs ?? this.timeoutMs,
        signal: params.signal,
      });
      const root = assertSunoOk(payload);
      const data = asRecord(root.data);
      const taskId = firstString(data.taskId, data.task_id, root.taskId, root.task_id);
      if (!taskId) {
        throw new IntegrationError({
          service: 'suno',
          code: 'BAD_RESPONSE',
          message: 'Suno 未返回任务 ID（taskId）',
          details: payload,
        });
      }
      return { taskId, raw: payload };
    } catch (error) {
      throw toSunoError(error);
    }
  }

  /** 查询任务详情：GET /api/v1/generate/record-info?taskId=。 */
  async getRecord(
    taskId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<SunoRecord> {
    this.requireKey();
    if (!taskId) {
      throw new IntegrationError({
        service: 'suno',
        code: 'BAD_REQUEST',
        message: '缺少音乐任务 ID（taskId）',
      });
    }
    try {
      const payload = await httpJson<unknown>(
        buildUrl(this.baseUrl, '/api/v1/generate/record-info', { taskId }),
        {
          method: 'GET',
          headers: this.headers({ Accept: 'application/json' }),
          service: 'suno',
          timeoutMs: 30_000,
          signal: options.signal,
        },
      );
      const root = assertSunoOk(payload);
      const data = asRecord(root.data);
      const status = firstString(data.status, root.status) ?? 'PENDING';
      const tracks = extractTracks(data);
      return {
        taskId: firstString(data.taskId, data.task_id, root.taskId) ?? taskId,
        status,
        tracks,
        failReason: firstString(data.failReason, data.fail_reason, root.failReason),
        raw: payload,
      };
    } catch (error) {
      throw toSunoError(error);
    }
  }

  /** 轮询直到音频生成完成；失败态立即抛错，超时/取消可中断。 */
  async waitForTask(taskId: string, options: SunoWaitOptions = {}): Promise<SunoRecord> {
    const pollIntervalMs = options.pollIntervalMs ?? this.pollIntervalMs;
    const timeoutMs = options.timeoutMs ?? this.pollTimeoutMs;
    const startedAt = Date.now();
    for (;;) {
      if (options.signal?.aborted) throw abortError();
      const record = await this.getRecord(taskId, { signal: options.signal });
      options.onProgress?.(record);
      const upper = record.status.toUpperCase();
      if (SUCCESS_STATUSES.has(upper) && record.tracks.length > 0) return record;
      if (FAILURE_STATUSES.has(upper)) {
        throw new IntegrationError({
          service: 'suno',
          code: 'UPSTREAM',
          message: `音乐生成失败（${record.status}）：${record.failReason ?? '未知原因'}`,
          details: record.raw,
        });
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new IntegrationError({
          service: 'suno',
          code: 'TIMEOUT',
          message: `音乐生成等待超时（${Math.round(timeoutMs / 1000)}s，当前状态：${describeTaskStatus(record.status)}），可稍后凭 taskId 重新查询：${taskId}`,
        });
      }
      try {
        await sleepWithSignal(pollIntervalMs, options.signal);
      } catch {
        throw abortError();
      }
    }
  }

  /** 下载单首作品的音频与封面（封面失败不影响音频）。 */
  async downloadTrack(
    track: SunoTrack,
    options: SunoDownloadOptions = {},
  ): Promise<SunoTrack> {
    this.requireKey();
    if (!track.audioUrl) return track;
    const audioDir = options.audioDir ?? defaultAudioDir();
    const coverDir = options.coverDir ?? audioDir;
    try {
      const audio = await httpBuffer(track.audioUrl, {
        method: 'GET',
        service: 'suno',
        timeoutMs: this.timeoutMs,
        signal: options.signal,
        headers: { Accept: '*/*' },
      });
      const extension = extensionFromContentType(audio.contentType) ?? 'mp3';
      const baseName = sanitizeFileBaseName(track.title, 'suno');
      const audioPath = await saveBinaryFile(
        path.join(audioDir, createMediaFileName(baseName, extension)),
        audio.buffer,
      );
      let coverPath: string | undefined;
      if (track.coverUrl) {
        try {
          const cover = await httpBuffer(track.coverUrl, {
            method: 'GET',
            service: 'suno',
            timeoutMs: 30_000,
            signal: options.signal,
            headers: { Accept: '*/*' },
          });
          const coverExtension = extensionFromContentType(cover.contentType) ?? 'jpg';
          coverPath = await saveBinaryFile(
            path.join(coverDir, createMediaFileName(`${baseName}-cover`, coverExtension)),
            cover.buffer,
          );
        } catch {
          coverPath = undefined; // 封面非关键资源，失败不阻塞
        }
      }
      return { ...track, audioPath, coverPath };
    } catch (error) {
      throw toSunoError(error);
    }
  }

  /** 一站式：创建任务 → 轮询 → 下载音频与封面。 */
  async generateAndWait(
    params: SunoGenerateParams,
    wait: SunoWaitOptions = {},
    download: SunoDownloadOptions = {},
  ): Promise<SunoRecord> {
    const { taskId } = await this.generate(params);
    const record = await this.waitForTask(taskId, wait);
    if (download.enabled === false) return record;
    const tracks: SunoTrack[] = [];
    for (const track of record.tracks) {
      const downloaded = await this.downloadTrack(track, {
        ...download,
        signal: download.signal ?? wait.signal,
      });
      tracks.push(downloaded);
    }
    return { ...record, tracks };
  }

  /** 额度查询（GET /api/v1/get-credits）；接口不可用时返回 null。 */
  async getCredits(options: { signal?: AbortSignal } = {}): Promise<number | null> {
    this.requireKey();
    try {
      const payload = await httpJson<unknown>(buildUrl(this.baseUrl, '/api/v1/get-credits'), {
        method: 'GET',
        headers: this.headers({ Accept: 'application/json' }),
        service: 'suno',
        timeoutMs: 20_000,
        signal: options.signal,
      });
      const root = assertSunoOk(payload);
      const data = asRecord(root.data);
      const credits = firstNumber(data.credits, root.credits, data.credit, data.remainingCredits);
      return credits ?? null;
    } catch (error) {
      const mapped = toSunoError(error);
      if (mapped.code === 'NOT_FOUND') return null;
      throw mapped;
    }
  }

  /** 连通性测试：优先额度接口，回退任务查询探测。 */
  async testConnection(): Promise<ConnectionTestResult> {
    return runConnectionTest('suno', async () => {
      const credits = await this.getCredits({ signal: AbortSignal.timeout(15_000) });
      if (credits !== null) return `连接正常，剩余额度 ${credits}`;
      try {
        await this.getRecord('probe', { signal: AbortSignal.timeout(15_000) });
      } catch (error) {
        const mapped = toSunoError(error);
        if (mapped.code !== 'NOT_FOUND' && mapped.code !== 'BAD_REQUEST' && mapped.code !== 'UPSTREAM' && mapped.code !== 'RATE_LIMITED') throw mapped;
      }
      return '连接正常，密钥有效（额度接口不可用）';
    });
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }
}
