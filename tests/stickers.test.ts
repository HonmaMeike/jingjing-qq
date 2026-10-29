import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AppSettings, StickerOverview, StickerSettings } from '../shared/types';
import { EventBus } from '../electron/core/event-bus';
import { StickerService, type StickerGenerateResult, type StickerServiceOptions } from '../electron/services/stickers';

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_BYTES = Buffer.from(PNG_1X1_BASE64, 'base64');
const PNG_DATA_URL = 'data:image/png;base64,' + PNG_1X1_BASE64;

let root = '';
let dataDir = '';
let mediaDir = '';
let petDir = '';
let externalPetDir = '';
let settings: AppSettings;
let saveSettingsCalls: Partial<AppSettings>[];
let events: EventBus;
let updates: StickerOverview[];
let logger: { warn: ReturnType<typeof vi.fn> };

function makeSettings(stickers: Partial<StickerSettings> = {}): AppSettings {
  return {
    stickers: {
      enabled: true,
      autoSendInChat: true,
      autoAttachInQzone: true,
      autoCollect: true,
      autoCollectPerDay: 1,
      autoSendChance: 0.22,
      qzoneChance: 0.65,
      ...stickers,
    },
  } as unknown as AppSettings;
}

function baseOptions(overrides: Partial<StickerServiceOptions> = {}): StickerServiceOptions {
  return {
    dataDir,
    petDir,
    externalPetDir,
    mediaDir,
    toMediaUrl: (filePath) =>
      'media://asset/' + path.relative(mediaDir, filePath).split(path.sep).join('/'),
    getMediaBaseUrl: () => 'http://127.0.0.1:47821',
    getSettings: () => settings,
    saveSettings: async (patch) => {
      saveSettingsCalls.push(patch);
      if (patch.stickers) settings = { ...settings, stickers: { ...settings.stickers, ...patch.stickers } };
      return settings;
    },
    events,
    logger,
    ...overrides,
  };
}

async function writeMeme(dir: string, name: string): Promise<void> {
  await fs.writeFile(path.join(dir, 'memes', name), PNG_BYTES);
}

const SEED_COUNT = 3; // 可爱 / 深度睡眠 / 厉害了我的鲸（大烧货、电死你 被排除，可爱 跨目录去重）

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'jingjing-stickers-'));
  dataDir = path.join(root, 'data');
  mediaDir = path.join(root, 'media');
  petDir = path.join(root, 'pet');
  externalPetDir = path.join(root, 'external-pet');
  await fs.mkdir(path.join(petDir, 'memes'), { recursive: true });
  await fs.mkdir(path.join(externalPetDir, 'memes'), { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });
  await writeMeme(petDir, '可爱.png');
  await writeMeme(petDir, '深度睡眠.png');
  await writeMeme(petDir, '大烧货.png');
  await writeMeme(petDir, '电死你.png');
  await writeMeme(externalPetDir, '可爱.png'); // 跨目录同名，应去重
  await writeMeme(externalPetDir, '厉害了我的鲸.png');

  settings = makeSettings();
  saveSettingsCalls = [];
  events = new EventBus();
  updates = [];
  events.on('stickers:update', (payload) => updates.push(payload as StickerOverview));
  logger = { warn: vi.fn() };
});

afterEach(async () => {
  events.removeAll();
  await fs.rm(root, { recursive: true, force: true });
});

