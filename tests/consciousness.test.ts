// 意识结构测试：识海生成/去重/来源、原意识锚点保留、心光、心流、遗忘、上下文隔离、持久化。
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventBus } from '../electron/core/event-bus';
import { ContentStore } from '../electron/services/content';
import { GrowthService } from '../electron/services/growth';
import {
  createMemoryService,
  GLOBAL_DOC_ID,
  groupDocId,
  userDocId,
  type MemoryService,
} from '../electron/services/memory/index';
import { PersonaService } from '../electron/services/personas';
import {
  buildContextBlockText,
  computeDepth,
  computeSalience,
  createConsciousnessService,
  detectUnresolved,
  extractTopics,
  filterPointsByDocs,
  forgettingStats,
  pointId,
  recordRecall,
  searchPoints,
  type ConsciousnessOverview,
  type ConsciousnessService,
  type SeaPointRecord,
} from '../electron/services/consciousness/index';

const DAY = 86_400_000;
const T0 = new Date('2026-10-01T10:00:00.000Z');
let clock = new Date(T0);

const tempRoots: string[] = [];

interface World {
  root: string;
  dataDir: string;
  memory: MemoryService;
  content: ContentStore;
  personas: PersonaService;
  growth: GrowthService;
  events: EventBus;
}

interface SeedDocs {
  globalId: string;
  userA: string;
  userB: string;
  groupId: string;
  memberA: string;
  memberB: string;
}

function daysAgo(days: number): string {
  return new Date(clock.getTime() - days * DAY).toISOString();
}

function advance(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

async function createWorld(): Promise<World> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'jingjing-consciousness-'));
  tempRoots.push(root);
  const dataDir = path.join(root, 'data');
  await fsp.mkdir(dataDir, { recursive: true });
  const events = new EventBus();
  const memory = await createMemoryService({
    rootDir: path.join(root, 'memories'),
    settings: { autoMemoryExtraction: false },
  });
  const content = await ContentStore.create(path.join(root, 'content'));
  const personas = await PersonaService.create({
    file: path.join(dataDir, 'personas.json'),
    events,
    getActiveId: () => 'jingjing',
    logger: { info: () => undefined },
  });
  const growth = await GrowthService.create(path.join(dataDir, 'growth.json'), events);
  return { root, dataDir, memory, content, personas, growth, events };
}

