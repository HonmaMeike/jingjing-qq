/**
 * Serper.dev Google 搜索客户端。
 *
 * 关键接口事实：
 * - POST https://google.serper.dev/search（/news、/images 为同类端点）
 * - 鉴权头：X-API-KEY
 * - 请求体：{ q, num?, gl?, hl?, page?, tbs? }
 * - 响应：organic[] / news[] / images[]，另有 answerBox、knowledgeGraph、credits
 *
 * 输出统一为 shared/types 的 SearchResultItem[]，方便直接喂给提示词或 UI。
 */
import {
  asNumber,
  asRecord,
  asString,
  asArray,
  buildUrl,
  httpJson,
  IntegrationError,
  runConnectionTest,
  type ConnectionTestResult,
} from './http';
import type { SearchResultItem } from '../../../shared/types';

export type SerperSearchType = 'search' | 'news' | 'images' | 'videos' | 'places';

export interface SerperClientOptions {
  apiKey: string;
  /** 默认 https://google.serper.dev。 */
  baseUrl?: string;
  timeoutMs?: number;
}

export interface SerperSearchParams {
  query: string;
  /** 端点类型，默认 search。 */
  type?: SerperSearchType;
  /** 返回条数（1~100），默认 10。 */
  num?: number;
  /** 页码，默认 1。 */
  page?: number;
  /** 国家，例如 cn、us。 */
  gl?: string;
  /** 语言，例如 zh-cn、en。 */
  hl?: string;
  /** 地理位置。 */
  location?: string;
  /** 时间筛选，Google tbs 参数，例如 qdr:d、qdr:w。 */
  tbs?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SerperAnswerBox {
  title?: string;
  answer?: string;
  snippet?: string;
  link?: string;
}

export interface SerperKnowledgeGraph {
  title?: string;
  description?: string;
  website?: string;
  type?: string;
}

export interface SerperDetailedResult {
  results: SearchResultItem[];
  answerBox?: SerperAnswerBox;
  knowledgeGraph?: SerperKnowledgeGraph;
  relatedSearches: string[];
  /** 剩余额度（若接口返回）。 */
  credits?: number;
  raw: unknown;
}

const DEFAULT_BASE_URL = 'https://google.serper.dev';
const DEFAULT_TIMEOUT_MS = 30_000;

function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function toSerperError(error: unknown): IntegrationError {
  return error instanceof IntegrationError
    ? error
    : new IntegrationError({
        service: 'serper',
        code: 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
        cause: error,
      });
}

export class SerperClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private lastCredits: number | undefined;

  /** 最近一次真实搜索响应里的剩余 credits（Serper 无独立余额接口）。 */
  getLastCredits(): number | undefined { return this.lastCredits; }