describe('内置种子', () => {
  it('首次扫描内置表情包：去重、排除敏感文件名、URL/字段正确', async () => {
    const service = await StickerService.create(baseOptions());
    const overview = service.overview();

    expect(overview.total).toBe(SEED_COUNT);
    const names = overview.items.map((item) => item.name).sort();
    expect(names).toEqual(['可爱', '深度睡眠', '厉害了我的鲸'].sort());
    expect(overview.items.filter((item) => item.name === '可爱')).toHaveLength(1);
    expect(overview.items.some((item) => item.name.includes('大烧货'))).toBe(false);
    expect(overview.items.some((item) => item.name.includes('电死你'))).toBe(false);

    for (const item of overview.items) {
      expect(item.source).toBe('builtin');
      expect(item.whale).toBe(true);
      expect(item.enabled).toBe(true);
      expect(item.favorite).toBe(false);
      expect(item.useCount).toBe(0);
      expect(item.url.startsWith('pet://asset/memes/')).toBe(true);
      expect(item.url).toBe('pet://asset/memes/' + encodeURIComponent(item.name + '.png'));
      expect(item.tags.length).toBeGreaterThan(0);
      expect(item.moods.length).toBeGreaterThan(0);
      expect(Number.isNaN(Date.parse(item.createdAt))).toBe(false);
    }

    const cute = overview.items.find((item) => item.name === '可爱');
    expect(cute?.tags).toContain('可爱');
    expect(cute?.moods).toContain('happy');
    const sleepy = overview.items.find((item) => item.name === '深度睡眠');
    expect(sleepy?.moods).toContain('tired');
    expect(sleepy?.tags).toContain('睡眠');
  });

  it('seeded 落盘后重开不重复播种', async () => {
    const service = await StickerService.create(baseOptions());
    const ids = service.list().map((item) => item.id).sort();

    const reopened = await StickerService.create(baseOptions());
    expect(reopened.overview().total).toBe(SEED_COUNT);
    expect(reopened.list().map((item) => item.id).sort()).toEqual(ids);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1].total).toBe(SEED_COUNT);

    const raw = JSON.parse(await fs.readFile(path.join(dataDir, 'stickers.json'), 'utf8'));
    expect(raw.version).toBe(1);
    expect(raw.seeded).toBe(true);
    expect(Array.isArray(raw.items)).toBe(true);
  });

  it('删除内置表情后重启不复活', async () => {
    const service = await StickerService.create(baseOptions());
    const cute = service.list().find((item) => item.name === '可爱');
    expect(cute).toBeTruthy();

    expect(await service.remove(cute!.id)).toBe(true);
    expect(service.overview().total).toBe(SEED_COUNT - 1);

    const reopened = await StickerService.create(baseOptions());
    expect(reopened.overview().total).toBe(SEED_COUNT - 1);
    expect(reopened.list().some((item) => item.name === '可爱')).toBe(false);
  });
});

describe('用户上传与编辑', () => {
  it('saveDataUrl 落盘、URL、默认名称、宽高与持久化', async () => {
    const service = await StickerService.create(baseOptions());

    const item = await service.saveDataUrl({
      dataUrl: PNG_DATA_URL,
      tags: [' 测试 ', '测试', '表情'],
      moods: ['happy', 'happy', 'bogus'] as never,
      favorite: true,
    });

    expect(item.source).toBe('saved');
    expect(item.whale).toBe(false);
    expect(item.enabled).toBe(true);
    expect(item.favorite).toBe(true);
    expect(item.tags).toEqual(['测试', '表情']);
    expect(item.moods).toEqual(['happy']);
    expect(item.name).toMatch(/^我的收藏 /);
    expect(item.width).toBe(1);
    expect(item.height).toBe(1);
    expect(item.file).toBeTruthy();
    expect(path.dirname(item.file as string)).toBe(path.join(mediaDir, 'stickers'));
    expect(item.url).toBe(
      'media://asset/' + path.relative(mediaDir, item.file as string).split(path.sep).join('/'),
    );
    const stat = await fs.stat(item.file as string);
    expect(stat.size).toBe(PNG_BYTES.length);
    expect(service.overview().total).toBe(SEED_COUNT + 1);

    const reopened = await StickerService.create(baseOptions());
    expect(reopened.list().some((entry) => entry.id === item.id)).toBe(true);
  });

  it('saveDataUrl 支持自定义名称，并拒绝非图片/格式不符的数据', async () => {
    const service = await StickerService.create(baseOptions());
    const item = await service.saveDataUrl({ dataUrl: PNG_DATA_URL, name: '自定义名字' });
    expect(item.name).toBe('自定义名字');

    await expect(service.saveDataUrl({ dataUrl: 'data:text/plain;base64,aGk=' })).rejects.toThrow(
      /仅支持 data:image/,
    );
    await expect(service.saveDataUrl({ dataUrl: 'data:image/png;base64,////' })).rejects.toThrow(
      /无法识别的图片数据/,
    );
    await expect(service.saveDataUrl({ dataUrl: 'not-a-data-url' })).rejects.toThrow();
  });

  it('update 修改 favorite/name/tags/moods/description，未知 id 返回 null', async () => {
    const service = await StickerService.create(baseOptions());
    const item = await service.saveDataUrl({ dataUrl: PNG_DATA_URL });

    const updated = await service.update(item.id, {
      name: '  改个名  ',
      favorite: true,
      tags: ['a', 'A', 'b', ''],
      moods: ['shy', 'nope'] as never,
      description: '这是描述',
    });
    expect(updated).not.toBeNull();
    expect(updated?.name).toBe('改个名');
    expect(updated?.favorite).toBe(true);
    expect(updated?.tags).toEqual(['a', 'b']);
    expect(updated?.moods).toEqual(['shy']);
    expect(updated?.description).toBe('这是描述');

    expect(await service.update('missing-id', { favorite: true })).toBeNull();
    expect(await service.update('../../etc/passwd', { favorite: true })).toBeNull();
  });

  it('remove 删除条目与文件，重复删除返回 false，未知 id 安全失败', async () => {
    const service = await StickerService.create(baseOptions());
    const item = await service.saveDataUrl({ dataUrl: PNG_DATA_URL });

    expect(await service.remove(item.id)).toBe(true);
    await expect(fs.stat(item.file as string)).rejects.toThrow();
    expect(service.overview().total).toBe(SEED_COUNT);
    expect(await service.remove(item.id)).toBe(false);
    expect(await service.remove('../outside')).toBe(false);
  });
});