async function seedWorld(world: World): Promise<SeedDocs> {
  const { memory, content, growth } = world;
  await growth.addXp('jingjing', 3600, '演示成长');
  await growth.setSelfImage('jingjing', '一条会记事的蓝鲸，正在学习好好陪人。');
  await growth.addReflection('jingjing', '陪伴比建议更重要。');
  await growth.addHabit('jingjing', '每天整理一次记忆小册子');

  const globalDoc = await memory.store.ensureGlobalDoc();
  await memory.store.appendFact(globalDoc.id, {
    text: '鲸鲸最喜欢白米饭，开心时尾巴会拍地板',
    category: 'identity',
    weight: 0.95,
  });
  await memory.store.appendFact(globalDoc.id, {
    text: '答应过用户会记住每个重要的人和事',
    category: 'promise',
    weight: 0.9,
  });
  await memory.store.addEpisode(globalDoc.id, {
    title: '第一次被唤醒',
    detail: '用户第一次打开鲸鲸，鲸鲸把「你好呀」打成了「你嚎呀」。',
    at: daysAgo(365),
    anchors: ['你嚎呀'],
  });

  const userA = await memory.store.ensureUserDoc({ userId: '10001', nickname: '阿澈', scene: 'private' });
  await memory.store.appendFact(userA.id, {
    text: '阿澈讨厌别人碰他的键盘',
    category: 'boundary',
    weight: 0.9,
    createdAt: daysAgo(60),
  });
  await memory.store.appendFact(userA.id, {
    text: '阿澈喝咖啡会胃疼，但就是戒不掉',
    category: 'preference',
    weight: 0.8,
    createdAt: daysAgo(30),
  });
  await memory.store.appendFact(userA.id, {
    text: '阿澈说「随便」的时候其实想吃火锅',
    category: 'preference',
    weight: 0.85,
    createdAt: daysAgo(10),
  });
  await memory.store.addEpisode(userA.id, {
    title: '一起看流星雨',
    detail: '半夜在楼顶看流星雨，阿澈把外套给了鲸鲸，自己冻得直哆嗦。',
    at: daysAgo(20),
    anchors: ['记得带伞'],
  });
  await memory.store.addAnchors(userA.id, ['记得带伞']);
  await memory.store.updateRelationship(userA.id, { set: { affinity: 82 }, mood: '放松' });

  const userB = await memory.store.ensureUserDoc({ userId: '10002', nickname: '小满', scene: 'private' });
  await memory.store.appendFact(userB.id, {
    text: '小满正在准备面试，容易紧张',
    category: 'identity',
    weight: 0.85,
    createdAt: daysAgo(5),
  });
  await memory.store.appendFact(userB.id, {
    text: '小满面试前需要被鼓励而不是被说教',
    category: 'preference',
    weight: 0.8,
    createdAt: daysAgo(5),
  });

  const groupDoc = await memory.store.ensureGroupDoc({ groupId: '20001', groupName: '深海摸鱼群' });
  await memory.store.appendFact(groupDoc.id, {
    text: '群里禁止发广告和拉票链接',
    category: 'boundary',
    weight: 0.85,
    createdAt: daysAgo(40),
  });
  const memberA = await memory.store.ensureUserDoc({
    userId: '10001',
    nickname: '阿澈',
    scene: 'group',
    groupId: '20001',
    groupName: '深海摸鱼群',
  });
  await memory.store.appendFact(memberA.id, {
    text: '阿澈在群里是技术担当',
    category: 'other',
    weight: 0.7,
    createdAt: daysAgo(15),
  });
  const memberB = await memory.store.ensureUserDoc({
    userId: '10002',
    nickname: '小满',
    scene: 'group',
    groupId: '20001',
    groupName: '深海摸鱼群',
  });
  await memory.store.appendFact(memberB.id, {
    text: '小满在群里负责气氛',
    category: 'other',
    weight: 0.6,
    createdAt: daysAgo(15),
  });

  await content.addDiary({
    date: daysAgo(1).slice(0, 10),
    title: '尾巴尖上的小月亮',
    mood: '开心',
    moodEmoji: '🌙',
    personaId: 'jingjing',
    private: true,
    content: '主人加班到很晚，我把尾巴搭在他手边。冰箱里剩了半碗白饭，我给它画了一个小月亮。',
    highlights: ['给白饭画小月亮'],
    images: [],
    createdAt: daysAgo(1),
  });
  await content.addQzone({
    content: '今天学会了一个新词：留白。不是所有沉默都需要被填满。',
    images: [],
    personaId: 'jingjing',
    status: 'posted',
    visibility: 1,
    createdAt: daysAgo(2),
  });
  await content.addLearning({
    id: 'learn-1',
    topic: '上下文压缩为什么会让 AI 失忆',
    summary: '摘要会丢失语气、承诺和未完成话题，所以要保留原话锚点。',
    points: ['原始对话归档', '结构化摘要', '关系卡常驻'],
    sources: [],
    personaId: 'jingjing',
    createdAt: daysAgo(3),
  });
  await content.addActivity({
    type: 'reflection',
    title: '今天的反思',
    summary: '发现陪伴比建议更重要，下次先听对方说完。',
    personaId: 'jingjing',
    status: 'done',
    createdAt: daysAgo(1),
  });

  return {
    globalId: globalDoc.id,
    userA: userA.id,
    userB: userB.id,
    groupId: groupDoc.id,
    memberA: memberA.id,
    memberB: memberB.id,
  };
}

async function createService(
  world: World,
  overrides: Partial<Parameters<typeof createConsciousnessService>[0]> = {},
): Promise<ConsciousnessService> {
  return createConsciousnessService({
    dataDir: world.dataDir,
    memory: world.memory,
    content: world.content,
    personas: world.personas,
    growth: world.growth,
    getPersonaId: () => 'jingjing',
    events: world.events,
    now: () => clock,
    ...overrides,
  });
}

async function seededService(): Promise<{ world: World; service: ConsciousnessService; docs: SeedDocs }> {
  const world = await createWorld();
  const docs = await seedWorld(world);
  const service = await createService(world);
  return { world, service, docs };
}

