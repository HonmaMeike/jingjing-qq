/**
 * 表情包库 StickerService。
 *
 * 数据：<dataDir>/stickers.json（{ version:1, seeded:boolean, items:StickerItem[] }，原子写由 JsonStore 负责）
 * 图片：<mediaDir>/stickers（用户上传/生成落盘；内置素材不落盘，URL 为 pet://asset/memes/<fileName>）
 *
 * 能力：
 * - 首次启动扫描 petDir/memes 与 externalPetDir/memes 的内置鲸鱼娘表情包（png/gif/webp），
 *   排除露骨/攻击性文件名；seeded=true 后不再重复，删除后重启不复活。
 * - 用户上传 data URL（png/jpeg/webp/gif，≤8MB）落盘并入库。
 * - 按 mood + 文本关键词 + tags + favorite/whale/使用热度打分挑图，支持概率门限。
 * - 她可以按需/每日限流自主生成新表情包（generateImage 由外部注入，便于测试与替换）。
 * - 所有变更 emit 'stickers:update'（StickerOverview），供渲染进程实时刷新。
 *
 * 安全：所有文件名/路径都限制在 mediaDir 内；id 只用于内存查找，不参与路径拼接。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import type {
  AppSettings,
  Persona,
  StickerItem,
  StickerMood,
  StickerOverview,
  StickerSettings,
} from '../../shared/types';
import { JsonStore } from '../core/json-store';
import { nowIso, resolveInside, uid } from '../core/utils';
import type { EventBus } from '../core/event-bus';

export interface StickerGenerateResult {
  status: 'done' | 'failed';
  urls?: string[];
  error?: string;
}

export interface StickerServiceOptions {
  dataDir: string;
  petDir: string;
  externalPetDir?: string;
  mediaDir: string;
  toMediaUrl: (filePath: string) => string;
  getMediaBaseUrl: () => string;
  getSettings: () => AppSettings;
  saveSettings: (patch: Partial<AppSettings>) => Promise<unknown>;
  events?: EventBus;
  logger?: { warn(scope: string, ...args: unknown[]): void };
  generateImage?: (prompt: string) => Promise<StickerGenerateResult>;
  /** 可选：用多模态模型真实理解表情包图片。 */
  describeImage?: (item: StickerItem) => Promise<string | undefined>;
  getPersona?: () => Persona | undefined;
}

interface StickerData {
  version: number;
  seeded: boolean;
  items: StickerItem[];
}

const STICKER_MOODS: readonly StickerMood[] = [
  'happy', 'sad', 'angry', 'tired', 'shy', 'comfort', 'food',
  'work', 'greeting', 'tease', 'love', 'neutral',
];
const MOOD_SET = new Set<string>(STICKER_MOODS);

const DEFAULT_STICKER_SETTINGS: StickerSettings = {
  enabled: true,
  autoSendInChat: true,
  autoAttachInQzone: true,
  autoCollect: true,
  autoCollectPerDay: 1,
  autoSendChance: 0.22,
  qzoneChance: 0.65,
};

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_TAGS = 12;
const MAX_TAG_LENGTH = 24;
const MAX_NAME_LENGTH = 40;
const RECENT_USE_WINDOW_MS = 30 * 60_000;
const AUTO_COLLECT_GAP_MS = 6 * 60 * 60_000;

/** 露骨/攻击性文件名（按去扩展名后的文件名包含匹配），内置素材不收录。 */
const EXCLUDED_NAME_KEYWORDS: readonly string[] = [
  '大烧货',
  '就骚了怎么滴吧',
  '除了调情没啥用',
  '电死你',
  '裸',
  '色情',
  '黄片',
  '强奸',
  '傻逼',
  '去死',
  '操你',
  '滚你',
];

interface SeedRule {
  keywords: string[];
  moods: StickerMood[];
  tags: string[];
}