describe('选择与使用', () => {
  it('pick 按 mood / 文本关键词 / tags 命中，disabled 不参与', async () => {
    const service = await StickerService.create(baseOptions());
    const cute = service.list().find((item) => item.name === '可爱');
    const sleepy = service.list().find((item) => item.name === '深度睡眠');
    const awesome = service.list().find((item) => item.name === '厉害了我的鲸');

    const byMood = service.pick({ mood: '开心' });
    expect(byMood?.moods).toContain('happy');
    expect(service.pick({ text: '今天好困，想睡觉了' })?.id).toBe(sleepy!.id);
    expect(service.pick({ text: '你好厉害呀' })?.id).toBe(awesome!.id);
    expect(service.pick({ mood: '晚安' })?.id).toBe(sleepy!.id);
    expect(service.pick({ text: '想吃饭了' })?.id).not.toBeUndefined();

    // 概率门限
    expect(service.pick({ chance: 0 })).toBeUndefined();
    expect(service.pick({ chance: 1 })).toBeTruthy();

    // disabled 过滤
    await service.update(cute!.id, { enabled: false });
    const afterDisable = service.pick({ mood: '开心' });
    expect(afterDisable).toBeTruthy();
    expect(afterDisable?.enabled).toBe(true);
    expect(afterDisable?.id).not.toBe(cute!.id);
  });

  it('markUsed 累加使用次数与时间并广播 overview', async () => {
    const service = await StickerService.create(baseOptions());
    const target = service.list()[0];
    const before = updates.length;

    await service.markUsed(target.id);

    const after = service.list().find((item) => item.id === target.id);
    expect(after?.useCount).toBe(1);
    expect(after?.lastUsedAt).toBeTruthy();
    expect(updates.length).toBeGreaterThan(before);
    expect(updates[updates.length - 1].items.find((item) => item.id === target.id)?.useCount).toBe(1);

    await expect(service.markUsed('missing-id')).resolves.toBeUndefined();
  });
});