  constructor(options: SerperClientOptions) {
    this.apiKey = (options.apiKey ?? '').trim();
    this.baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 调用前校验密钥，未配置时抛出统一的 MISSING_API_KEY。 */
  private requireKey(): string {
    if (!this.apiKey) {
      throw new IntegrationError({
        service: 'serper',
        code: 'MISSING_API_KEY',
        message: '尚未配置 Serper 搜索 API Key，请在设置 → API 密钥中填写',
      });
    }
    return this.apiKey;
  }

  /** 只取结果列表（最常用）。 */
  async search(params: SerperSearchParams): Promise<SearchResultItem[]> {
    const detailed = await this.searchDetailed(params);
    return detailed.results;
  }

  /** Google 新闻。 */
  async news(params: Omit<SerperSearchParams, 'type'>): Promise<SearchResultItem[]> {
    return this.search({ ...params, type: 'news' });
  }

  /** Google 图片（url 为可直接下载的图片地址，source 为来源站点）。 */
  async images(params: Omit<SerperSearchParams, 'type'>): Promise<SearchResultItem[]> {
    return this.search({ ...params, type: 'images' });
  }

  /** 完整结果：包含 answerBox / knowledgeGraph / 相关搜索 / 额度。 */
  async searchDetailed(params: SerperSearchParams): Promise<SerperDetailedResult> {
    this.requireKey();
    const query = (params.query ?? '').trim();
    if (!query) {
      throw new IntegrationError({
        service: 'serper',
        code: 'BAD_REQUEST',
        message: '搜索关键词不能为空',
      });
    }
    const type = params.type ?? 'search';
    const endpoint = type === 'search' ? '/search' : `/${type}`;
    const body: Record<string, unknown> = {
      q: query,
      num: Math.max(1, Math.min(100, params.num ?? 10)),
    };
    if (params.page && params.page > 1) body.page = params.page;
    if (params.gl) body.gl = params.gl;
    if (params.hl) body.hl = params.hl;
    if (params.location) body.location = params.location;
    if (params.tbs) body.tbs = params.tbs;

    try {
      const payload = await httpJson<unknown>(buildUrl(this.baseUrl, endpoint), {
        method: 'POST',
        headers: {
          'X-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        service: 'serper',
        timeoutMs: params.timeoutMs ?? this.timeoutMs,
        signal: params.signal,
      });
      const root = asRecord(payload);
      const results = this.parseResults(root, type);
      const answerBoxRecord = asRecord(root.answerBox);
      const answerBox: SerperAnswerBox | undefined =
        Object.keys(answerBoxRecord).length > 0
          ? {
              title: asString(answerBoxRecord.title),
              answer: asString(answerBoxRecord.answer),
              snippet: asString(answerBoxRecord.snippet),
              link: asString(answerBoxRecord.link),
            }
          : undefined;
      const graphRecord = asRecord(root.knowledgeGraph);
      const knowledgeGraph: SerperKnowledgeGraph | undefined =
        Object.keys(graphRecord).length > 0
          ? {
              title: asString(graphRecord.title),
              description: asString(graphRecord.description),
              website: asString(graphRecord.website),
              type: asString(graphRecord.type),
            }
          : undefined;
      const relatedSearches = asArray(root.relatedSearches)
        .map((item) => {
          const record = asRecord(item);
          return asString(record.query);
        })
        .filter((item): item is string => item !== undefined);
      return {
        results,
        answerBox,
        knowledgeGraph,
        relatedSearches,
        credits: asNumber(root.credits),
        raw: payload,
      };
    } catch (error) {
      throw toSerperError(error);
    }
  }

  private parseResults(
    root: Record<string, unknown>,
    type: SerperSearchType,
  ): SearchResultItem[] {
    if (type === 'images') {
      return asArray(root.images).flatMap((item): SearchResultItem[] => {
        const record = asRecord(item);
        const imageUrl = asString(record.imageUrl);
        const link = asString(record.link);
        if (!imageUrl && !link) return [];
        return [
          {
            title: asString(record.title) ?? '图片结果',
            // 图片结果优先返回可直接下载的图片地址
            url: imageUrl ?? link ?? '',
            snippet: asString(record.snippet) ?? asString(record.source) ?? '',
            source: asString(record.source) ?? hostnameOf(link) ?? hostnameOf(imageUrl),
            date: asString(record.date),
          },
        ];
      });
    }
    if (type === 'news') {
      return asArray(root.news).flatMap((item): SearchResultItem[] => {
        const record = asRecord(item);
        const link = asString(record.link);
        if (!link) return [];
        return [
          {
            title: asString(record.title) ?? '新闻结果',
            url: link,
            snippet: asString(record.snippet) ?? '',
            source: asString(record.source) ?? hostnameOf(link),
            date: asString(record.date),
          },
        ];
      });
    }
    if (type === 'videos') {
      return asArray(root.videos).flatMap((item): SearchResultItem[] => {
        const record = asRecord(item);
        const link = asString(record.link);
        if (!link) return [];
        return [
          {
            title: asString(record.title) ?? '视频结果',
            url: link,
            snippet: asString(record.snippet) ?? asString(record.channel) ?? '',
            source: asString(record.source) ?? hostnameOf(link),
            date: asString(record.date),
          },
        ];
      });
    }
    if (type === 'places') {
      return asArray(root.places).flatMap((item): SearchResultItem[] => {
        const record = asRecord(item);
        const title = asString(record.title);
        if (!title) return [];
        return [
          {
            title,
            url: asString(record.website) ?? asString(record.link) ?? '',
            snippet: asString(record.address) ?? asString(record.category) ?? '',
            source: asString(record.category),
            date: undefined,
          },
        ];
      });
    }
    return asArray(root.organic).flatMap((item): SearchResultItem[] => {
      const record = asRecord(item);
      const link = asString(record.link);
      if (!link) return [];
      return [
        {
          title: asString(record.title) ?? '搜索结果',
          url: link,
          snippet: asString(record.snippet) ?? '',
          source: asString(record.source) ?? hostnameOf(link),
          date: asString(record.date),
        },
      ];
    });
  }

  /**
   * 连通性测试：发送一次最小搜索（会消耗 1 次额度）。
   * 建议仅在设置页手动点击「测试连接」时调用。
   */
  async testConnection(): Promise<ConnectionTestResult> {
    return runConnectionTest('serper', async () => {
      const detailed = await this.searchDetailed({
        query: 'deepseek',
        num: 1,
        signal: AbortSignal.timeout(15_000),
      });
      const creditsText = detailed.credits !== undefined ? `，剩余额度 ${detailed.credits}` : '';
      return `连接正常，返回 ${detailed.results.length} 条结果${creditsText}`;
    });
  }
}
