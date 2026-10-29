/**
 * 哔哩哔哩公开 API 客户端（排行榜 / 搜索 / 视频详情）。
 *
 * 关键接口事实：
 * - 排行榜：GET https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all
 * - 搜索：  GET https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=
 * - 详情：  GET https://api.bilibili.com/x/web-interface/view?bvid=
 * - 需要浏览器 UA 与 Referer；搜索/详情在部分网络环境还需携带 Cookie（buvid3 等）。
 * - 公开接口无需 API Key，Cookie 为可选参数，仅从构造参数传入，不落盘不打印。
 *
 * 输出统一为 BiliVideo（标题/封面/UP/播放量/时长/链接），可直接用于「自主刷 B 站」发现流。
 */
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  buildUrl,
  firstNumber,
  firstString,
  httpJson,
  IntegrationError,
  runConnectionTest,
  type ConnectionTestResult,
  type IntegrationErrorCode,
} from './http';

export interface BilibiliClientOptions {
  /** 可选 Cookie 字符串（仅内存使用）。 */
  cookie?: string;
  userAgent?: string;
  /** 默认 https://api.bilibili.com。 */
  baseUrl?: string;
  timeoutMs?: number;
}

export interface BiliVideo {
  bvid: string;
  aid?: number;
  title: string;
  cover: string;
  /** https://www.bilibili.com/video/{bvid} */
  url: string;
  upName: string;
  upMid?: number;
  play: number;
  danmaku?: number;
  /** 格式化时长，例如 03:25。 */
  duration: string;
  durationSec: number;
  /** 秒级发布时间戳。 */
  pubdate?: number;
  desc?: string;
}

export interface BiliRankingOptions {
  /** 分区 rid，默认 0（全站）。 */
  rid?: number;
  /** all：综合榜；origin：原创榜。 */
  type?: 'all' | 'origin';
  /** 客户端截取条数（排行榜接口一次性返回约 100 条）。 */
  limit?: number;
  signal?: AbortSignal;
}

export interface BiliSearchOptions {
  page?: number;
  /** totalrank（综合）/ click（播放）/ pubdate（最新）/ dm（弹幕）/ stow（收藏）。 */
  order?: 'totalrank' | 'click' | 'pubdate' | 'dm' | 'stow';
  /** 客户端截取条数。 */
  limit?: number;
  signal?: AbortSignal;
}

export interface BiliInterestOptions {
  /** 每个兴趣抓取条数，默认 3。 */
  limitPerInterest?: number;
  /** 总条数上限，默认 9。 */
  total?: number;
  signal?: AbortSignal;
}