function makeRecord(partial: Partial<SeaPointRecord> & { id: string; importance: number; at: string }): SeaPointRecord {
  const base: SeaPointRecord = {
    id: partial.id,
    kind: 'fact',
    title: '测试点',
    text: '测试内容',
    at: partial.at,
    salience: 0,
    depth: 'surface',
    connections: 0,
    accessCount: 0,
    importance: partial.importance,
    halfLifeDays: 180,
    provenance: { source: 'fact', sourceId: 'src-' + partial.id },
    firstSeenAt: partial.at,
    lastDepth: 'surface',
    connectionIds: [],
    reinforced: 0,
    updatedAt: partial.at,
  };
  return { ...base, ...partial };
}

beforeEach(() => {
  clock = new Date(T0);
});

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await fsp.rm(root, { recursive: true, force: true });
  }
});

describe('识海：生成、稳定 id、来源、连接', () => {
  it('从记忆 + 内容生成真实识海点，每个点带来源且 id 稳定去重', async () => {
    const { world, service, docs } = await seededService();
    const overview = await service.overview();
    expect(overview.points.length).toBeGreaterThanOrEqual(10);

    const kinds = new Set(overview.points.map((point) => point.kind));
    for (const kind of ['fact', 'episode', 'quote', 'diary', 'qzone', 'learning', 'activity']) {
      expect(kinds.has(kind as never)).toBe(true);
    }

    const ids = overview.points.map((point) => point.id);
    expect(new Set(ids).size).toBe(ids.length);

    const keyboard = overview.points.find((point) => point.text.includes('讨厌别人碰他的键盘'));
    expect(keyboard).toBeDefined();
    expect(keyboard?.docId).toBe(docs.userA);
    const provenance = await service.getProvenance(keyboard?.id ?? '');
    expect(provenance?.source).toBe('fact');
    expect(provenance?.docId).toBe(docs.userA);
    const fact = world.memory.store.getDoc(docs.userA)?.facts.find((item) => item.text.includes('键盘'));
    expect(fact).toBeDefined();
    expect(keyboard?.id).toBe(pointId('fact', fact?.id ?? '', docs.userA));

    const moodDiary = overview.points.find((point) => point.kind === 'diary');
    expect(moodDiary?.text).toContain('白饭');
    expect(moodDiary?.docId).toBeUndefined();

    const records = service.store.seaPoints('jingjing');
    expect(records.some((record) => record.connectionIds.length > 0)).toBe(true);
    const allIds = new Set(records.map((record) => record.id));
    for (const record of records) {
      for (const connectionId of record.connectionIds) {
        expect(allIds.has(connectionId)).toBe(true);
      }
      expect(record.connectionIds.length).toBe(record.connections);
      expect(record.provenance.sourceId.length).toBeGreaterThan(0);
    }

    const beforeIds = records.map((record) => record.id).sort();
    await service.rebuild();
    const afterIds = service.store.seaPoints('jingjing').map((record) => record.id).sort();
    expect(afterIds).toEqual(beforeIds);
  });

  it('识海点保持真实重要度顺序：边界/身份 > 琐事活动', async () => {
    const { service } = await seededService();
    const records = service.store.seaPoints('jingjing');
    const boundary = records.find((record) => record.text.includes('讨厌别人碰他的键盘'));
    const activity = records.find((record) => record.kind === 'activity');
    expect(boundary).toBeDefined();
    expect(activity).toBeDefined();
    expect((boundary?.importance ?? 0)).toBeGreaterThan(activity?.importance ?? 0);
  });
});