/** 文件名 → 标签/心情映射表（从文件名推断。按顺序命中第一条）。 */
const SEED_RULES: readonly SeedRule[] = [
  { keywords: ['ciallo'], moods: ['greeting', 'tease', 'happy'], tags: ['Ciallo', '打招呼', '俏皮'] },
  { keywords: ['token'], moods: ['work', 'tease'], tags: ['token', '摸鱼', '工作'] },
  { keywords: ['多模态'], moods: ['work', 'neutral'], tags: ['多模态', '学习'] },
  { keywords: ['先养着'], moods: ['comfort', 'tease'], tags: ['先养着', '养鱼'] },
  { keywords: ['厉害'], moods: ['happy', 'tease'], tags: ['厉害', '夸奖', '得意'] },
  { keywords: ['压力'], moods: ['tired', 'comfort'], tags: ['压力', '累了', '安慰'] },
  { keywords: ['可爱'], moods: ['happy', 'love', 'shy'], tags: ['可爱', '卖萌'] },
  { keywords: ['白饭'], moods: ['food', 'tired'], tags: ['白饭', '吃饭', '摸鱼'] },
  { keywords: ['吃饱'], moods: ['food', 'happy'], tags: ['吃饱', '吃饭', '满足'] },
  { keywords: ['哦鲸鲸'], moods: ['greeting', 'tease'], tags: ['哦鲸鲸', '打招呼'] },
  { keywords: ['病毒'], moods: ['angry', 'work'], tags: ['病毒', '电脑', '工作'] },
  { keywords: ['大师'], moods: ['neutral', 'work'], tags: ['大师', '疑惑', '游戏'] },
  { keywords: ['大的药'], moods: ['tease', 'happy'], tags: ['大的药', '梗'] },
  { keywords: ['大的要'], moods: ['tease', 'happy'], tags: ['大的要来啦', '预告', '梗'] },
  { keywords: ['完蛋'], moods: ['sad', 'angry'], tags: ['完蛋', '翻车'] },
  { keywords: ['就一碗'], moods: ['food'], tags: ['一碗', '吃饭'] },
  { keywords: ['更新'], moods: ['work', 'angry'], tags: ['更新', '开源', '工作'] },
  { keywords: ['死掉'], moods: ['tired', 'sad'], tags: ['死掉', '累瘫'] },
  { keywords: ['睡眠'], moods: ['tired'], tags: ['睡眠', '困', '休息'] },
  { keywords: ['骂'], moods: ['angry'], tags: ['骂人', '生气'] },
  { keywords: ['开源'], moods: ['work', 'happy'], tags: ['开源', '代码', '工作'] },
  { keywords: ['资源'], moods: ['work', 'tease'], tags: ['资源', '摸鱼'] },
  { keywords: ['黎曼'], moods: ['work', 'neutral'], tags: ['黎曼', '数学', '学习'] },
  { keywords: ['黄油'], moods: ['sad', 'angry'], tags: ['黄油', '翻车'] },
];

/** 中文情绪/场景词 → StickerMood（pick 的 mood 入参与文本关键词共用）。 */
const MOOD_ALIAS_LIST: ReadonlyArray<readonly [string, StickerMood]> = [
  ['happy', 'happy'], ['开心', 'happy'], ['高兴', 'happy'], ['快乐', 'happy'], ['元气', 'happy'],
  ['sad', 'sad'], ['难过', 'sad'], ['伤心', 'sad'], ['委屈', 'sad'],
  ['angry', 'angry'], ['生气', 'angry'], ['愤怒', 'angry'], ['火大', 'angry'],
  ['tired', 'tired'], ['困了', 'tired'], ['好困', 'tired'], ['疲惫', 'tired'], ['累了', 'tired'], ['晚安', 'tired'],
  ['shy', 'shy'], ['害羞', 'shy'], ['脸红', 'shy'],
  ['comfort', 'comfort'], ['安慰', 'comfort'], ['抱抱', 'comfort'], ['温柔', 'comfort'],
  ['food', 'food'], ['饿了', 'food'], ['好饿', 'food'], ['吃饭', 'food'], ['白饭', 'food'], ['好吃', 'food'],
  ['work', 'work'], ['工作', 'work'], ['代码', 'work'], ['更新', 'work'], ['学习', 'work'], ['上班', 'work'], ['摸鱼', 'work'],
  ['greeting', 'greeting'], ['打招呼', 'greeting'], ['你好', 'greeting'], ['早安', 'greeting'], ['嗨', 'greeting'],
  ['tease', 'tease'], ['得意', 'tease'], ['傲娇', 'tease'], ['俏皮', 'tease'], ['调皮', 'tease'],
  ['love', 'love'], ['喜欢', 'love'], ['爱你', 'love'],
  ['neutral', 'neutral'], ['无奈', 'neutral'], ['无语', 'neutral'], ['平静', 'neutral'],
];

