/**
 * MiniMax 图像 / 视频生成客户端（官方 2026-10 版本）。
 *
 * 关键接口事实：
 * - 基础地址：https://api.minimax.cn（Authorization: Bearer <apiKey>）
 * - 图像：POST /v1/image_generation（image-01 / image-01-live，支持 aspect_ratio / n / response_format）
 *
 * 视频两代接口并存：
 * - H3 家族（MiniMax-H3 / MiniMax-H3-Highspeed / MiniMax-H3-Lite / MiniMax-H3-Max）走 V2 异步接口：
 *   POST /v2/video_generation
 *     body: { model, content: [{ type: 'text', text: prompt }], resolution, duration, ratio }
 *     H3：768P / 2K，时长 4-15；Highspeed / Lite / Max 不支持 2K
 *     （Lite / Max 另支持 480P），其中 Max 时长 5-15；文生视频 ratio 必填且不能为 adaptive。
 *   GET /v2/query/video_generation/{task_id}
 *     task.status: queued / running / succeeded / failed / cancelled
 *     task.content.url: 成功后直接下载（无需 /v1/files/retrieve）
 *     task.usage.output_seconds: 实际生成时长
 * - 旧 Hailuo / T2V-01 继续走 V1（行为保持不变）：
 *   POST /v1/video_generation、GET /v1/query/video_generation?taskId=、
 *   GET /v1/files/retrieve?file_id= → file.download_url。
 * - 业务错误可能以 HTTP 200 + base_resp.status_code 返回；V2 响应可能没有 base_resp，缺失不视为错误。
 *
 * 所有密钥仅来自构造参数；轮询支持超时与 AbortSignal 取消。
 */
import { Buffer } from 'node:buffer';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  asArray,
  asNumber,
  asRecord,
  buildUrl,
  createMediaFileName,
  firstNumber,
  firstString,
  httpBuffer,
  httpJson,
  IntegrationError,
  runConnectionTest,
  saveBinaryFile,
  sleepWithSignal,
  type ConnectionTestResult,
} from './http';

export interface MinimaxClientOptions {
  apiKey: string;
  /** 默认 https://api.minimax.io。 */
  baseUrl?: string;
  /** 默认 image-01-live。 */
  imageModel?: string;
  /** 默认 MiniMax-H3（2026-10 最新 H3 家族）。 */
  videoModel?: string;
  /** 默认 2K（仅 MiniMax-H3 支持；其它 H3 子模型会自动回退 768P）。 */
  videoResolution?: string;
  /** 默认 6 秒（H3 允许 4-15；H3-Max 为 5-15）。 */
  videoDuration?: number;
  timeoutMs?: number;
}