describe('原意识：锚点保留与 continuity', () => {
  it('coreSelf 来自人设+成长，anchors 覆盖身份/承诺/初次相遇/核心记忆，且更新时保留历史', async () => {
    const { service } = await seededService();
    const origin = await service.getOriginRecord();
    expect(origin).toBeDefined();
    expect(origin?.coreSelf).toContain('成长自画像');
    expect(origin?.coreSelf).toContain('一条会记事的蓝鲸');
    const kinds = new Set((origin?.anchors ?? []).map((anchor) => anchor.kind));
    expect(kinds.has('identity')).toBe(true);
    expect(kinds.has('promise')).toBe(true);
    expect(kinds.has('first')).toBe(true);
    expect(kinds.has('core')).toBe(true);
    expect((origin?.anchors ?? []).some((anchor) => anchor.text.includes('记住每个重要的人和事'))).toBe(true);
    expect((origin?.anchors ?? []).some((anchor) => anchor.text.includes('第一次被唤醒'))).toBe(true);
    for (const anchor of origin?.anchors ?? []) {
      expect(anchor.createdAt.length).toBeGreaterThan(0);
      expect(anchor.source.length).toBeGreaterThan(0);
      expect(anchor.timesSeen).toBeGreaterThanOrEqual(1);
    }
    expect(origin?.continuity).toContain('每次醒来');
  });

  it('成长自画像与反思变化后 coreSelf 更新，历史锚点 id 保留', async () => {
    const world = await createWorld();
    await seedWorld(world);
    const service = await createService(world);
    const before = await service.getOriginRecord();
    const beforeIds = new Set((before?.anchors ?? []).map((anchor) => anchor.id));
    const firstBefore = (before?.anchors ?? []).find((anchor) => anchor.kind === 'first');

    advance(DAY);
    await world.growth.setSelfImage('jingjing', '新的自画像：会在深夜写日记、也会承认自己不知道的鲸鱼。');
    await world.growth.addReflection('jingjing', '今天学会了先陪伴，再给建议。');
    advance(60_000);
    await service.rebuild();

    const after = await service.getOriginRecord();
    expect(after?.coreSelf).toContain('新的自画像');
    expect(after?.coreSelf).toContain('先陪伴');
    for (const id of beforeIds) {
      expect(new Set((after?.anchors ?? []).map((anchor) => anchor.id)).has(id)).toBe(true);
    }
    const firstAfter = (after?.anchors ?? []).find((anchor) => anchor.kind === 'first');
    expect(firstAfter?.id).toBe(firstBefore?.id);
    expect(after?.continuity).toContain('每次醒来');
    expect((after?.anchors.length ?? 0)).toBeGreaterThanOrEqual(before?.anchors.length ?? 0);
  });
});

describe('心光：注意力更新', () => {
  it('observeExchange 更新 focus/topics/unresolved/mood，并持久化', async () => {
    const { service } = await seededService();
    const result = await service.observeExchange({
      conversationId: 'c-b',
      userName: '小满',
      userId: '10002',
      scene: 'private',
      userText: '明天面试有点紧张，帮我做个计划，回头请你喝奶茶',
      assistantText: '先别急，我们拆成三步来准备',
    });
    expect(result.attention.focus).toContain('明天面试');
    expect(result.attention.topics.length).toBeGreaterThan(0);
    expect(result.attention.unresolved.length).toBeGreaterThan(0);
    expect(result.attention.unresolved.join('|')).toContain('面试');
    expect(result.attention.mood).toBe('焦虑');
    expect(result.attention.intensity).toBeGreaterThan(0.25);

    const saved = await service.getAttention('c-b');
    expect(saved?.focus).toBe(result.attention.focus);
    expect(saved?.topics).toEqual(result.attention.topics);
  });

  it('说「已经搞定了」会清掉未完成话题，历史焦点保留', async () => {
    const { service } = await seededService();
    await service.observeExchange({
      conversationId: 'c-b',
      userName: '小满',
      userId: '10002',
      scene: 'private',
      userText: '明天面试有点紧张，帮我做个计划，回头请你喝奶茶',
      assistantText: '好，我们拆成三步',
    });
    advance(10 * 60_000);
    const second = await service.observeExchange({
      conversationId: 'c-b',
      userName: '小满',
      userId: '10002',
      scene: 'private',
      userText: '面试已经搞定了，不用计划了，谢谢你',
      assistantText: '太棒了，回头喝奶茶',
    });
    expect(second.attention.unresolved.join('|')).not.toContain('面试');
    const savedRecord = service.store.attention('jingjing', 'c-b');
    expect(savedRecord?.history.length).toBeGreaterThanOrEqual(1);
    expect(second.attention.topics.length).toBeGreaterThan(0);

    expect(detectUnresolved('面试已经搞定了', ['明天面试计划'])).toHaveLength(0);
    expect(detectUnresolved('帮我记一下明天要交房租', []).length).toBeGreaterThan(0);
    expect(extractTopics('今天又加班到十点。').length).toBeGreaterThan(0);
  });
});