/** 允许单字出现在文本中的情绪词（避免「早」「吃」这类过宽匹配）。 */
const SINGLE_CHAR_MOODS: ReadonlyArray<readonly [string, StickerMood]> = [
  ['困', 'tired'], ['累', 'tired'], ['饿', 'food'], ['哭', 'sad'], ['烦', 'angry'], ['睡', 'tired'], ['吃', 'food'],
];

const MOOD_ALIASES = new Map<string, StickerMood>();
for (const [alias, mood] of MOOD_ALIAS_LIST) MOOD_ALIASES.set(alias.toLowerCase(), mood);
for (const [alias, mood] of SINGLE_CHAR_MOODS) MOOD_ALIASES.set(alias.toLowerCase(), mood);

/** 即兴生成时的表情描述（随机取一个，避免每次生成同一个表情）。 */
const GENERATED_EXPRESSIONS: ReadonlyArray<{ text: string; moods: StickerMood[]; tag: string }> = [
  { text: '开心大笑，尾巴甩出小水花', moods: ['happy'], tag: '开心' },
  { text: '得意地挑眉、竖起大拇指', moods: ['tease', 'happy'], tag: '得意' },
  { text: '困得打哈欠、抱着小枕头', moods: ['tired'], tag: '困倦' },
  { text: '害羞捂脸、气泡飘成小爱心', moods: ['shy', 'love'], tag: '害羞' },
  { text: '生气鼓腮、头顶冒小蒸汽', moods: ['angry'], tag: '生气' },
  { text: '吃饱摸肚子、一脸满足', moods: ['food', 'happy'], tag: '吃饱' },
  { text: '无奈摊手、尾巴耷拉下来', moods: ['neutral'], tag: '无奈' },
  { text: '挥鳍打招呼、笑容明亮', moods: ['greeting', 'happy'], tag: '打招呼' },
];

function hashOf(value: string): string {
  return crypto.createHash('sha1').update(value, 'utf8').digest('hex').slice(0, 10);
}

function localDayKey(iso: string | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function todayKey(): string {
  return localDayKey(nowIso());
}

function uniqueStrings(values: readonly string[], max = MAX_TAGS): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? '').trim().slice(0, MAX_TAG_LENGTH);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeMoods(values: readonly string[] | undefined): StickerMood[] {
  const out: StickerMood[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    const mood = String(value ?? '').trim().toLowerCase();
    if (!MOOD_SET.has(mood) || seen.has(mood)) continue;
    seen.add(mood);
    out.push(mood as StickerMood);
  }
  return out;
}

function defaultName(): string {
  return `我的收藏 ${new Date().toISOString().slice(0, 10)}`;
}

function mimeToExtension(mime: string): string {
  const normalized = mime.toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg';
  if (normalized === 'image/webp') return 'webp';
  if (normalized === 'image/gif') return 'gif';
  return 'png';
}