export interface ImageGenerateParams {
  prompt: string;
  model?: string;
  /** 例如 1:1 / 16:9 / 4:3 / 3:4 / 9:16。 */
  aspectRatio?: string;
  /** 生成数量 1~4。 */
  n?: number;
  /** url：返回图片链接；base64：落盘为本地文件（默认）。 */
  responseFormat?: 'url' | 'base64';
  promptOptimizer?: boolean;
  seed?: number;
  /** 传入后把 URL 图片也下载到本地；base64 模式必用（缺省用系统临时目录）。 */
  outDir?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ImageGenerateResult {
  /** 可公开访问的图片链接（base64 模式为空数组）。 */
  urls: string[];
  /** 本地文件绝对路径（传了 outDir 或 base64 模式时存在）。 */
  files: string[];
  model: string;
}

export interface VideoGenerateParams {
  prompt: string;
  model?: string;
  /** H3：768P / 2K；旧 Hailuo/T2V：512P / 768P / 1080P。 */
  resolution?: string;
  /** 时长（秒）：H3 为 4-15（Max 5-15），旧 Hailuo 通常 6 / 10。 */
  duration?: number;
  /**
   * 画面比例，仅 H3（V2）使用，默认 16:9。
   * 文生视频必填且不能为 adaptive。
   */
  aspectRatio?: string;
  promptOptimizer?: boolean;
  /** 首帧图：公网 URL 或 data:image/...;base64,...（仅旧 Hailuo/T2V 支持）。 */
  firstFrameImage?: string;
  /** 尾帧图：公网 URL 或 data:image/...;base64,...（仅旧 Hailuo/T2V 支持）。 */
  lastFrameImage?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface VideoTaskStatus {
  taskId: string;
  /** 已归一化状态：Queueing / Processing / Success / Fail / Unknown。 */
  status: string;
  /** 上游原始状态：v1 为 Queueing/Processing/Success/Fail；v2 为 queued/running/succeeded/failed/cancelled。 */
  rawStatus?: string;
  /** v1 的 file_id；v2 通常没有（成功后用 task.content.url 直接下载）。 */
  fileId?: string;
  /** v2（H3）成功后的直链下载地址。 */
  downloadUrl?: string;
  /** v2 task.usage.output_seconds：实际生成时长（秒）。 */
  outputSeconds?: number;
  statusMessage?: string;
  raw?: unknown;
}

export interface VideoPollOptions {
  /** 轮询间隔，默认 5s。 */
  pollIntervalMs?: number;
  /** 整体超时，默认 10 分钟。 */
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * 任务所属模型。应用重启后恢复轮询时传入 H3 模型名，
   * 可让本实例重新识别该 taskId 属于 V2 接口。
   */
  model?: string;
  onProgress?: (status: VideoTaskStatus) => void;
}

export interface VideoGenerateResult {
  taskId: string;
  /** v1 为 file_id；H3（V2）没有 file_id，用 taskId 占位。 */
  fileId: string;
  downloadUrl: string;
  /** 下载到本地的绝对路径（未指定 outDir 时用系统临时目录）。 */
  filePath?: string;
  status: string;
  /** V2 task.usage.output_seconds（如有）。 */
  outputSeconds?: number;
  elapsedMs: number;
}

export interface MinimaxFileInfo {
  fileId: string;
  downloadUrl: string;
  filename?: string;
  bytes?: number;
}

const DEFAULT_BASE_URL = 'https://api.minimax.io';
const DEFAULT_IMAGE_MODEL = 'image-01-live';

/** 2026-10 最新 H3 家族模型 ID。 */
export const MINIMAX_H3_VIDEO_MODELS = [
  'MiniMax-H3',
  'MiniMax-H3-Highspeed',
  'MiniMax-H3-Lite',
  'MiniMax-H3-Max',
] as const;
export type MinimaxH3VideoModel = (typeof MINIMAX_H3_VIDEO_MODELS)[number];

/** 视频默认值（设置页 / UI 默认值参考）。 */
export const MINIMAX_VIDEO_DEFAULTS = {
  model: 'MiniMax-H3',
  resolution: '2K',
  duration: 6,
  aspectRatio: '16:9',
} as const;

const DEFAULT_VIDEO_MODEL = MINIMAX_VIDEO_DEFAULTS.model;
const DEFAULT_VIDEO_RESOLUTION = MINIMAX_VIDEO_DEFAULTS.resolution;
const DEFAULT_VIDEO_DURATION = MINIMAX_VIDEO_DEFAULTS.duration;
const DEFAULT_VIDEO_ASPECT_RATIO = MINIMAX_VIDEO_DEFAULTS.aspectRatio;
const H3_MODEL_PREFIX = 'minimax-h3';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_POLL_TIMEOUT_MS = 10 * 60_000;
const LEGACY_RESOLUTIONS = new Set(['512P', '768P', '1080P']);

function defaultMediaDir(kind: 'image' | 'video'): string {
  return path.join(os.tmpdir(), 'jingjing-media', 'minimax', kind);
}

function minimaxErrorCode(statusCode: number): 'UNAUTHORIZED' | 'RATE_LIMITED' | 'BAD_REQUEST' | 'UPSTREAM' {
  if (statusCode === 1004 || statusCode === 2049) return 'UNAUTHORIZED';
  if (statusCode === 1002) return 'RATE_LIMITED';
  if (statusCode === 1008) return 'UPSTREAM'; // 余额不足
  if (statusCode === 2013 || statusCode === 2014) return 'BAD_REQUEST';
  if (statusCode === 1026 || statusCode === 1027) return 'BAD_REQUEST'; // 内容安全
  return 'UPSTREAM';
}

/** 校验 MiniMax 业务信封；业务成功返回根对象（V2 无 base_resp 时按成功处理）。 */
function assertMinimaxOk(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  const base = asRecord(root.base_resp);
  const rawCode = base.status_code;
  const statusCode =
    asNumber(rawCode) ?? (typeof rawCode === 'string' ? Number(rawCode) : undefined);
  if (statusCode === undefined || statusCode === 0 || Number.isNaN(statusCode)) return root;
  const message = firstString(base.status_msg) ?? '未知错误';
  throw new IntegrationError({
    service: 'minimax',
    code: minimaxErrorCode(statusCode),
    message: `MiniMax 接口错误（${statusCode}）：${message}`,
    details: { statusCode, statusMsg: message },
  });
}

/** 是否属于 2026-10 H3 家族（走 V2 接口）。 */
export function isH3VideoModel(model: string | undefined): boolean {
  return typeof model === 'string' && model.trim().toLowerCase().startsWith(H3_MODEL_PREFIX);
}

interface H3Constraints {
  minDuration: number;
  maxDuration: number;
  /** 支持的分辨率，第一个为默认首选。 */
  resolutions: readonly string[];
}

/** H3 各子模型的能力边界（官方 2026-10，与 settings.ts 的白名单保持一致）。 */
function h3Constraints(model: string): H3Constraints {
  const lower = model.trim().toLowerCase();
  if (lower === 'minimax-h3') {
    return { minDuration: 4, maxDuration: 15, resolutions: ['2K', '768P'] };
  }
  if (lower === 'minimax-h3-max') {
    return { minDuration: 5, maxDuration: 15, resolutions: ['768P', '480P'] };
  }
  if (lower === 'minimax-h3-lite') {
    return { minDuration: 4, maxDuration: 15, resolutions: ['768P', '480P'] };
  }
  // Highspeed 及其它 H3 变体：仅 768P，4-15 秒
  return { minDuration: 4, maxDuration: 15, resolutions: ['768P'] };
}

/** 状态归一化：v1 与 v2 两套状态词都映射到内部四态。 */
function normalizeVideoStatus(status: string | undefined): string {
  if (!status) return 'Unknown';
  const lower = status.toLowerCase();
  if (lower === 'queueing' || lower === 'queued') return 'Queueing';
  if (lower === 'processing' || lower === 'running') return 'Processing';
  if (lower === 'success' || lower === 'succeeded' || lower === 'finished') return 'Success';
  if (
    lower === 'fail' ||
    lower === 'failed' ||
    lower === 'error' ||
    lower === 'cancelled' ||
    lower === 'canceled'
  ) {
    return 'Fail';
  }
  return status;
}

function abortError(): IntegrationError {
  return new IntegrationError({ service: 'minimax', code: 'ABORTED', message: '视频任务已取消' });
}

export class MinimaxClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly imageModel: string;
  private readonly videoModel: string;
  private readonly videoResolution: string;
  private readonly videoDuration: number;
  private readonly timeoutMs: number;
  /** 本实例创建的 H3 任务（V2 查询路径与 v1 不同，用内存 Set 记录）。 */
  private readonly h3TaskIds = new Set<string>();