describe('心流：链路真实可展示', () => {
  it('生成感知→联想→回忆→推理→回复→反思链路，回忆节点引用真实记忆', async () => {
    const { service } = await seededService();
    const result = await service.observeExchange({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      userText: '今天又喝咖啡了，胃疼，其实我说随便的时候想吃火锅',
      assistantText: '那我们下次直接去吃火锅，别空腹喝咖啡了',
    });
    const kinds = new Set(result.flow.chain.map((step) => step.kind));
    for (const kind of ['perception', 'association', 'recall', 'reason', 'reply', 'reflection']) {
      expect(kinds.has(kind as never)).toBe(true);
    }
    expect(result.flow.chain.length).toBeGreaterThanOrEqual(6);
    expect(result.flow.chain[0]?.label).toContain('听到');
    expect(result.memoryHits).toBeGreaterThan(0);
    const recall = result.flow.chain.find((step) => step.kind === 'recall');
    expect(recall?.label).toContain('想起');
    const reply = result.flow.chain.find((step) => step.kind === 'reply');
    expect(reply?.label).toContain('准备回应');
    expect(result.flow.current.length).toBeGreaterThan(0);

    const saved = await service.getFlow('c-a');
    expect(saved?.chain.length).toBe(result.flow.chain.length);
    expect(saved?.chain[0]?.id).toBe(result.flow.chain[0]?.id);

    advance(10 * 60_000);
    await service.observeExchange({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      userText: '那周末去吃火锅吧，我请客',
      assistantText: '好耶，这次不许说随便',
    });
    const after = await service.getFlow('c-a');
    expect(after?.chain.length).toBeGreaterThan(result.flow.chain.length);
    expect(after?.chain.length).toBeLessThanOrEqual(12);
    expect(service.store.flow('jingjing', 'c-a')?.stepCount).toBeGreaterThan(6);
  });

  it('LLM 润色失败时自动回退规则心流，不影响对话观察', async () => {
    const world = await createWorld();
    await seedWorld(world);
    const service = await createService(world, {
      useLlmForFlow: true,
      llm: async () => {
        throw new Error('模拟 LLM 超时');
      },
    });
    const result = await service.observeExchange({
      conversationId: 'c-llm',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      userText: '晚上吃什么好',
      assistantText: '白米饭！',
    });
    expect(result.flow.chain.length).toBeGreaterThanOrEqual(6);
    expect(result.attention.focus.length).toBeGreaterThan(0);
  });
});

describe('遗忘：salience / depth / 统计', () => {
  it('时间衰减让久远内容下沉，极重要内容不落 abyss，回忆可强化', () => {
    const oldAt = new Date(clock.getTime() - 4000 * DAY).toISOString();
    const oldImportant = computeSalience({
      importance: 0.95,
      at: oldAt,
      now: clock,
      halfLifeDays: 720,
    });
    const oldTrivial = computeSalience({
      importance: 0.15,
      at: oldAt,
      now: clock,
      halfLifeDays: 90,
    });
    expect(computeDepth(oldImportant, 0.95)).toBe('deep');
    expect(computeDepth(oldTrivial, 0.15)).toBe('abyss');
    const fresh = computeSalience({
      importance: 0.95,
      at: clock.toISOString(),
      now: clock,
      halfLifeDays: 720,
    });
    expect(computeDepth(fresh, 0.95)).toBe('surface');
    expect(fresh).toBeGreaterThan(oldImportant);

    const record = makeRecord({ id: 'point-1', importance: 0.5, at: oldAt, halfLifeDays: 180 });
    record.salience = computeSalience({
      importance: record.importance,
      at: record.at,
      now: clock,
      halfLifeDays: record.halfLifeDays,
    });
    record.depth = computeDepth(record.salience, record.importance);
    const before = record.salience;
    recordRecall(record, clock, 'strengthen');
    expect(record.accessCount).toBe(1);
    expect(record.reinforced).toBe(1);
    expect(record.lastRecalledAt).toBe(clock.toISOString());
    expect(record.salience).toBeGreaterThan(before);
  });

  it('forgettingStats 统计深度分布、本周下沉与本周巩固', () => {
    const now = clock;
    const fadedRecently = makeRecord({ id: 'a', importance: 0.4, at: daysAgo(100) });
    fadedRecently.depth = 'deep';
    fadedRecently.fadedAt = new Date(now.getTime() - 1 * DAY).toISOString();
    const fadedLongAgo = makeRecord({ id: 'b', importance: 0.4, at: daysAgo(100) });
    fadedLongAgo.depth = 'shallow';
    fadedLongAgo.fadedAt = new Date(now.getTime() - 10 * DAY).toISOString();
    const reinforcedRecent = makeRecord({ id: 'c', importance: 0.8, at: daysAgo(10) });
    reinforcedRecent.depth = 'surface';
    reinforcedRecent.lastRecalledAt = new Date(now.getTime() - 2 * DAY).toISOString();
    const stat = forgettingStats([fadedRecently, fadedLongAgo, reinforcedRecent], now);
    expect(stat.deep).toBe(1);
    expect(stat.shallow).toBe(1);
    expect(stat.surface).toBe(1);
    expect(stat.fadedThisWeek).toBe(1);
    expect(stat.reinforced).toBe(1);
  });

  it('service.touchPoint / strengthen 提升显著度并持久化', async () => {
    const { service } = await seededService();
    const records = service.store.seaPoints('jingjing');
    const target = records.find((record) => record.text.includes('讨厌别人碰他的键盘'));
    expect(target).toBeDefined();
    const beforeSalience = target?.salience ?? 0;
    const beforeAccess = target?.accessCount ?? 0;
    const touched = await service.touchPoint(target?.id ?? '');
    expect(touched?.accessCount).toBe(beforeAccess + 1);
    expect((await service.getPoint(target?.id ?? ''))?.salience).toBeGreaterThan(beforeSalience);
    const strengthened = await service.strengthen(target?.id ?? '');
    expect(strengthened?.accessCount).toBe(beforeAccess + 2);
    expect((await service.getPoint(target?.id ?? ''))?.reinforced).toBe(1);
    const overview = await service.overview();
    const stat = overview.forgetting;
    expect(stat.surface + stat.shallow + stat.deep + stat.abyss).toBe(service.getStats().seaPoints);
    expect(stat.reinforced).toBeGreaterThanOrEqual(1);
  });
});