function sniffImageMime(buffer: Buffer): string | undefined {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF87a') return 'image/gif';
  if (buffer.length >= 6 && buffer.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

/** 读取常见图片格式的宽高（解析失败返回 undefined）。 */
function readImageSize(buffer: Buffer, mime: string): { width?: number; height?: number } {
  try {
    if (mime === 'image/png' && buffer.length >= 24) {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === 'image/gif' && buffer.length >= 10) {
      return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
    }
    if (mime === 'image/jpeg' && buffer.length >= 4) {
      let offset = 2;
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) { offset += 1; continue; }
        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);
        if (marker !== undefined && marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
        }
        offset += 2 + Math.max(1, length);
      }
      return {};
    }
    if (mime === 'image/webp' && buffer.length >= 30) {
      const chunk = buffer.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8X' && buffer.length >= 30) {
        return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
      }
      if (chunk === 'VP8 ' && buffer.length >= 30) {
        return {
          width: buffer.readUInt16LE(26) & 0x3fff,
          height: buffer.readUInt16LE(28) & 0x3fff,
        };
      }
      if (chunk === 'VP8L' && buffer.length >= 25) {
        const bits = buffer.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    // 忽略解析失败，宽高留空
  }
  return {};
}

interface SeedCandidate {
  fileName: string;
  url: string;
  name: string;
  tags: string[];
  moods: StickerMood[];
}

function inferSeedMeta(fileName: string): { tags: string[]; moods: StickerMood[] } {
  const baseName = fileName.replace(/\.(png|gif|webp)$/i, '');
  const lower = baseName.toLowerCase();
  for (const rule of SEED_RULES) {
    if (rule.keywords.some((keyword) => lower.includes(keyword.toLowerCase()))) {
      return { tags: uniqueStrings(rule.tags), moods: normalizeMoods(rule.moods) };
    }
  }
  return { tags: ['梗图'], moods: ['neutral'] };
}

function isExcludedSeedFile(fileName: string): boolean {
  const baseName = fileName.replace(/\.(png|gif|webp)$/i, '');
  return EXCLUDED_NAME_KEYWORDS.some((keyword) => baseName.includes(keyword));
}

export class StickerService {
  private readonly store: JsonStore<StickerData>;
  private readonly stickersDir: string;
  /** 本进程内最近一次自动收集尝试时间（失败也计入，避免频繁打模型）。 */
  private lastCollectAttemptAt?: string;

  private constructor(
    private readonly options: StickerServiceOptions,
    store: JsonStore<StickerData>,
    stickersDir: string,
  ) {
    this.store = store;
    this.stickersDir = stickersDir;
  }

  static async create(options: StickerServiceOptions): Promise<StickerService> {
    const store = await JsonStore.open<StickerData>(
      path.join(options.dataDir, 'stickers.json'),
      { version: 1, seeded: false, items: [] },
    );
    const stickersDir = path.join(path.resolve(options.mediaDir), 'stickers');
    await fs.mkdir(stickersDir, { recursive: true });
    const service = new StickerService(options, store, path.resolve(stickersDir));
    await service.seedIfNeeded();
    return service;
  }

  // ---------------- 基础查询 ----------------

  private data(): StickerData {
    return this.store.get();
  }

  private settings(): StickerSettings {
    const fromApp = this.options.getSettings()?.stickers;
    return { ...DEFAULT_STICKER_SETTINGS, ...(fromApp ?? {}) };
  }

  list(): StickerItem[] {
    return this.data().items.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  overview(): StickerOverview {
    const items = this.list();
    const settings = this.settings();
    const today = todayKey();
    const generatedItems = items.filter((item) => item.source === 'generated');
    const tags = uniqueStrings(items.flatMap((item) => item.tags), 60);
    return {
      items,
      total: items.length,
      favorites: items.filter((item) => item.favorite).length,
      generated: generatedItems.length,
      tags,
      lastCollectedAt: generatedItems
        .map((item) => item.createdAt)
        .sort((a, b) => b.localeCompare(a))[0],
      todayGenerated: generatedItems.filter((item) => localDayKey(item.createdAt) === today).length,
      autoCollect: settings.autoCollect,
    };
  }

  private emit(): void {
    this.options.events?.emit('stickers:update', this.overview());
  }

  private async mutate(mutator: (draft: StickerData) => void): Promise<void> {
    await this.store.update((draft) => {
      mutator(draft);
    });
    this.emit();
  }

  private find(id: string): { items: StickerItem[]; index: number; item: StickerItem } | undefined {
    const items = this.data().items;
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) return undefined;
    return { items, index, item: items[index] };
  }