  constructor(options: MinimaxClientOptions) {
    this.apiKey = (options.apiKey ?? '').trim();
    this.baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this.imageModel = options.imageModel?.trim() || DEFAULT_IMAGE_MODEL;
    this.videoModel = options.videoModel?.trim() || DEFAULT_VIDEO_MODEL;
    this.videoResolution = options.videoResolution?.trim() || DEFAULT_VIDEO_RESOLUTION;
    this.videoDuration = options.videoDuration ?? DEFAULT_VIDEO_DURATION;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 调用前校验密钥，未配置时抛出统一的 MISSING_API_KEY。 */
  private requireKey(): string {
    if (!this.apiKey) {
      throw new IntegrationError({
        service: 'minimax',
        code: 'MISSING_API_KEY',
        message: '尚未配置 MiniMax API Key，请在设置 → API 密钥中填写',
      });
    }
    return this.apiKey;
  }

  /** 当前默认模型（设置页展示用）。 */
  get models(): { image: string; video: string } {
    return { image: this.imageModel, video: this.videoModel };
  }

  /**
   * 图像生成：POST /v1/image_generation
   * base64 结果自动落盘；url 结果在传入 outDir 时也会下载到本地。
   */
  async generateImage(params: ImageGenerateParams): Promise<ImageGenerateResult> {
    this.requireKey();
    const prompt = (params.prompt ?? '').trim();
    if (!prompt) {
      throw new IntegrationError({
        service: 'minimax',
        code: 'BAD_REQUEST',
        message: '图像描述（prompt）不能为空',
      });
    }
    const model = params.model?.trim() || this.imageModel;
    const responseFormat = params.responseFormat ?? 'base64';
    const body: Record<string, unknown> = {
      model,
      prompt,
      response_format: responseFormat,
      prompt_optimizer: params.promptOptimizer ?? false,
    };
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (typeof params.n === 'number') body.n = Math.max(1, Math.min(4, Math.floor(params.n)));
    if (typeof params.seed === 'number') body.seed = params.seed;

    try {
      const payload = await httpJson<unknown>(buildUrl(this.baseUrl, '/v1/image_generation'), {
        method: 'POST',
        headers: this.headers(),
        body,
        service: 'minimax',
        timeoutMs: params.timeoutMs ?? this.timeoutMs,
        signal: params.signal,
      });
      const root = assertMinimaxOk(payload);
      const data = asRecord(root.data);
      const urls = asArray(data.image_urls ?? data.imageUrls)
        .filter((item): item is string => typeof item === 'string' && item.length > 0);
      const base64List = asArray(data.image_base64 ?? data.imageBase64)
        .filter((item): item is string => typeof item === 'string' && item.length > 0);

      const files: string[] = [];
      if (base64List.length > 0) {
        const outDir = params.outDir ?? defaultMediaDir('image');
        for (const base64 of base64List) {
          const buffer = Buffer.from(stripDataUrlPrefix(base64), 'base64');
          if (buffer.byteLength === 0) continue;
          const filePath = path.join(outDir, createMediaFileName('image', 'jpg'));
          files.push(await saveBinaryFile(filePath, buffer));
        }
      }
      if (urls.length > 0 && params.outDir) {
        for (let index = 0; index < urls.length; index += 1) {
          // CDN 下载失败时保留原始 URL，避免整个文生图请求被误判为网络失败。
          try {
            const downloaded = await this.download(urls[index], {
              outDir: params.outDir,
              fileName: createMediaFileName(`image-${index + 1}`, 'jpg'),
              signal: params.signal,
            });
            files.push(downloaded);
          } catch {
            /* fallback to remote url below */
          }
        }
      }
      if (urls.length === 0 && files.length === 0) {
        throw new IntegrationError({
          service: 'minimax',
          code: 'BAD_RESPONSE',
          message: 'MiniMax 未返回任何图片数据',
        });
      }
      return { urls, files, model };
    } catch (error) {
      throw toMinimaxError(error);
    }
  }

  /**
   * 创建视频生成任务，返回 taskId。
   * - model 以 MiniMax-H3 开头 → V2 异步接口；
   * - 其它（Hailuo / T2V-01 等）→ 旧 V1 接口。
   */
  async createVideoTask(params: VideoGenerateParams): Promise<string> {
    this.requireKey();
    const prompt = (params.prompt ?? '').trim();
    if (!prompt) {
      throw new IntegrationError({
        service: 'minimax',
        code: 'BAD_REQUEST',
        message: '视频描述（prompt）不能为空',
      });
    }
    const model = params.model?.trim() || this.videoModel;
    if (isH3VideoModel(model)) {
      const taskId = await this.createH3VideoTask(model, prompt, params);
      this.h3TaskIds.add(taskId);
      return taskId;
    }
    return this.createLegacyVideoTask(model, prompt, params);
  }

  /**
   * V2（H3）：POST /v2/video_generation
   * body 使用 content 数组（仅文本项），并必带 ratio。
   */
  private async createH3VideoTask(
    model: string,
    prompt: string,
    params: VideoGenerateParams,
  ): Promise<string> {
    const constraints = h3Constraints(model);
    const preferredResolution = constraints.resolutions[0];
    let resolution: string;
    if (params.resolution === undefined) {
      // 客户端默认分辨率（如 H3 的 2K）不适用于当前子模型时，回退到该模型的首选值。
      const fallback = this.videoResolution.trim().toUpperCase();
      resolution = constraints.resolutions.includes(fallback) ? fallback : preferredResolution;
    } else {
      const requested = params.resolution.trim().toUpperCase();
      if (!constraints.resolutions.includes(requested)) {
        throw new IntegrationError({
          service: 'minimax',
          code: 'BAD_REQUEST',
          message: `模型 ${model} 支持的分辨率：${constraints.resolutions.join(' / ')}，收到 ${params.resolution}`,
        });
      }
      resolution = requested;
    }

    // 时长越界时收敛到官方区间（settings 侧滑杆可能给出 4 秒 + H3-Max 的组合）。
    const requestedDuration = Math.round(params.duration ?? this.videoDuration);
    const duration = Math.min(
      constraints.maxDuration,
      Math.max(constraints.minDuration, Number.isFinite(requestedDuration) ? requestedDuration : this.videoDuration),
    );

    const ratio = params.aspectRatio?.trim() || DEFAULT_VIDEO_ASPECT_RATIO;
    if (ratio.toLowerCase() === 'adaptive') {
      throw new IntegrationError({
        service: 'minimax',
        code: 'BAD_REQUEST',
        message: 'H3 文生视频必须显式指定画面比例（如 16:9 / 9:16），不能使用 adaptive',
      });
    }

    if (params.firstFrameImage || params.lastFrameImage) {
      throw new IntegrationError({
        service: 'minimax',
        code: 'BAD_REQUEST',
        message: 'MiniMax-H3（V2）当前为文生视频，暂不支持首尾帧参数；图生视频请改用旧版 Hailuo / T2V 模型',
      });
    }

    const body: Record<string, unknown> = {
      model,
      content: [{ type: 'text', text: prompt }],
      resolution,
      duration,
      ratio,
    };

    try {
      const payload = await httpJson<unknown>(buildUrl(this.baseUrl, '/v2/video_generation'), {
        method: 'POST',
        headers: this.headers(),
        body,
        service: 'minimax',
        timeoutMs: params.timeoutMs ?? this.timeoutMs,
        signal: params.signal,
      });
      const root = assertMinimaxOk(payload);
      const task = asRecord(root.task);
      const data = asRecord(root.data);
      const taskId = firstString(
        root.task_id,
        root.taskId,
        task.id,
        data.task_id,
        data.taskId,
        data.id,
      );
      if (!taskId) {
        throw new IntegrationError({
          service: 'minimax',
          code: 'BAD_RESPONSE',
          message: 'MiniMax 未返回视频任务 ID（task_id / task.id）',
          details: payload,
        });
      }
      return taskId;
    } catch (error) {
      throw toMinimaxError(error);
    }
  }

  /** V1（Hailuo / T2V-01）：POST /v1/video_generation，行为保持原样。 */
  private async createLegacyVideoTask(
    model: string,
    prompt: string,
    params: VideoGenerateParams,
  ): Promise<string> {
    const requested = (params.resolution ?? this.videoResolution).trim().toUpperCase();
    let resolution: string;
    if (params.resolution !== undefined) {
      if (!LEGACY_RESOLUTIONS.has(requested)) {
        throw new IntegrationError({
          service: 'minimax',
          code: 'BAD_REQUEST',
          message: `旧版视频模型仅支持 512P / 768P / 1080P 分辨率，收到 ${params.resolution}`,
        });
      }
      resolution = requested;
    } else {
      // 客户端默认值可能已切到 H3 的 2K，旧模型自动回退到 768P。
      resolution = LEGACY_RESOLUTIONS.has(requested) ? requested : '768P';
    }
    const duration = params.duration ?? this.videoDuration;
    const body: Record<string, unknown> = {
      model,
      prompt,
      prompt_optimizer: params.promptOptimizer ?? true,
      resolution,
      duration,
    };
    if (params.firstFrameImage) body.first_frame_image = params.firstFrameImage;
    if (params.lastFrameImage) body.last_frame_image = params.lastFrameImage;

    try {
      const payload = await httpJson<unknown>(buildUrl(this.baseUrl, '/v1/video_generation'), {
        method: 'POST',
        headers: this.headers(),
        body,
        service: 'minimax',
        timeoutMs: params.timeoutMs ?? this.timeoutMs,
        signal: params.signal,
      });
      const root = assertMinimaxOk(payload);
      const data = asRecord(root.data);
      const taskId = firstString(data.task_id, data.taskId, root.task_id, root.taskId);
      if (!taskId) {
        throw new IntegrationError({
          service: 'minimax',
          code: 'BAD_RESPONSE',
          message: 'MiniMax 未返回视频任务 ID（task_id）',
          details: payload,
        });
      }
      return taskId;
    } catch (error) {
      throw toMinimaxError(error);
    }
  }

  /**
   * 查询视频任务状态。
   * - 本实例创建的 H3 任务（或 options.model 指明为 H3）→ GET /v2/query/video_generation/{task_id}；
   * - 其它任务 → GET /v1/query/video_generation?taskId=。
   */
  async queryVideoTask(
    taskId: string,
    options: { signal?: AbortSignal; model?: string } = {},
  ): Promise<VideoTaskStatus> {
    this.requireKey();
    if (!taskId) {
      throw new IntegrationError({
        service: 'minimax',
        code: 'BAD_REQUEST',
        message: '缺少视频任务 ID',
      });
    }
    if (options.model && isH3VideoModel(options.model)) this.h3TaskIds.add(taskId);
    if (this.h3TaskIds.has(taskId)) return this.queryH3VideoTask(taskId, options.signal);
    return this.queryLegacyVideoTask(taskId, options.signal);
  }

  /** V2 查询：GET /v2/query/video_generation/{task_id}，解析 task.status / task.content.url / task.usage。 */
  private async queryH3VideoTask(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<VideoTaskStatus> {
    try {
      const payload = await httpJson<unknown>(
        buildUrl(this.baseUrl, `/v2/query/video_generation/${encodeURIComponent(taskId)}`),
        {
          method: 'GET',
          headers: this.headers({ Accept: 'application/json' }),
          service: 'minimax',
          timeoutMs: 30_000,
          signal,
        },
      );
      const root = assertMinimaxOk(payload);
      const data = asRecord(root.data);
      const rootTask = asRecord(root.task);
      const dataTask = asRecord(data.task);
      const task =
        Object.keys(rootTask).length > 0
          ? rootTask
          : Object.keys(dataTask).length > 0
            ? dataTask
            : root;
      const usage = asRecord(task.usage);
      const content = asRecord(task.content);
      const rawStatus = firstString(task.status, root.status, task.state, data.status);
      return {
        taskId: firstString(task.id, task.task_id, root.task_id, data.task_id) ?? taskId,
        status: normalizeVideoStatus(rawStatus),
        rawStatus,
        fileId: firstString(task.file_id, root.file_id),
        downloadUrl: firstString(
          content.url,
          content.download_url,
          content.downloadUrl,
          task.download_url,
          root.download_url,
        ),
        outputSeconds: firstNumber(
          usage.output_seconds,
          usage.outputSeconds,
          asRecord(root.usage).output_seconds,
          asRecord(data.usage).output_seconds,
        ),
        statusMessage: firstString(
          task.error,
          task.error_message,
          task.status_msg,
          asRecord(task.error).message,
          asRecord(root.error).message,
          root.status_msg,
          asRecord(root.base_resp).status_msg,
        ),
        raw: payload,
      };
    } catch (error) {
      throw toMinimaxError(error);
    }
  }

  /** V1 查询：GET /v1/query/video_generation?taskId=（行为保持原样）。 */
  private async queryLegacyVideoTask(
    taskId: string,
    signal?: AbortSignal,
  ): Promise<VideoTaskStatus> {
    try {
      const payload = await httpJson<unknown>(
        buildUrl(this.baseUrl, '/v1/query/video_generation', { taskId }),
        {
          method: 'GET',
          headers: this.headers({ Accept: 'application/json' }),
          service: 'minimax',
          timeoutMs: 30_000,
          signal,
        },
      );
      const root = assertMinimaxOk(payload);
      const data = asRecord(root.data);
      const rawStatus = firstString(data.status, root.status, data.task_status, root.task_status);
      return {
        taskId: firstString(data.task_id, data.taskId, root.task_id) ?? taskId,
        status: normalizeVideoStatus(rawStatus),
        rawStatus,
        fileId: firstString(data.file_id, data.fileId, root.file_id, root.fileId),
        statusMessage: firstString(
          data.status_msg,
          root.status_msg,
          asRecord(root.base_resp).status_msg,
        ),
        raw: payload,
      };
    } catch (error) {
      throw toMinimaxError(error);
    }
  }

  /** 轮询直到视频生成完成；支持超时与取消。 */
  async waitForVideoTask(
    taskId: string,
    options: VideoPollOptions = {},
  ): Promise<VideoTaskStatus> {
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS;
    const startedAt = Date.now();
    for (;;) {
      if (options.signal?.aborted) throw abortError();
      const status = await this.queryVideoTask(taskId, {
        signal: options.signal,
        model: options.model,
      });
      options.onProgress?.(status);
      if (status.status === 'Success') return status;
      if (status.status === 'Fail') {
        throw new IntegrationError({
          service: 'minimax',
          code: 'UPSTREAM',
          message: `MiniMax 视频生成失败：${status.statusMessage ?? status.rawStatus ?? '未知原因'}`,
          details: status.raw,
        });
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new IntegrationError({
          service: 'minimax',
          code: 'TIMEOUT',
          message: `视频生成等待超时（${Math.round(timeoutMs / 1000)}s），可稍后凭 taskId 重新查询：${taskId}`,
        });
      }
      try {
        await sleepWithSignal(pollIntervalMs, options.signal);
      } catch {
        throw abortError();
      }
    }
  }

  /** GET /v1/files/retrieve?file_id= → 下载地址（仅旧版 Hailuo/T2V 需要）。 */
  async retrieveFile(
    fileId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<MinimaxFileInfo> {
    this.requireKey();
    if (!fileId) {
      throw new IntegrationError({
        service: 'minimax',
        code: 'BAD_REQUEST',
        message: '缺少文件 ID（file_id）',
      });
    }
    try {
      const payload = await httpJson<unknown>(
        buildUrl(this.baseUrl, '/v1/files/retrieve', { file_id: fileId }),
        {
          method: 'GET',
          headers: this.headers({ Accept: 'application/json' }),
          service: 'minimax',
          timeoutMs: 30_000,
          signal: options.signal,
        },
      );
      const root = assertMinimaxOk(payload);
      const data = asRecord(root.data);
      const file = asRecord(root.file).file_id !== undefined ? asRecord(root.file) : asRecord(data.file);
      const downloadUrl = firstString(
        file.download_url,
        file.downloadUrl,
        root.download_url,
        root.downloadUrl,
        data.download_url,
        data.downloadUrl,
      );
      if (!downloadUrl) {
        throw new IntegrationError({
          service: 'minimax',
          code: 'BAD_RESPONSE',
          message: 'MiniMax 文件检索未返回下载地址（download_url）',
          details: payload,
        });
      }
      return {
        fileId: firstString(file.file_id, file.fileId) ?? fileId,
        downloadUrl,
        filename: firstString(file.filename, file.file_name),
        bytes: firstNumber(file.bytes, file.size),
      };
    } catch (error) {
      throw toMinimaxError(error);
    }
  }

  /**
   * 完整视频流程：创建任务 → 轮询 → 下载。
   * - H3（V2）：成功后直接用 task.content.url 下载，不调用 /v1/files/retrieve；
   * - 旧 Hailuo/T2V（V1）：沿用 file_id + files/retrieve 流程。
   */
  async generateVideo(
    params: VideoGenerateParams,
    poll: VideoPollOptions = {},
    download: { outDir?: string; fileName?: string; enabled?: boolean } = {},
  ): Promise<VideoGenerateResult> {
    const startedAt = Date.now();
    const model = params.model?.trim() || this.videoModel;
    const taskId = await this.createVideoTask(params);
    const status = await this.waitForVideoTask(taskId, { ...poll, model });

    let fileId = status.fileId;
    let downloadUrl = status.downloadUrl;
    if (!downloadUrl) {
      if (!fileId) {
        throw new IntegrationError({
          service: 'minimax',
          code: 'BAD_RESPONSE',
          message: '视频任务成功但未返回 file_id 或下载地址，无法下载',
          details: status.raw,
        });
      }
      const file = await this.retrieveFile(fileId, { signal: poll.signal });
      downloadUrl = file.downloadUrl;
    }
    // H3（V2）没有 file_id，用 taskId 占位，便于 UI 关联任务。
    if (!fileId) fileId = taskId;

    let filePath: string | undefined;
    if (download.enabled !== false) {
      const outDir = download.outDir ?? defaultMediaDir('video');
      const fileName = download.fileName?.trim() || createMediaFileName('video', 'mp4');
      filePath = await this.download(downloadUrl, {
        outDir,
        fileName,
        signal: poll.signal,
      });
    }
    return {
      taskId,
      fileId,
      downloadUrl,
      filePath,
      status: status.status,
      outputSeconds: status.outputSeconds,
      elapsedMs: Date.now() - startedAt,
    };
  }

  /** 下载任意媒体文件到本地目录（返回绝对路径）。 */
  async download(
    url: string,
    options: { outDir: string; fileName?: string; signal?: AbortSignal },
  ): Promise<string> {
    this.requireKey();
    const target = path.join(
      options.outDir,
      options.fileName?.trim() || createMediaFileName('media', 'bin'),
    );
    try {
      const result = await httpBuffer(url, {
        method: 'GET',
        service: 'minimax',
        timeoutMs: this.timeoutMs,
        signal: options.signal,
        headers: { Accept: '*/*' },
      });
      return await saveBinaryFile(target, result.buffer);
    } catch (error) {
      throw toMinimaxError(error);
    }
  }

  /** 连通性与密钥有效性测试：用文件检索接口探测（不消耗生成额度）。 */
  async testConnection(): Promise<ConnectionTestResult> {
    return runConnectionTest('minimax', async () => {
      try {
        await this.retrieveFile('0', { signal: AbortSignal.timeout(15_000) });
        return '连接正常，密钥有效';
      } catch (error) {
        const mapped = toMinimaxError(error);
        if (
          mapped.code === 'NOT_FOUND' ||
          mapped.code === 'BAD_REQUEST' ||
          mapped.code === 'UPSTREAM'
        ) {
          return '连接正常，密钥有效（探测请求返回预期参数错误）';
        }
        throw mapped;
      }
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

function stripDataUrlPrefix(value: string): string {
  const index = value.indexOf('base64,');
  return index >= 0 ? value.slice(index + 'base64,'.length) : value;
}

function toMinimaxError(error: unknown): IntegrationError {
  return error instanceof IntegrationError
    ? error
    : new IntegrationError({
        service: 'minimax',
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
}