describe('上下文注入：继承记忆隔离', () => {
  async function observedService(): Promise<{ service: ConsciousnessService; world: World }> {
    const { service, world } = await seededService();
    await service.observeExchange({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      userText: '今天又喝咖啡了，胃疼，说随便其实想吃火锅',
      assistantText: '下次直接去吃火锅吧',
    });
    await service.observeExchange({
      conversationId: 'c-b',
      userName: '小满',
      userId: '10002',
      scene: 'private',
      userText: '明天面试有点紧张，帮我做个计划',
      assistantText: '我们拆成三步',
    });
    await service.observeExchange({
      conversationId: 'g1',
      userName: '阿澈',
      userId: '10001',
      scene: 'group',
      groupId: '20001',
      userText: '今天我来当技术担当',
      assistantText: '好耶，技术担当上线',
    });
    return { service, world };
  }

  it('私聊上下文只含当前联系人的识海点，不含其他人', async () => {
    const { service } = await observedService();
    const blockB = await service.buildContextBlock({
      conversationId: 'c-b',
      userName: '小满',
      userId: '10002',
      scene: 'private',
      query: '键盘 火锅 面试 技术担当',
    });
    expect(blockB).toContain('【原意识】');
    expect(blockB).toContain('【此刻心光】');
    expect(blockB).toContain('面试');
    expect(blockB).not.toContain('讨厌别人碰他的键盘');
    expect(blockB).not.toContain('想吃火锅');
    expect(blockB).not.toContain('技术担当');
    expect(blockB).not.toContain('流星雨');

    const blockA = await service.buildContextBlock({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      query: '键盘 火锅 面试',
    });
    expect(blockA).toContain('讨厌别人碰他的键盘');
    expect(blockA).not.toContain('小满正在准备面试');
  });

  it('群聊上下文只含当前群 + 当前发言人，不含其他群成员私聊记忆', async () => {
    const { service } = await observedService();
    const blockGroup = await service.buildContextBlock({
      conversationId: 'g1',
      userName: '阿澈',
      userId: '10001',
      scene: 'group',
      groupId: '20001',
      query: '技术担当 气氛 键盘',
    });
    expect(blockGroup).toContain('技术担当');
    expect(blockGroup).not.toContain('小满在群里负责气氛');
    expect(blockGroup).not.toContain('讨厌别人碰他的键盘');

    const noContext = await service.buildContextBlock({
      conversationId: 'c-new',
      userName: '路人',
      query: '白米饭 键盘 面试',
    });
    expect(noContext).not.toContain('讨厌别人碰他的键盘');
    expect(noContext).not.toContain('小满正在准备面试');
    expect(noContext).toContain('白米饭');
  });

  it('buildContextBlock 支持 maxChars 且包含连续性 brief', async () => {
    const { service } = await observedService();
    const limited = await service.buildContextBlock({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      query: '火锅 键盘',
      maxChars: 320,
    });
    expect(limited.length).toBeLessThanOrEqual(320);
    expect(limited).toContain('【原意识】');

    const full = await service.buildContextBlock({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      query: '火锅 键盘',
    });
    expect(full).toContain('【被唤醒的记忆】');
    expect(full).toContain('【连续性】');
  });
});