  // ---------------- 内置种子 ----------------

  private async seedIfNeeded(): Promise<void> {
    if (this.data().seeded) return;
    const candidates = await this.scanBuiltinCandidates();
    await this.mutate((draft) => {
      if (draft.seeded) return;
      const existingUrls = new Set(draft.items.map((item) => item.url));
      for (const candidate of candidates) {
        if (existingUrls.has(candidate.url)) continue;
        existingUrls.add(candidate.url);
        draft.items.push({
          id: `sticker-builtin-${hashOf(candidate.fileName)}`,
          name: candidate.name,
          url: candidate.url,
          source: 'builtin',
          tags: candidate.tags,
          moods: candidate.moods,
          description: `鲸鱼娘表情包：${candidate.name}`,
          favorite: false,
          enabled: true,
          whale: true,
          createdAt: nowIso(),
          useCount: 0,
        });
      }
      draft.seeded = true;
    });
  }

  private async scanBuiltinCandidates(): Promise<SeedCandidate[]> {
    const roots = [this.options.petDir, this.options.externalPetDir].filter(
      (dir): dir is string => typeof dir === 'string' && dir.trim().length > 0,
    );
    const seen = new Set<string>();
    const candidates: SeedCandidate[] = [];
    for (const root of roots) {
      const memesDir = path.join(root, 'memes');
      let entries: Dirent[] = [];
      try {
        entries = await fs.readdir(memesDir, { withFileTypes: true });
      } catch {
        continue; // 目录不存在时跳过
      }
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const fileName = entry.name;
        if (!/\.(png|gif|webp)$/i.test(fileName)) continue;
        const dedupeKey = fileName.toLowerCase();
        if (seen.has(dedupeKey)) continue;
        if (isExcludedSeedFile(fileName)) continue;
        seen.add(dedupeKey);
        const meta = inferSeedMeta(fileName);
        candidates.push({
          fileName,
          url: `pet://asset/memes/${encodeURIComponent(fileName)}`,
          name: fileName.replace(/\.(png|gif|webp)$/i, ''),
          tags: meta.tags,
          moods: meta.moods,
        });
      }
    }
    return candidates;
  }

  // ---------------- 用户上传 / 编辑 ----------------

  async saveDataUrl(input: {
    dataUrl: string;
    name?: string;
    tags?: string[];
    moods?: StickerMood[];
    favorite?: boolean;
  }): Promise<StickerItem> {
    const parsed = this.parseDataUrl(input.dataUrl);
    const fileName = `sticker_${uid()}.${mimeToExtension(parsed.mime)}`;
    const filePath = resolveInside(this.stickersDir, fileName);
    await fs.writeFile(filePath, parsed.buffer);
    const item: StickerItem = {
      id: `sticker-${uid()}`,
      name: (input.name ?? '').trim().slice(0, MAX_NAME_LENGTH) || defaultName(),
      url: this.options.toMediaUrl(filePath),
      file: filePath,
      source: 'saved',
      tags: uniqueStrings(input.tags ?? []),
      moods: normalizeMoods(input.moods),
      favorite: input.favorite === true,
      enabled: true,
      whale: false,
      createdAt: nowIso(),
      useCount: 0,
      width: parsed.width,
      height: parsed.height,
    };
    await this.mutate((draft) => {
      draft.items.push(item);
    });
    return item;
  }

  private parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer; width?: number; height?: number } {
    const raw = String(dataUrl ?? '').trim();
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/=\s]+)$/i.exec(raw);
    if (!match) throw new Error('仅支持 data:image/(png|jpeg|webp|gif);base64 格式的图片');
    const rawMime = match[1].toLowerCase();
    const mime = rawMime === 'jpg' || rawMime === 'jpeg' ? 'image/jpeg' : `image/${rawMime}`;
    const base64 = match[2].replace(/\s+/g, '');
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.byteLength === 0) throw new Error('图片数据为空');
    if (buffer.byteLength > MAX_UPLOAD_BYTES) {
      throw new Error(`图片过大（${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB），上限 8MB`);
    }
    const sniffed = sniffImageMime(buffer);
    if (!sniffed) throw new Error('无法识别的图片数据');
    if (sniffed !== mime) throw new Error('图片数据与声明格式不符');
    const size = readImageSize(buffer, sniffed);
    return { mime: sniffed, buffer, ...size };
  }

  async update(
    id: string,
    patch: Partial<Pick<StickerItem, 'name' | 'favorite' | 'enabled' | 'tags' | 'moods' | 'description'>>,
  ): Promise<StickerItem | null> {
    const found = this.find(id);
    if (!found) return null;
    let updated: StickerItem | undefined;
    await this.mutate((draft) => {
      const index = draft.items.findIndex((item) => item.id === id);
      if (index < 0) return;
      const item = draft.items[index];
      const next: StickerItem = { ...item };
      if (patch.name !== undefined) {
        const name = String(patch.name).trim().slice(0, MAX_NAME_LENGTH);
        if (name) next.name = name;
      }
      if (patch.favorite !== undefined) next.favorite = patch.favorite === true;
      if (patch.enabled !== undefined) next.enabled = patch.enabled !== false;
      if (patch.tags !== undefined) next.tags = uniqueStrings(patch.tags);
      if (patch.moods !== undefined) next.moods = normalizeMoods(patch.moods);
      if (patch.description !== undefined) {
        const description = String(patch.description).trim().slice(0, 200);
        if (description) next.description = description;
        else delete next.description;
      }
      draft.items[index] = next;
      updated = next;
    });
    return updated ?? null;
  }

  async remove(id: string): Promise<boolean> {
    const found = this.find(id);
    if (!found) return false;
    await this.mutate((draft) => {
      draft.items = draft.items.filter((item) => item.id !== id);
    });
    if (found.item.file) {
      try {
        const target = resolveInside(this.stickersDir, path.basename(found.item.file));
        await fs.unlink(target);
      } catch {
        // 文件不存在或越界时忽略
      }
    }
    return true;
  }

  // ---------------- 选择与使用 ----------------


  /** 先让多模态真正理解选中的表情，再决定是否发送；描述会缓存，避免重复调用。 */
  async pickUnderstood(input: { text?: string; mood?: string; scene?: 'private' | 'group' | 'qzone'; personaId?: string; chance?: number }): Promise<StickerItem | undefined> {
    const item = this.pick(input);
    if (!item) return undefined;
    if (item.description && !/鲸鱼娘表情包|她即兴生成|我的收藏/.test(item.description)) return item;
    const described = await this.options.describeImage?.(item).catch(() => undefined);
    if (!described) return item;
    const text = described.slice(0, 200);
    if (/色情|裸露|血腥|暴力|政治敏感|辱骂/.test(text)) return undefined;
    const updated = await this.update(item.id, { description: text }).catch(() => null);
    return updated ?? { ...item, description: text };
  }

  pick(input: {
    text?: string;
    mood?: string;
    scene?: 'private' | 'group' | 'qzone';
    personaId?: string;
    chance?: number;
  }): StickerItem | undefined {
    if (input.chance !== undefined) {
      if (!Number.isFinite(input.chance) || input.chance <= 0) return undefined;
      if (input.chance < 1 && Math.random() > input.chance) return undefined;
    }
    const enabled = this.data().items.filter((item) => item.enabled);
    if (enabled.length === 0) return undefined;
    const cue = this.buildCue(input.mood, input.text);
    const now = Date.now();
    const fresh = enabled.filter((item) => {
      if (!item.lastUsedAt) return true;
      const usedAt = Date.parse(item.lastUsedAt);
      return Number.isNaN(usedAt) || now - usedAt > RECENT_USE_WINDOW_MS;
    });
    const pool = fresh.length > 0 ? fresh : enabled;
    let best: StickerItem | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const item of pool) {
      const score = this.scoreItem(item, cue, input.scene) + Math.random() * 0.8;
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  private buildCue(mood: string | undefined, text: string | undefined): {
    moods: Set<StickerMood>;
    keywords: string[];
    textLower: string;
  } {
    const moods = new Set<StickerMood>();
    const keywords: string[] = [];
    const addCue = (raw: string | undefined): void => {
      const value = (raw ?? '').trim();
      if (!value) return;
      const mapped = MOOD_ALIASES.get(value.toLowerCase());
      if (mapped) moods.add(mapped);
      keywords.push(value.toLowerCase());
    };
    addCue(mood);
    const textLower = (text ?? '').toLowerCase();
    if (textLower) {
      for (const [alias, target] of MOOD_ALIASES) {
        if ((alias.length >= 2 || SINGLE_CHAR_MOODS.some(([single]) => single === alias)) && textLower.includes(alias)) {
          moods.add(target);
          keywords.push(alias);
        }
      }
      keywords.push(...textLower.split(/[\s，,。！!？?；;、~～…（）()\[\]【】]+/).filter((word) => word.length >= 2).slice(0, 20));
    }
    return {
      moods,
      keywords: uniqueStrings(keywords, 30).map((word) => word.toLowerCase()),
      textLower,
    };
  }

  private scoreItem(
    item: StickerItem,
    cue: { moods: Set<StickerMood>; keywords: string[]; textLower: string },
    scene: 'private' | 'group' | 'qzone' | undefined,
  ): number {
    let score = 0;
    for (const mood of cue.moods) {
      if (item.moods.includes(mood)) score += 6;
    }
    const name = item.name.toLowerCase();
    const description = (item.description ?? '').toLowerCase();
    for (const keyword of cue.keywords) {
      if (name.includes(keyword) || description.includes(keyword)) score += 2;
      let tagScore = 0;
      for (const tag of item.tags) {
        if (tag.toLowerCase() === keyword) tagScore = Math.max(tagScore, 3);
        else if (tag.toLowerCase().includes(keyword) || keyword.includes(tag.toLowerCase())) tagScore = Math.max(tagScore, 1.5);
      }
      score += tagScore;
    }
    // 原句里直接出现某张图的标签时也加分（如「今天好困」匹配「睡眠/困」标签）。
    if (cue.textLower) {
      for (const tag of item.tags) {
        const tagLower = tag.toLowerCase();
        if (tagLower.length >= 2 && cue.textLower.includes(tagLower)) score += 2;
      }
    }
    if (item.favorite) score += 1.5;
    if (item.whale) score += 0.8;
    // 使用热度：用过的稍微降低，避免总是同一张。
    score -= Math.min(3, item.useCount * 0.4);
    if (item.lastUsedAt && Date.now() - Date.parse(item.lastUsedAt) < RECENT_USE_WINDOW_MS) score -= 1;
    if (scene === 'qzone') {
      if (item.moods.includes('happy') || item.moods.includes('love')) score += 0.4;
    } else if (scene === 'private') {
      if (item.moods.includes('love') || item.moods.includes('shy')) score += 0.3;
    }
    return score;
  }

  async markUsed(id: string): Promise<void> {
    const found = this.find(id);
    if (!found) return;
    const now = nowIso();
    await this.mutate((draft) => {
      const item = draft.items.find((entry) => entry.id === id);
      if (!item) return;
      item.useCount = (item.useCount ?? 0) + 1;
      item.lastUsedAt = now;
    });
  }

  // ---------------- 自主收集 ----------------

  async collectNow(): Promise<StickerItem | null> {
    const generate = this.options.generateImage;
    if (!generate) return null;

    const personaName = this.options.getPersona?.()?.name?.trim() || '鲸鱼娘';
    const expression = GENERATED_EXPRESSIONS[Math.floor(Math.random() * GENERATED_EXPRESSIONS.length)];
    const prompt =
      `${personaName}的 Q 版鲸鱼娘表情包：${expression.text}。` +
      'Q 版卡通插画风格，夸张可爱的表情，纯色或透明背景，正方形 1:1 构图，角色居中、线条干净，无文字、无水印、无边框。';

    let result: StickerGenerateResult;
    try {
      result = await generate(prompt);
    } catch (error) {
      this.options.logger?.warn('stickers', '自主生成表情包失败:', (error as Error)?.message ?? error);
      return null;
    }
    const url = result?.status === 'done' ? result.urls?.[0] : undefined;
    if (!url) {
      this.options.logger?.warn('stickers', '自主生成表情包失败:', result?.error ?? '未返回图片');
      return null;
    }
    if (this.data().items.some((item) => item.url === url)) return null;

    const item: StickerItem = {
      id: `sticker-gen-${uid()}`,
      name: `即兴表情 ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      url: this.normalizeGeneratedUrl(url),
      source: 'generated',
      tags: uniqueStrings(['即兴', '表情包', expression.tag]),
      moods: normalizeMoods(expression.moods),
      description: '她即兴生成的表情包',
      favorite: false,
      enabled: true,
      whale: true,
      createdAt: nowIso(),
      useCount: 0,
    };
    await this.mutate((draft) => {
      draft.items.push(item);
    });
    return item;
  }

  private normalizeGeneratedUrl(url: string): string {
    const value = url.trim();
    if (/^(https?|data|pet|media):/i.test(value)) return value;
    // 生成器如果返回本地绝对路径，转成可访问的媒体 URL。
    try {
      const resolved = path.resolve(value);
      const rel = path.relative(path.resolve(this.options.mediaDir), resolved);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return this.options.toMediaUrl(resolved);
      const base = this.options.getMediaBaseUrl();
      if (base && rel && !rel.startsWith('..')) return `${base}/media/${rel.split(path.sep).map(encodeURIComponent).join('/')}`;
    } catch {
      // 忽略非法路径
    }
    return value;
  }

  async autoCollectIfDue(): Promise<StickerItem | null> {
    const settings = this.settings();
    if (!settings.autoCollect) return null;
    const perDay = Math.max(0, Math.floor(settings.autoCollectPerDay ?? 0));
    if (perDay <= 0) return null;

    const now = Date.now();
    const generated = this.data().items.filter((item) => item.source === 'generated');
    const today = todayKey();
    const todayGenerated = generated.filter((item) => localDayKey(item.createdAt) === today).length;
    if (todayGenerated >= perDay) return null;

    const lastGeneratedAt = generated
      .map((item) => item.createdAt)
      .sort((a, b) => b.localeCompare(a))[0];
    const attempts = [lastGeneratedAt, this.lastCollectAttemptAt]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => Date.parse(value))
      .filter((value) => !Number.isNaN(value));
    if (attempts.length > 0 && now - Math.max(...attempts) < AUTO_COLLECT_GAP_MS) return null;

    this.lastCollectAttemptAt = nowIso();
    return this.collectNow();
  }

  // ---------------- 设置 ----------------

  async setSettings(patch: Partial<StickerSettings>): Promise<StickerSettings> {
    const current = this.settings();
    const merged: StickerSettings = { ...current };
    if (patch.enabled !== undefined) merged.enabled = patch.enabled === true;
    if (patch.autoSendInChat !== undefined) merged.autoSendInChat = patch.autoSendInChat === true;
    if (patch.autoAttachInQzone !== undefined) merged.autoAttachInQzone = patch.autoAttachInQzone === true;
    if (patch.autoCollect !== undefined) merged.autoCollect = patch.autoCollect === true;
    if (patch.autoCollectPerDay !== undefined) {
      const value = Number(patch.autoCollectPerDay);
      merged.autoCollectPerDay = Number.isFinite(value) ? Math.max(0, Math.min(20, Math.round(value))) : current.autoCollectPerDay;
    }
    if (patch.autoSendChance !== undefined) {
      const value = Number(patch.autoSendChance);
      merged.autoSendChance = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : current.autoSendChance;
    }
    if (patch.qzoneChance !== undefined) {
      const value = Number(patch.qzoneChance);
      merged.qzoneChance = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : current.qzoneChance;
    }
    await this.options.saveSettings({ stickers: merged });
    this.emit();
    return merged;
  }
}