describe('自主收集', () => {
  it('collectNow：生成成功入库、重复 URL 去重、失败/无生成器/关闭设置返回 null', async () => {
    const generateImage = vi.fn(async (_prompt: string): Promise<StickerGenerateResult> => ({
      status: 'done',
      urls: ['media://asset/stickers/generated-1.png'],
    }));
    const service = await StickerService.create(baseOptions({ generateImage }));

    const item = await service.collectNow();
    expect(item).not.toBeNull();
    expect(item?.source).toBe('generated');
    expect(item?.whale).toBe(true);
    expect(item?.url).toBe('media://asset/stickers/generated-1.png');
    expect(item?.tags.length).toBeGreaterThan(0);
    expect(item?.moods.length).toBeGreaterThan(0);
    expect(generateImage).toHaveBeenCalledTimes(1);
    const prompt = generateImage.mock.calls[0][0] as string;
    expect(prompt).toContain('Q 版');
    expect(prompt).toContain('1:1');
    expect(prompt).toContain('无文字');
    expect(prompt).toContain('鲸鱼娘');

    // 相同 URL 不重复入库
    expect(await service.collectNow()).toBeNull();
    expect(service.overview().generated).toBe(1);

    // 生成失败
    const failing = vi.fn(async (_prompt: string): Promise<StickerGenerateResult> => ({ status: 'failed', error: '模型超时' }));
    const failService = await StickerService.create(baseOptions({ generateImage: failing }));
    expect(await failService.collectNow()).toBeNull();
    expect(logger.warn).toHaveBeenCalled();

    // 未注入生成器
    const plain = await StickerService.create(baseOptions());
    expect(await plain.collectNow()).toBeNull();

    // 关闭自动收集
    settings = makeSettings({ autoCollect: false });
    expect(await service.collectNow()).toBeNull();
  });

  it('collectNow 生成器抛异常时安全降级为 null', async () => {
    const generateImage = vi.fn(async (_prompt: string): Promise<StickerGenerateResult> => {
      throw new Error('network down');
    });
    const service = await StickerService.create(baseOptions({ generateImage }));
    expect(await service.collectNow()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('stickers', expect.stringContaining('失败'), expect.anything());
  });

  it('autoCollectIfDue：每日限额与 6 小时节流都生效', async () => {
    const generateImage = vi.fn(async (_prompt: string): Promise<StickerGenerateResult> => ({
      status: 'done',
      urls: ['media://asset/stickers/generated-due.png'],
    }));
    const service = await StickerService.create(baseOptions({ generateImage }));

    const first = await service.autoCollectIfDue();
    expect(first).not.toBeNull();
    expect(generateImage).toHaveBeenCalledTimes(1);

    // 当日限制 1 张
    expect(await service.autoCollectIfDue()).toBeNull();
    expect(generateImage).toHaveBeenCalledTimes(1);

    // 限额放宽到 2，但 6 小时内不重复尝试
    settings = makeSettings({ autoCollectPerDay: 2 });
    expect(await service.autoCollectIfDue()).toBeNull();
    expect(generateImage).toHaveBeenCalledTimes(1);

    // 关闭自动收集 / 每日 0 张
    settings = makeSettings({ autoCollect: false, autoCollectPerDay: 5 });
    expect(await service.autoCollectIfDue()).toBeNull();
    settings = makeSettings({ autoCollect: true, autoCollectPerDay: 0 });
    expect(await service.autoCollectIfDue()).toBeNull();
  });

  it('autoCollectIfDue 失败后也会进入 6 小时节流', async () => {
    const generateImage = vi.fn(async (_prompt: string): Promise<StickerGenerateResult> => ({
      status: 'failed',
      error: '额度不足',
    }));
    const service = await StickerService.create(baseOptions({ generateImage }));
    settings = makeSettings({ autoCollectPerDay: 3 });

    expect(await service.autoCollectIfDue()).toBeNull();
    expect(await service.autoCollectIfDue()).toBeNull();
    expect(generateImage).toHaveBeenCalledTimes(1);
  });
});

describe('概览与设置', () => {
  it('overview 统计 total/favorites/generated/tags/lastCollectedAt/todayGenerated', async () => {
    const generateImage = vi.fn(async (_prompt: string): Promise<StickerGenerateResult> => ({
      status: 'done',
      urls: ['media://asset/stickers/overview.png'],
    }));
    const service = await StickerService.create(baseOptions({ generateImage }));
    await service.saveDataUrl({ dataUrl: PNG_DATA_URL, favorite: true, tags: ['收藏'] });
    await service.collectNow();

    const overview = service.overview();
    expect(overview.total).toBe(SEED_COUNT + 2);
    expect(overview.favorites).toBe(1);
    expect(overview.generated).toBe(1);
    expect(overview.autoCollect).toBe(true);
    expect(overview.tags).toContain('可爱');
    expect(overview.tags).toContain('收藏');
    expect(new Set(overview.tags).size).toBe(overview.tags.length);
    expect(overview.lastCollectedAt).toBeTruthy();
    expect(overview.todayGenerated).toBe(1);
    for (let index = 1; index < overview.items.length; index += 1) {
      expect(overview.items[index - 1].createdAt >= overview.items[index].createdAt).toBe(true);
    }
  });

  it('setSettings 合并 + 校验并调用 saveSettings', async () => {
    const service = await StickerService.create(baseOptions());

    const merged = await service.setSettings({ autoSendChance: 0.5, autoCollectPerDay: 99, qzoneChance: -1 });
    expect(merged.autoSendChance).toBe(0.5);
    expect(merged.autoCollectPerDay).toBe(20);
    expect(merged.qzoneChance).toBe(0);
    expect(merged.enabled).toBe(true);
    expect(merged.autoSendInChat).toBe(true);
    expect(saveSettingsCalls[saveSettingsCalls.length - 1]).toEqual({ stickers: merged });

    const off = await service.setSettings({ autoCollect: false });
    expect(off.autoCollect).toBe(false);
    expect(service.overview().autoCollect).toBe(false);

    const keep = await service.setSettings({ autoCollectPerDay: Number.NaN as never });
    expect(keep.autoCollectPerDay).toBe(20);
  });

  it('每次变更都会 emit stickers:update，无 events 也能工作', async () => {
    const service = await StickerService.create(baseOptions());
    const before = updates.length;
    const item = await service.saveDataUrl({ dataUrl: PNG_DATA_URL });
    expect(updates.length).toBe(before + 1);
    expect(updates[updates.length - 1].total).toBe(SEED_COUNT + 1);

    await service.update(item.id, { favorite: true });
    await service.markUsed(item.id);
    await service.remove(item.id);
    await service.setSettings({ autoSendChance: 0.3 });
    expect(updates.length).toBe(before + 5);

    const silent = await StickerService.create(baseOptions({ events: undefined }));
    await expect(silent.saveDataUrl({ dataUrl: PNG_DATA_URL })).resolves.toBeTruthy();
  });
});