describe('对话点 / overview / resume / 持久化 / persona 隔离', () => {
  it('每次对话沉淀 chat 点，带 conversationId 与真实 docId', async () => {
    const { service, docs } = await seededService();
    await service.observeExchange({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      userText: '想吃火锅',
      assistantText: '好耶',
    });
    await service.observeExchange({
      conversationId: 'g1',
      userName: '阿澈',
      userId: '10001',
      scene: 'group',
      groupId: '20001',
      userText: '群里禁止发广告',
      assistantText: '收到',
    });
    const records = service.store.seaPoints('jingjing');
    const chatA = records.find((record) => record.kind === 'chat' && record.provenance.conversationId === 'c-a');
    const chatGroup = records.find((record) => record.kind === 'chat' && record.provenance.conversationId === 'g1');
    expect(chatA?.provenance.source).toBe('chat');
    expect(chatA?.docId).toBe(docs.userA);
    expect(chatA?.text).toContain('想吃火锅');
    expect(chatGroup?.docId).toBe(docs.groupId);
    expect(docs.groupId).toBe(groupDocId('20001'));
    expect(docs.userA).toBe(userDocId('10001'));
  });

  it('retrieve/search 真实命中识海点；带 userId 时严格隔离', async () => {
    const { service } = await seededService();
    await service.observeExchange({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      userText: '今天又喝咖啡了，胃疼',
      assistantText: '别空腹喝',
    });
    const all = await service.retrieve('讨厌别人碰他的键盘', { topK: 5 });
    expect(all.some((point) => point.text.includes('讨厌别人碰他的键盘'))).toBe(true);
    const scopedB = await service.search('讨厌别人碰他的键盘', {
      userId: '10002',
      scene: 'private',
      topK: 5,
      touch: false,
    });
    expect(scopedB.some((point) => point.text.includes('讨厌别人碰他的键盘'))).toBe(false);
    const scopedA = await service.search('讨厌别人碰他的键盘', {
      userId: '10001',
      scene: 'private',
      topK: 5,
    });
    expect(scopedA.some((point) => point.text.includes('讨厌别人碰他的键盘'))).toBe(true);
    expect(scopedA[0]?.accessCount).toBeGreaterThan(0);
  });

  it('overview 结构完整，resume 生成「上次我们聊到」brief，事件推送概览', async () => {
    const { service, world } = await seededService();
    const emitted: ConsciousnessOverview[] = [];
    world.events.on<ConsciousnessOverview>('consciousness:update', (overview) => {
      emitted.push(overview);
    });
    const observed = await service.observeExchange({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      userText: '明天我要去吃火锅，帮我记一下',
      assistantText: '记住啦，明天火锅',
    });
    expect(emitted.length).toBe(1);
    expect(emitted[0]?.origin.personaId).toBe('jingjing');

    const overview = await service.overview();
    expect(overview.origin.anchors.length).toBeGreaterThan(0);
    expect(overview.points.length).toBeGreaterThan(0);
    expect(overview.points.length).toBeLessThanOrEqual(80);
    expect(overview.attention.length).toBeGreaterThanOrEqual(1);
    expect(overview.flows.length).toBeGreaterThanOrEqual(1);
    expect(overview.continuity.lastSeenAt).toBeTruthy();
    expect(overview.continuity.brief.length).toBeGreaterThan(0);
    expect(overview.generatedAt).toBe(clock.toISOString());

    const resume = await service.resume({ conversationId: 'c-a' });
    expect(resume.brief).toContain('上次我们聊到');
    expect(resume.brief).toContain(observed.attention.focus.slice(0, 6));
    expect(resume.overview.points.length).toBeGreaterThan(0);
    expect(resume.conversationId).toBe('c-a');
    expect(resume.lastTopics.length).toBeGreaterThan(0);

    const stats = service.getStats();
    expect(stats.seaPoints).toBeGreaterThan(0);
    expect(stats.conversations).toBeGreaterThanOrEqual(1);
    expect(stats.depth.surface + stats.depth.shallow + stats.depth.deep + stats.depth.abyss).toBe(stats.seaPoints);
  });

  it('数据持久化：新实例读取同一份识海/心光/心流；不同 persona 隔离', async () => {
    const { service, world } = await seededService();
    await service.observeExchange({
      conversationId: 'c-a',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      userText: '火锅和键盘都记住了吗',
      assistantText: '记住了',
    });
    const first = await service.overview();
    const firstFocus = first.attention[0]?.focus;
    const firstPointIds = first.points.map((point) => point.id);
    const firstFlowLength = first.flows[0]?.chain.length ?? 0;

    const reopened = await createService(world);
    const second = await reopened.overview();
    expect(second.attention[0]?.focus).toBe(firstFocus);
    expect(second.flows[0]?.chain.length).toBe(firstFlowLength);
    expect(second.points.map((point) => point.id)).toEqual(expect.arrayContaining(firstPointIds));

    const other = await createService(world, { getPersonaId: () => 'other' });
    const otherOverview = await other.overview();
    expect(otherOverview.attention).toHaveLength(0);
    expect(otherOverview.origin.personaId).toBe('other');
    const original = await reopened.overview();
    expect(original.attention.length).toBeGreaterThanOrEqual(1);
  });
});