const DEFAULT_BASE_URL = 'https://api.bilibili.com';
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function toBiliError(error: unknown): IntegrationError {
  return error instanceof IntegrationError
    ? error
    : new IntegrationError({
        service: 'bilibili',
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
}

function biliErrorCode(code: number): IntegrationErrorCode {
  if (code === -101 || code === -400) return 'UNAUTHORIZED';
  if (code === -412 || code === -799 || code === -352) return 'FORBIDDEN';
  if (code === -404) return 'NOT_FOUND';
  if (code === -500 || code === -503) return 'SERVER_ERROR';
  return 'UPSTREAM';
}

/** 校验 B 站信封 { code, message, data }。 */
function assertBiliOk(payload: unknown, action: string): Record<string, unknown> {
  const root = asRecord(payload);
  const rawCode = root.code;
  const code = asNumber(rawCode) ?? (typeof rawCode === 'string' ? Number(rawCode) : 0);
  if (Number.isNaN(code) || code === 0) return root;
  const message = firstString(root.message, root.msg) ?? `错误码 ${code}`;
  const hint =
    code === -412 || code === -799 || code === -352
      ? '（可能被风控拦截，请在设置中配置哔哩哔哩 Cookie 后重试）'
      : '';
  throw new IntegrationError({
    service: 'bilibili',
    code: biliErrorCode(code),
    message: `哔哩哔哩${action}失败（${code}）：${message}${hint}`,
    details: root,
  });
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCover(value: string | undefined): string {
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('http://')) return `https://${value.slice('http://'.length)}`;
  return value;
}

function parseDurationSeconds(value: unknown): number {
  const direct = asNumber(value);
  if (direct !== undefined) return Math.max(0, Math.round(direct));
  const text = asString(value);
  if (!text) return 0;
  const parts = text.split(':').map((part) => Number(part));
  if (parts.length === 0 || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '00:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function extractBvid(record: Record<string, unknown>): string | undefined {
  const direct = firstString(record.bvid, record.bv_id);
  if (direct) return direct;
  const arcurl = firstString(record.arcurl, record.short_link, record.url);
  if (arcurl) {
    const matched = arcurl.match(/BV[0-9A-Za-z]{8,12}/);
    if (matched) return matched[0];
  }
  return undefined;
}

function normalizeVideo(raw: unknown): BiliVideo | undefined {
  const record = asRecord(raw);
  const owner = asRecord(record.owner);
  const stat = asRecord(record.stat);
  const bvid = extractBvid(record);
  if (!bvid) return undefined;
  const durationSec = parseDurationSeconds(record.duration);
  const title = stripHtml(firstString(record.title, record.name) ?? '');
  if (!title) return undefined;
  const cover = normalizeCover(firstString(record.pic, record.cover, record.pic_url));
  const play = firstNumber(stat.view, record.play, record.play_count, record.stat_view) ?? 0;
  const danmaku = firstNumber(stat.danmaku, record.video_review, record.danmaku);
  const pubdate = firstNumber(record.pubdate, record.pub_time, record.created);
  const desc = firstString(record.desc, record.description, record.dynamic);
  return {
    bvid,
    aid: firstNumber(record.aid, record.id, record.av_id),
    title,
    cover,
    url: `https://www.bilibili.com/video/${bvid}`,
    upName: stripHtml(firstString(owner.name, record.author, record.up_name, record.upName) ?? '未知 UP 主'),
    upMid: firstNumber(owner.mid, record.mid, record.uid, record.up_mid),
    play,
    danmaku,
    duration: formatDuration(durationSec),
    durationSec,
    pubdate,
    desc: desc ? stripHtml(desc) : undefined,
  };
}

export class BilibiliClient {
  private readonly baseUrl: string;
  private readonly cookie?: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;

  constructor(options: BilibiliClientOptions = {}) {
    this.baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this.cookie = options.cookie?.trim() || undefined;
    this.userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 全站/分区排行榜：GET /x/web-interface/ranking/v2。 */
  async getRanking(options: BiliRankingOptions = {}): Promise<BiliVideo[]> {
    const rid = options.rid ?? 0;
    try {
      const payload = await httpJson<unknown>(
        buildUrl(this.baseUrl, '/x/web-interface/ranking/v2', {
          rid,
          type: options.type ?? 'all',
        }),
        {
          method: 'GET',
          headers: this.headers(),
          service: 'bilibili',
          timeoutMs: this.timeoutMs,
          retries: 1,
          signal: options.signal,
        },
      );
      const root = assertBiliOk(payload, '排行榜获取');
      const data = asRecord(root.data);
      const list = asArray(data.list);
      const videos = list
        .map(normalizeVideo)
        .filter((video): video is BiliVideo => video !== undefined);
      const limit = options.limit ?? videos.length;
      return videos.slice(0, Math.max(0, limit));
    } catch (error) {
      throw toBiliError(error);
    }
  }

  /** 视频搜索：GET /x/web-interface/search/type（search_type=video）。 */
  async searchVideos(keyword: string, options: BiliSearchOptions = {}): Promise<BiliVideo[]> {
    const query = (keyword ?? '').trim();
    if (!query) {
      throw new IntegrationError({
        service: 'bilibili',
        code: 'BAD_REQUEST',
        message: 'B 站搜索关键词不能为空',
      });
    }
    try {
      const payload = await httpJson<unknown>(
        buildUrl(this.baseUrl, '/x/web-interface/search/type', {
          search_type: 'video',
          keyword: query,
          page: options.page ?? 1,
          order: options.order ?? 'totalrank',
        }),
        {
          method: 'GET',
          headers: this.headers(),
          service: 'bilibili',
          timeoutMs: this.timeoutMs,
          retries: 1,
          signal: options.signal,
        },
      );
      const root = assertBiliOk(payload, '视频搜索');
      const data = asRecord(root.data);
      const list = asArray(data.result);
      const videos = list
        .map(normalizeVideo)
        .filter((video): video is BiliVideo => video !== undefined);
      const limit = options.limit ?? videos.length;
      return videos.slice(0, Math.max(0, limit));
    } catch (error) {
      throw toBiliError(error);
    }
  }

  /** 视频详情：GET /x/web-interface/view（bvid 或 aid）。 */
  async getVideoInfo(
    id: string | number,
    options: { signal?: AbortSignal } = {},
  ): Promise<BiliVideo> {
    const text = String(id ?? '').trim();
    if (!text) {
      throw new IntegrationError({
        service: 'bilibili',
        code: 'BAD_REQUEST',
        message: '缺少视频 bvid 或 aid',
      });
    }
    const query = /^\d+$/.test(text) ? { aid: Number(text) } : { bvid: text };
    try {
      const payload = await httpJson<unknown>(
        buildUrl(this.baseUrl, '/x/web-interface/view', query),
        {
          method: 'GET',
          headers: this.headers(),
          service: 'bilibili',
          timeoutMs: this.timeoutMs,
          retries: 1,
          signal: options.signal,
        },
      );
      const root = assertBiliOk(payload, '视频详情获取');
      const data = asRecord(root.data);
      const video = normalizeVideo({ ...data, bvid: firstString(data.bvid) ?? text });
      if (!video) {
        throw new IntegrationError({
          service: 'bilibili',
          code: 'BAD_RESPONSE',
          message: '哔哩哔哩未返回有效的视频信息',
          details: payload,
        });
      }
      return video;
    } catch (error) {
      throw toBiliError(error);
    }
  }

  /**
   * 按兴趣批量发现视频（供自主行为使用）。
   * 单个兴趣失败不会中断整体流程；取消信号会立即透传。
   */
  async searchByInterests(
    interests: readonly string[],
    options: BiliInterestOptions = {},
  ): Promise<BiliVideo[]> {
    const limitPerInterest = Math.max(1, options.limitPerInterest ?? 3);
    const total = Math.max(1, options.total ?? 9);
    const seen = new Set<string>();
    const collected: BiliVideo[] = [];
    for (const interest of interests) {
      if (collected.length >= total) break;
      const keyword = (interest ?? '').trim();
      if (!keyword) continue;
      try {
        const videos = await this.searchVideos(keyword, {
          limit: limitPerInterest,
          signal: options.signal,
        });
        for (const video of videos) {
          if (seen.has(video.bvid)) continue;
          seen.add(video.bvid);
          collected.push(video);
          if (collected.length >= total) break;
        }
      } catch (error) {
        if (options.signal?.aborted) throw toBiliError(error);
        // 单个兴趣失败（风控/无结果）不影响其它兴趣
      }
    }
    return collected;
  }

  /** 连通性测试：拉取全站排行榜前几条。 */
  async testConnection(): Promise<ConnectionTestResult> {
    return runConnectionTest('bilibili', async () => {
      const videos = await this.getRanking({
        limit: 3,
        signal: AbortSignal.timeout(15_000),
      });
      if (videos.length === 0) return '连接正常，但排行榜暂无数据';
      return `连接正常，排行榜返回 ${videos.length} 条（示例：${videos[0].title}）`;
    });
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Referer: 'https://www.bilibili.com/',
      Accept: 'application/json, text/plain, */*',
    };
    if (this.cookie) headers.Cookie = this.cookie;
    return headers;
  }
}