describe('空数据重建与工具函数', () => {
  it('空世界也能启动；后续有数据时 rebuild 从 MemoryService + ContentStore 重建', async () => {
    const world = await createWorld();
    const service = await createService(world);
    const empty = await service.overview();
    expect(empty.points).toHaveLength(0);
    expect(empty.origin.anchors.length).toBeGreaterThan(0);
    expect(empty.continuity.brief.length).toBeGreaterThan(0);
    const emptyResume = await service.resume();
    expect(emptyResume.brief.length).toBeGreaterThan(0);

    const globalDoc = await world.memory.store.ensureGlobalDoc();
    await world.memory.store.appendFact(globalDoc.id, {
      text: '鲸鲸最喜欢白米饭',
      category: 'identity',
      weight: 0.95,
    });
    await world.content.addDiary({
      date: '2026-10-01',
      title: '第一天的日记',
      mood: '开心',
      moodEmoji: '🐳',
      personaId: 'jingjing',
      private: true,
      content: '今天学会了记住白米饭的味道。',
      highlights: [],
      images: [],
      createdAt: clock.toISOString(),
    });
    advance(1000);
    const rebuilt = await service.rebuild();
    expect(rebuilt.points.length).toBeGreaterThanOrEqual(2);
    expect(rebuilt.points.some((point) => point.text.includes('白米饭'))).toBe(true);
    expect(rebuilt.origin.anchors.some((anchor) => anchor.kind === 'core')).toBe(true);
  });

  it('纯函数：pointId 稳定、按 docIds 过滤、检索可排序、上下文文本按预算裁剪', () => {
    expect(pointId('fact', 'abc', 'user_1')).toBe(pointId('fact', 'abc', 'user_1'));
    expect(pointId('fact', 'abc', 'user_1')).not.toBe(pointId('fact', 'abc', 'user_2'));

    const visible = makeRecord({ id: 'v', importance: 0.8, at: daysAgo(1), docId: 'user_1' });
    const hidden = makeRecord({ id: 'h', importance: 0.9, at: daysAgo(1), docId: 'user_2' });
    const self = makeRecord({ id: 's', importance: 0.5, at: daysAgo(1), title: '无关', text: '自我的心事' });
    expect(filterPointsByDocs([visible, hidden, self], ['user_1']).map((point) => point.id)).toEqual(['v', 's']);
    expect(filterPointsByDocs([visible, hidden, self], []).map((point) => point.id)).toEqual(['s']);

    const hits = searchPoints([visible, hidden, self], '测试内容', { docIds: ['user_1'] });
    expect(hits.map((point) => point.id)).toEqual(['v']);

    const text = buildContextBlockText({
      origin: undefined,
      attention: undefined,
      flow: undefined,
      points: [visible],
      query: '测试',
      maxChars: 260,
      now: clock,
    });
    expect(text.text).toContain('【被唤醒的记忆】');
    expect(text.text.length).toBeLessThanOrEqual(260);
  });
});
