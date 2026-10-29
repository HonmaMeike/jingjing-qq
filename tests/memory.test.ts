// 记忆系统测试：隔离、压缩、检索、路径安全、持久化。
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ContextManager,
  GLOBAL_DOC_ID,
  MEMORY_SECTIONS,
  MemoryExtractor,
  MemoryStore,
  allowedMemoryDocIds,
  createMemoryService,
  estimateTokens,
  groupDocId,
  memberDocId,
  normalizeCompactionPayload,
  normalizeExtraction,
  parseJsonLoose,
  resolveInside,
  safeSegment,
  seedDemoMemory,
  userDocId,
  type ContextInputMessage,
  type MemoryLlm,
  type MemoryStoreOptions,
} from '../electron/services/memory/index';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const DAY = 86_400_000;

const tempRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'jingjing-memory-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await fsp.rm(root, { recursive: true, force: true });
  }
});

async function newStore(root: string, options: Partial<MemoryStoreOptions> = {}): Promise<MemoryStore> {
  const store = new MemoryStore({ rootDir: root, ...options });
  await store.init();
  return store;
}

function userMessage(text: string, name = '对方'): ContextInputMessage {
  return { role: 'user', content: text, name };
}

function assistantMessage(text: string): ContextInputMessage {
  return { role: 'assistant', content: text, name: '鲸鲸' };
}

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
}

function fencedJson(value: unknown): string {
  return '前面是一些说明文字\n' + '```json\n' + JSON.stringify(value, null, 2) + '\n```\n后面还有话';
}

function isDir(target: string): Promise<boolean> {
  return fsp.stat(target).then((stat) => stat.isDirectory()).catch(() => false);
}

describe('存储布局与 Markdown 文档', () => {
  it('初始化时创建 users/groups/global/summaries/archive 布局', async () => {
    const root = await makeRoot();
    await newStore(root);
    for (const dir of ['users', 'groups', 'global', 'summaries', 'archive']) {
      expect(await isDir(path.join(root, dir))).toBe(true);
    }
  });

  it('文档包含全部固定章节，并落盘到 users/<safeId>.md', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    expect(path.dirname(doc.filePath)).toBe(path.join(root, 'users'));
    expect(path.basename(doc.filePath)).toBe('10001.md');
    await store.appendFact(doc.id, { text: '喜欢喝冰美式', category: 'preference', weight: 0.8 });
    const markdown = await store.readDoc(doc.id);
    for (const section of MEMORY_SECTIONS) {
      expect(markdown).toContain('## ' + section);
    }
    expect(markdown).toContain('记忆 ID');
    expect(markdown).toContain('喜欢喝冰美式');
    expect(markdown).toContain('<!-- memory:data');
  });

  it('重新加载后事实、关系、经历、锚点完整保留（Markdown 往返）', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    await store.appendFact(doc.id, { text: '橘猫叫布丁', category: 'identity', weight: 0.9 });
    await store.updateRelationship(doc.id, { deltas: { affinity: 8 }, mood: '开心', note: '聊到猫' });
    await store.addEpisode(doc.id, {
      title: '一起看番',
      detail: '周末约好线上看番，结果两个人都睡着了。',
      at: daysAgo(2),
      anchors: ['说好一起看番的'],
    });
    await store.addAnchors(doc.id, ['布丁戴圈之后像个小台灯']);
    await store.appendEmotion(doc.id, { mood: '开心', valence: 0.7, arousal: 0.5, reason: '聊到猫' });
    await store.updateManualNote(doc.id, '用户手写的备注：别在早上九点前发消息。');
    expect(await store.readDoc(doc.id)).toContain('手写备注');

    const reloaded = await newStore(root);
    const doc2 = reloaded.getDoc(doc.id);
    expect(doc2).toBeDefined();
    expect(doc2?.facts.some((fact) => fact.text === '橘猫叫布丁')).toBe(true);
    expect(doc2?.relationship.affinity).toBeGreaterThan(50);
    expect(doc2?.relationship.notes).toContain('聊到猫');
    const extras = reloaded.getExtras(doc.id);
    expect(extras?.episodes[0]?.title).toBe('一起看番');
    expect(extras?.anchors).toContain('布丁戴圈之后像个小台灯');
    expect(extras?.emotionTrail.length).toBeGreaterThan(0);
    expect(extras?.manualNote).toBe('用户手写的备注：别在早上九点前发消息。');
  });

  it('可以解析用户手写的 Markdown 章节（无机器数据块时容错）', async () => {
    const root = await makeRoot();
    await fsp.mkdir(path.join(root, 'users'), { recursive: true });
    const manual = [
      '# 手写档案 · 记忆档案',
      '',
      '## 基本档案',
      '',
      '| 项目 | 内容 |',
      '| --- | --- |',
      '| 昵称 | 手写档案 |',
      '',
      '## 重要事实',
      '',
      '- `偏好` 喜欢喝茉莉花茶（权重 0.80 · 2026-01-01）',
      '',
      '## 记忆锚点',
      '',
      '- 「今天也要好好喝茶」',
      '',
    ].join('\n');
    await fsp.writeFile(path.join(root, 'users', '99999.md'), manual, 'utf8');
    const store = await newStore(root);
    const doc = store.getDoc(userDocId('99999'));
    expect(doc).toBeDefined();
    expect(doc?.displayName).toBe('手写档案');
    expect(doc?.facts).toHaveLength(1);
    expect(doc?.facts[0]?.category).toBe('preference');
    expect(doc?.facts[0]?.weight).toBeCloseTo(0.8, 2);
    expect(store.getExtras(userDocId('99999'))?.anchors).toContain('今天也要好好喝茶');
  });

  it('事实文本包含 --> 与反引号也能安全往返', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const doc = await store.ensureUserDoc({ userId: '10005', nickname: '测试', scene: 'private' });
    const weird = '喜欢说 "--> 箭头" 和 `反引号`，还有 | 竖线';
    await store.appendFact(doc.id, { text: weird, category: 'other', weight: 0.7 });
    const reloaded = await newStore(root);
    expect(reloaded.getDoc(doc.id)?.facts[0]?.text).toBe(weird);
  });
});

describe('联系人隔离', () => {
  it('不同联系人的文档、文件、上下文互不串场', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const a = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    const b = await store.ensureUserDoc({ userId: '10002', nickname: '阿柚', scene: 'private' });
    expect(a.filePath).not.toBe(b.filePath);
    await store.appendFact(a.id, { text: '星河的秘密暗号是蓝鲸七号', category: 'other', weight: 1 });
    await store.appendFact(b.id, { text: '阿柚喜欢芋泥波波奶茶', category: 'preference', weight: 0.8 });

    const manager = new ContextManager({ memoryStore: store, maxTokens: 64000, keepRecentMessages: 8 });
    const contextB = await manager.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '阿柚',
      userId: '10002',
      scene: 'private',
      recentMessages: [userMessage('你还记得我的暗号吗')],
      query: '蓝鲸七号',
    });
    const systemB = contextB.messages[0]?.content ?? '';
    expect(systemB).toContain('阿柚');
    expect(systemB).not.toContain('蓝鲸七号');
    expect(systemB).not.toContain('星河');
    expect(contextB.allowedDocIds).toEqual([GLOBAL_DOC_ID, userDocId('10002')]);

    const hitsB = await store.search('蓝鲸七号', { scene: 'private', userId: '10002' });
    expect(hitsB).toHaveLength(0);
    const hitsA = await store.search('蓝鲸七号', { scene: 'private', userId: '10001' });
    expect(hitsA.some((hit) => hit.docId === a.id)).toBe(true);
  });

  it('global 自我记忆对私聊和群聊都可见，但不含任何联系人隐私', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const globalDoc = await store.ensureGlobalDoc();
    await store.appendFact(globalDoc.id, { text: '鲸鲸最喜欢白米饭', category: 'preference', weight: 0.9 });
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    const manager = new ContextManager({ memoryStore: store, maxTokens: 64000, keepRecentMessages: 8 });
    const context = await manager.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '星河',
      userId: '10001',
      scene: 'private',
      recentMessages: [userMessage('晚上吃什么')],
      query: '白米饭',
    });
    expect(context.messages[0]?.content).toContain('鲸鲸最喜欢白米饭');
    expect(doc.id).not.toBe(globalDoc.id);
  });
});

describe('群成员隔离', () => {
  it('同一个 QQ 在不同群的记忆是不同文档、不同路径', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const memberA = await store.ensureUserDoc({
      userId: '10001',
      nickname: '星河',
      scene: 'group',
      groupId: '20001',
      groupName: '摸鱼研究所',
    });
    const memberB = await store.ensureUserDoc({
      userId: '10001',
      nickname: '星河',
      scene: 'group',
      groupId: '20002',
      groupName: '深夜烘焙群',
    });
    expect(memberA.id).not.toBe(memberB.id);
    expect(memberA.filePath).not.toBe(memberB.filePath);
    expect(memberA.filePath).toContain(path.join('groups', '20001', 'members'));
    expect(memberB.filePath).toContain(path.join('groups', '20002', 'members'));

    await store.appendFact(memberA.id, { text: '在摸鱼研究所是技术担当', category: 'other', weight: 0.8 });
    await store.appendFact(memberB.id, { text: '在烘焙群负责画翻车插画', category: 'other', weight: 0.8 });
    expect(store.getDoc(memberA.id)?.facts.map((fact) => fact.text)).not.toContain('在烘焙群负责画翻车插画');
    expect(store.getDoc(memberB.id)?.facts.map((fact) => fact.text)).not.toContain('在摸鱼研究所是技术担当');
  });

  it('群聊上下文只含 global + 当前群 + 当前发言人，绝不注入其他成员记忆', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const group = await store.ensureGroupDoc({ groupId: '20001', groupName: '摸鱼研究所' });
    const speaker = await store.ensureUserDoc({
      userId: '10001',
      nickname: '星河',
      scene: 'group',
      groupId: '20001',
      groupName: '摸鱼研究所',
    });
    const otherMember = await store.ensureUserDoc({
      userId: '10002',
      nickname: '阿柚',
      scene: 'group',
      groupId: '20001',
      groupName: '摸鱼研究所',
    });
    await store.appendFact(group.id, { text: '群规是每天十点摸鱼打卡', category: 'other', weight: 0.9 });
    await store.appendFact(speaker.id, { text: '星河在群里发猫片', category: 'preference', weight: 0.8 });
    await store.appendFact(otherMember.id, { text: '阿柚在群里的私密暗号是柚子汽水', category: 'other', weight: 1 });

    const manager = new ContextManager({ memoryStore: store, maxTokens: 64000, keepRecentMessages: 8 });
    const context = await manager.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '星河',
      userId: '10001',
      scene: 'group',
      groupId: '20001',
      groupName: '摸鱼研究所',
      recentMessages: [userMessage('今天摸鱼了吗')],
      query: '摸鱼打卡 柚子汽水',
    });
    const system = context.messages[0]?.content ?? '';
    expect(system).toContain('群规是每天十点摸鱼打卡');
    expect(system).toContain('星河在群里发猫片');
    expect(system).not.toContain('柚子汽水');
    expect(context.allowedDocIds).toEqual([GLOBAL_DOC_ID, group.id, speaker.id]);
    expect(context.allowedDocIds).not.toContain(otherMember.id);

    const outsiderHits = await store.search('柚子汽水', {
      scene: 'group',
      userId: '10001',
      groupId: '20001',
    });
    expect(outsiderHits).toHaveLength(0);
  });

  it('getGroupMembers 只返回当前群成员，并按好感度排序', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const groupA = '20001';
    const groupB = '20002';
    const a1 = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'group', groupId: groupA });
    const a2 = await store.ensureUserDoc({ userId: '10011', nickname: '杠精王', scene: 'group', groupId: groupA });
    const b1 = await store.ensureUserDoc({ userId: '10021', nickname: '团子', scene: 'group', groupId: groupB });
    await store.updateRelationship(a1.id, { set: { affinity: 80 }, touch: false });
    await store.updateRelationship(a2.id, { set: { affinity: 60 }, touch: false });
    await store.updateRelationship(b1.id, { set: { affinity: 90 }, touch: false });
    const membersA = await store.getGroupMembers(groupA);
    expect(membersA.map((doc) => doc.displayName)).toEqual(['星河', '杠精王']);
    expect(membersA.map((doc) => doc.id)).not.toContain(b1.id);
  });
});

describe('路径安全', () => {
  it('恶意的 userId / groupId 不会逃出记忆根目录，且重载后 id 稳定', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const evilUser = await store.ensureUserDoc({
      userId: '../../evil',
      nickname: '坏人',
      scene: 'private',
    });
    const relative = path.relative(root, evilUser.filePath);
    expect(relative.startsWith('..')).toBe(false);
    expect(path.isAbsolute(relative)).toBe(false);
    expect(path.basename(evilUser.filePath)).not.toContain('..');

    const evilMember = await store.ensureUserDoc({
      userId: '../../evil-user',
      nickname: '坏人2',
      scene: 'group',
      groupId: '../../evil-group',
      groupName: '坏群',
    });
    expect(path.relative(root, evilMember.filePath).startsWith('..')).toBe(false);

    await store.appendFact(evilUser.id, { text: '恶意路径测试事实', category: 'other' });
    const reloaded = await newStore(root);
    expect(reloaded.getDoc(evilUser.id)).toBeDefined();
    expect(reloaded.getDoc(evilUser.id)?.facts).toHaveLength(1);
    await expect(fsp.access(path.join(root, '..', 'evil.md'))).rejects.toThrow();
  });

  it('safeSegment 清洗非法字符、保留名与大小写碰撞；resolveInside 拒绝越界', async () => {
    expect(safeSegment('a/b')).not.toBe('a_b');
    expect(safeSegment('a/b')).not.toContain('/');
    expect(safeSegment('a:b')).not.toContain(':');
    expect(safeSegment('CON')).not.toBe('CON');
    expect(safeSegment('C:\\Windows\\System32')).not.toContain('\\');
    expect(safeSegment('')).toBeTruthy();
    expect(safeSegment('星河')).toBe('星河');
    expect(safeSegment('星河')).toBe(safeSegment('星河'));

    const root = await makeRoot();
    expect(resolveInside(root, 'users', '10001.md')).toContain(path.join(root, 'users'));
    expect(() => resolveInside(root, '..', 'evil.md')).toThrow();
    expect(() => resolveInside(root, path.join(root, '..', 'evil.md'))).toThrow();
  });
});

describe('事实、关系与摘要版本', () => {
  it('appendFact 去重、forgetFact 删除并持久化', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    const first = await store.appendFact(doc.id, { text: '喜欢喝冰美式', category: 'preference' });
    expect(first.status).toBe('added');
    const second = await store.appendFact(doc.id, { text: '喜欢喝冰美式', category: 'preference' });
    expect(second.status).not.toBe('added');
    expect((await store.getDoc(doc.id))?.facts).toHaveLength(1);

    const removed = await store.forgetFact(doc.id, '喜欢喝冰美式');
    expect(removed.removed).toBe(true);
    expect((await store.getDoc(doc.id))?.facts).toHaveLength(0);
    const reloaded = await newStore(root);
    expect(reloaded.getDoc(doc.id)?.facts).toHaveLength(0);
  });

  it('关系更新会 clamp 到 0..100 并累计互动次数', async () => {
    const store = await newStore(await makeRoot());
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    const updated = await store.updateRelationship(doc.id, {
      deltas: { affinity: 1000, trust: -1000 },
      mood: '开心',
      note: '第一次吵架后和好',
    });
    expect(updated.relationship.affinity).toBe(100);
    expect(updated.relationship.trust).toBe(0);
    expect(updated.relationship.interactions).toBe(1);
    expect(updated.relationship.lastMood).toBe('开心');
    expect(updated.relationship.notes).toContain('第一次吵架后和好');
  });

  it('摘要版本递增、可回溯，删除文档时一并清理摘要与归档', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    const archive = await store.archiveMessages(doc.id, [userMessage('原始消息一'), assistantMessage('原始消息二')]);
    const summary1 = await store.saveSummary(doc.id, {
      summary: '第一版摘要',
      archivedPath: archive.path,
      tokensBefore: 100,
      tokensAfter: 40,
      messageCount: 2,
      anchors: ['原话一'],
    });
    const summary2 = await store.saveSummary(doc.id, {
      summary: '第二版摘要',
      archivedPath: archive.path,
      tokensBefore: 120,
      tokensAfter: 45,
      messageCount: 3,
      anchors: ['原话二'],
    });
    expect(summary1.version).toBe(1);
    expect(summary2.version).toBe(2);
    expect((await store.getSummaryVersion(doc.id))).toBe(2);
    expect((await store.listSummaryVersions(doc.id)).map((item) => item.summary)).toEqual([
      '第一版摘要',
      '第二版摘要',
    ]);
    expect(await fsp.readFile(archive.path, 'utf8')).toContain('原始消息一');
    expect((await store.getDoc(doc.id))?.facts).toBeDefined();

    expect(await store.deleteDoc(doc.id)).toBe(true);
    expect(store.getDoc(doc.id)).toBeUndefined();
    await expect(fsp.access(doc.filePath)).rejects.toThrow();
    await expect(fsp.access(path.join(root, 'summaries', safeSegment(doc.id)))).rejects.toThrow();
  });

  it('多次写入后不残留临时文件（原子写）', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    for (let index = 0; index < 8; index += 1) {
      await store.appendFact(doc.id, { text: '第 ' + index + ' 条测试事实', category: 'other' });
    }
    const leftovers: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.tmp')) leftovers.push(full);
      }
    };
    await walk(root);
    expect(leftovers).toEqual([]);
  });
});

describe('检索评分与隔离', () => {
  it('中文 bigram 检索命中相关事实，且不返回其他用户/其他群文档', async () => {
    const store = await newStore(await makeRoot());
    const a = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    const b = await store.ensureUserDoc({ userId: '10002', nickname: '阿柚', scene: 'private' });
    await store.appendFacts(a.id, [
      { text: '周末喜欢去钱塘江边钓鱼，经常空军', category: 'preference', weight: 0.9 },
      { text: '最讨厌吃香菜', category: 'boundary', weight: 0.9 },
    ]);
    await store.appendFact(b.id, { text: '喜欢芋泥波波奶茶', category: 'preference' });

    const hits = await store.search('钓鱼空军', { scene: 'private', userId: '10001' });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.snippet).toContain('钓鱼');
    expect(hits.every((hit) => hit.docId === a.id || hit.docId === GLOBAL_DOC_ID)).toBe(true);
    expect(hits.some((hit) => hit.snippet.includes('奶茶'))).toBe(false);

    const crossHits = await store.search('钓鱼空军', { scene: 'private', userId: '10002' });
    expect(crossHits).toHaveLength(0);

    const emptyQueryHits = await store.search('', { scene: 'private', userId: '10001' });
    expect(emptyQueryHits.length).toBeGreaterThan(0);
  });

  it('时间衰减：同样内容，较新事实得分更高', async () => {
    const store = await newStore(await makeRoot());
    const fresh = await store.ensureUserDoc({ userId: '10002', nickname: '新朋友', scene: 'private' });
    const stale = await store.ensureUserDoc({ userId: '10003', nickname: '老朋友', scene: 'private' });
    await store.appendFact(fresh.id, {
      text: '喜欢在杭州西湖边夜跑',
      category: 'preference',
      weight: 0.9,
      createdAt: daysAgo(1),
    });
    await store.appendFact(stale.id, {
      text: '喜欢在杭州西湖边夜跑',
      category: 'preference',
      weight: 0.9,
      createdAt: daysAgo(800),
    });
    const hits = await store.search('西湖夜跑', {
      docIds: [fresh.id, stale.id],
      now: NOW,
      topK: 10,
    });
    expect(hits).toHaveLength(2);
    expect(hits[0]?.docId).toBe(fresh.id);
    expect((hits[0]?.score ?? 0)).toBeGreaterThan(hits[1]?.score ?? 0);
  });

  it('allowedMemoryDocIds 按场景给出精确白名单，群聊缺 groupId 直接报错', () => {
    expect(allowedMemoryDocIds({ userId: '10001', scene: 'private' })).toEqual([
      GLOBAL_DOC_ID,
      userDocId('10001'),
    ]);
    expect(allowedMemoryDocIds({ userId: '10001', scene: 'group', groupId: '20001' })).toEqual([
      GLOBAL_DOC_ID,
      groupDocId('20001'),
      memberDocId('20001', '10001'),
    ]);
    expect(() => allowedMemoryDocIds({ userId: '10001', scene: 'group' })).toThrow();
  });
});

describe('上下文压缩（细节保留）', () => {
  function makeLongMessages(): ContextInputMessage[] {
    const messages: ContextInputMessage[] = [];
    for (let index = 0; index < 24; index += 1) {
      messages.push(userMessage('第 ' + index + ' 轮：今天工作好累，想早点睡，明天还要开评审会。'));
      messages.push(assistantMessage('辛苦啦，第 ' + index + ' 轮也辛苦了，早点休息，鲸鲸会记得你明天有评审会。'));
    }
    messages.push(userMessage('对了，我下周要去杭州出差，住在西湖边，帮我记一下'));
    messages.push(assistantMessage('记住啦，下周杭州出差、住西湖边。'));
    return messages;
  }

  it('压缩会归档原始消息、保留原话锚点与事实，并生成版本化摘要', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    const messages = makeLongMessages();
    const llm: MemoryLlm = async () => fencedJson({
      summary: '这段对话主要在聊加班和评审会，最后用户提到下周要去杭州出差。',
      people: [{ name: '星河', relation: '朋友', traits: ['程序员', '容易累'] }],
      events: [{ at: '即将到来', what: '下周去杭州出差', detail: '住在西湖边', quote: '下周要去杭州出差' }],
      preferences: { likes: ['早睡'], dislikes: ['加班'] },
      promises: [{ content: '帮鲸鲸带杭州小笼包', deadline: '出差回来', status: '待完成' }],
      emotions: { tone: '疲惫但温和', changes: ['聊到最后变轻松'] },
      anchors: ['我下周要去杭州出差，住在西湖边', '明天还要开评审会'],
      facts: [{ text: '用户下周要去杭州出差，住在西湖边', category: 'event', weight: 0.8 }],
    });
    const manager = new ContextManager({
      memoryStore: store,
      maxTokens: 1000,
      compactAtPercent: 0.5,
      keepRecentMessages: 4,
      now: () => NOW,
    });
    const result = await manager.maybeCompact({ docId: doc.id, messages, llm });

    expect(result.compacted).toBe(true);
    expect(result.summary).toContain('杭州出差');
    expect(result.summary).toContain('原话锚点');
    expect(result.summary).toContain('我下周要去杭州出差');
    expect(result.anchors.length).toBeGreaterThan(0);
    expect(result.facts.length).toBeGreaterThan(0);
    expect(result.keptMessages).toHaveLength(4);
    expect(result.keptMessages[3]?.content).toContain('住西湖边');
    expect(result.tokensAfter).toBeLessThan(result.tokensBefore);
    expect(result.summaryVersion).toBe(1);

    const archived = JSON.parse(await fsp.readFile(result.archivedPath, 'utf8')) as {
      count: number;
      messages: { content: string }[];
    };
    expect(archived.count).toBe(messages.length);
    expect(archived.messages.some((message) => message.content.includes('西湖边'))).toBe(true);
    expect(archived.messages).toHaveLength(messages.length);

    // 事实与锚点回流到长期记忆文档，摘要版本写入 extras。
    const updatedDoc = store.getDoc(doc.id);
    expect(updatedDoc?.facts.some((fact) => fact.text.includes('杭州出差'))).toBe(true);
    expect(store.getExtras(doc.id)?.anchors).toContain('我下周要去杭州出差，住在西湖边');
    expect(store.getExtras(doc.id)?.summaryVersion).toBe(1);
    expect(store.getDoc(doc.id)?.messageCount).toBe(messages.length);

    // 第二次压缩 -> v2，可回溯。
    const second = await manager.maybeCompact({ docId: doc.id, messages, llm, force: true });
    expect(second.summaryVersion).toBe(2);
    expect((await store.listSummaryVersions(doc.id)).map((item) => item.version)).toEqual([1, 2]);
    expect(second.summaryPath).toBeTruthy();
  });

  it('LLM 返回非 JSON 时依然压缩：本地抽取原话锚点兜底，原始消息不丢', async () => {
    const store = await newStore(await makeRoot());
    const doc = await store.ensureUserDoc({ userId: '10002', nickname: '阿柚', scene: 'private' });
    const messages: ContextInputMessage[] = [];
    for (let index = 0; index < 20; index += 1) {
      messages.push(userMessage('画稿又改了第 ' + index + ' 遍，甲方说要五彩斑斓的黑。'));
      messages.push(assistantMessage('辛苦啦，先喝口芋泥波波奶茶。'));
    }
    messages.push(userMessage('记住我讨厌被催稿，催我我就躲起来。'));
    const llm: MemoryLlm = async () => '我不小心输出了非 JSON 的普通文本。';
    const manager = new ContextManager({
      memoryStore: store,
      maxTokens: 600,
      compactAtPercent: 0.5,
      keepRecentMessages: 2,
      now: () => NOW,
    });
    const result = await manager.maybeCompact({ docId: doc.id, messages, llm });
    expect(result.compacted).toBe(true);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.anchors.length).toBeGreaterThan(0);
    expect(result.facts).toHaveLength(0);
    const archived = JSON.parse(await fsp.readFile(result.archivedPath, 'utf8')) as { count: number };
    expect(archived.count).toBe(messages.length);
    expect(await store.getSummaryVersion(doc.id)).toBe(1);
  });

  it('未超预算且未 force 时不压缩，也不归档', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    const manager = new ContextManager({ memoryStore: store, maxTokens: 64000, keepRecentMessages: 8 });
    const messages = [userMessage('今天吃什么'), assistantMessage('白米饭！')];
    const result = await manager.maybeCompact({ docId: doc.id, messages, llm: async () => '{}' });
    expect(result.compacted).toBe(false);
    expect(result.archivedPath).toBe('');
    expect(result.keptMessages).toHaveLength(2);
    expect(await store.listSummaryVersions(doc.id)).toHaveLength(0);
  });

  it('压缩不会覆盖用户手动标记的事实（🔒）', async () => {
    const store = await newStore(await makeRoot());
    const doc = await store.ensureUserDoc({ userId: '10003', nickname: '老陈', scene: 'private' });
    await store.appendFact(doc.id, {
      text: '用户是回族人，不吃猪肉',
      category: 'identity',
      weight: 0.9,
      source: 'manual',
    });
    const messages: ContextInputMessage[] = [];
    for (let index = 0; index < 20; index += 1) {
      messages.push(userMessage('聊点别的吧，第 ' + index + ' 轮。'));
      messages.push(assistantMessage('好的，第 ' + index + ' 轮。'));
    }
    const llm: MemoryLlm = async () => JSON.stringify({
      summary: '聊天内容',
      anchors: ['聊点别的吧'],
      facts: [{ text: '用户是回族人，不吃猪肉', category: 'identity', weight: 1 }],
    });
    const manager = new ContextManager({
      memoryStore: store,
      maxTokens: 400,
      compactAtPercent: 0.5,
      keepRecentMessages: 2,
      now: () => NOW,
    });
    await manager.maybeCompact({ docId: doc.id, messages, llm });
    const manualFact = store.getDoc(doc.id)?.facts.find((fact) => fact.text.includes('回族人'));
    expect(manualFact).toBeDefined();
    expect(manualFact?.source).toBe('manual');
    expect(manualFact?.weight).toBe(0.9);
  });

  it('压缩后的 buildContext 会注入最近摘要，并标记 compacted', async () => {
    const store = await newStore(await makeRoot());
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    await store.saveSummary(doc.id, {
      summary: '早期对话摘要：用户下周去杭州出差。\n原话锚点：- 「西湖边」',
      archivedPath: '',
      tokensBefore: 500,
      tokensAfter: 100,
      messageCount: 10,
      anchors: ['西湖边'],
    });
    const manager = new ContextManager({
      memoryStore: store,
      maxTokens: 320,
      compactAtPercent: 0.5,
      keepRecentMessages: 2,
      memoryTopK: 3,
      now: () => NOW,
    });
    const recentMessages: ContextInputMessage[] = [];
    for (let index = 0; index < 12; index += 1) {
      recentMessages.push(userMessage('这是第 ' + index + ' 条很长很长很长很长的测试消息，用来把上下文撑爆。'));
      recentMessages.push(assistantMessage('收到第 ' + index + ' 条，鲸鲸记住了。'));
    }
    const context = await manager.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '星河',
      userId: '10001',
      scene: 'private',
      recentMessages,
      query: '杭州出差',
    });
    const system = context.messages[0]?.content ?? '';
    expect(system).toContain('历史对话摘要');
    expect(system).toContain('杭州出差');
    expect(context.compacted).toBe(true);
    expect(context.summaryVersion).toBe(1);
    expect(context.estimatedTokens).toBeLessThan(context.allowedDocIds.length + 320 * 2);
    expect(context.messages.length).toBeLessThan(recentMessages.length + 3);
  });
});

describe('记忆抽取（注入 LLM）', () => {
  it('容错解析代码围栏、嵌套 data、中文键与尾随逗号', () => {
    const nested = fencedJson({
      data: {
        facts: [{ text: '用户养了一只橘猫叫布丁', category: '偏好', weight: 0.8 }],
        episode: { title: '聊到猫', detail: '用户发了布丁的照片', anchors: ['布丁又胖了'] },
        relationshipDelta: { 好感: 2, 信任: 1 },
        emotion: { mood: '开心', valence: 0.8, reason: '聊到猫' },
      },
    });
    const parsed = normalizeExtraction(parseJsonLoose(nested));
    expect(parsed.facts[0]?.text).toBe('用户养了一只橘猫叫布丁');
    expect(parsed.facts[0]?.category).toBe('preference');
    expect(parsed.episode?.title).toBe('聊到猫');
    expect(parsed.episode?.anchors).toContain('布丁又胖了');
    expect(parsed.relationshipDelta.affinity).toBe(2);
    expect(parsed.emotion?.mood).toBe('开心');

    const loose = parseJsonLoose('好的，结果如下：{"facts":[{"text":"喜欢钓鱼",},],}');
    expect(Array.isArray((loose as { facts?: unknown }).facts)).toBe(true);
    expect(normalizeExtraction(parseJsonLoose('纯文本没有 JSON'))).toBeDefined();
  });

  it('MemoryExtractor 抽取并落库，合并去重且不覆盖手动事实', async () => {
    const store = await newStore(await makeRoot());
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '星河', scene: 'private' });
    await store.appendFact(doc.id, {
      text: '用户是回族人，不吃猪肉',
      category: 'identity',
      weight: 0.9,
      source: 'manual',
    });
    const llm: MemoryLlm = async () => JSON.stringify({
      facts: [
        { text: '用户是回族人，不吃猪肉', category: 'identity', weight: 1 },
        { text: '用户养了一只橘猫叫布丁', category: 'preference', weight: 0.85 },
        { text: '用户养了一只橘猫叫布丁', category: 'preference', weight: 0.9 },
      ],
      episode: { title: '聊猫', detail: '用户发了布丁的照片', anchors: ['布丁又胖了'] },
      relationshipDelta: { affinity: 2, trust: 1 },
      emotion: { mood: '开心', valence: 0.8, arousal: 0.5, reason: '聊到猫' },
    });
    const extractor = new MemoryExtractor(store, llm);
    const result = await extractor.run({
      docId: doc.id,
      scene: 'private',
      nickname: '星河',
      messages: [userMessage('布丁又胖了'), assistantMessage('橘猫就是这样')],
    });
    expect(result.apply).toBeDefined();
    expect(result.apply?.addedFacts).toHaveLength(1);
    expect(result.apply?.skippedFacts.length).toBeGreaterThanOrEqual(1);
    expect(result.apply?.episode?.title).toBe('聊猫');

    const facts = store.getDoc(doc.id)?.facts ?? [];
    expect(facts.some((fact) => fact.text === '用户养了一只橘猫叫布丁')).toBe(true);
    const manual = facts.find((fact) => fact.text.includes('回族人'));
    expect(manual?.source).toBe('manual');
    expect(manual?.weight).toBe(0.9);
    expect(store.getDoc(doc.id)?.relationship.affinity).toBeGreaterThan(50);
    expect(store.getExtras(doc.id)?.anchors).toContain('布丁又胖了');
  });

  it('normalizeCompactionPayload 在没有 summary 时用结构化字段拼出详情', () => {
    const payload = normalizeCompactionPayload({
      people: [{ name: '阿柚', relation: '画师', traits: ['社恐'] }],
      events: [{ at: '昨天', what: '交了草图', detail: '选了抱饭团那张', quote: '你果然会挑' }],
      preferences: { likes: ['芋泥波波奶茶'], dislikes: ['催稿'] },
      promises: [{ content: '画头像', deadline: '月底', status: '进行中' }],
      emotions: { tone: '开心' },
      anchors: ['你果然会挑'],
    });
    expect(payload.summary).toContain('阿柚');
    expect(payload.summary).toContain('交了草图');
    expect(payload.summary).toContain('芋泥波波奶茶');
    expect(payload.summary).toContain('画头像');
    expect(payload.summary).toContain('原话锚点');
    expect(payload.anchors).toContain('你果然会挑');
  });
});

describe('演示数据与聚合服务', () => {
  it('seedDemoMemory 生成 3 联系人和 2 个群，内容不覆盖已有文档', async () => {
    const root = await makeRoot();
    const store = await newStore(root);
    const existing = await store.ensureUserDoc({ userId: '10001', nickname: '我自己的星河', scene: 'private' });
    await store.appendFact(existing.id, { text: '这是用户自己的真实记忆', category: 'other' });

    const result = await seedDemoMemory(root, { store, now: NOW });
    expect(result.created.length).toBeGreaterThan(0);
    expect(result.skipped).toContain(userDocId('10001'));
    expect(result.summary.stats.users).toBe(9);
    expect(result.summary.stats.groups).toBe(2);
    expect(result.summary.stats.facts).toBeGreaterThan(50);
    const groupNames = result.summary.groups.map((group) => group.name);
    expect(groupNames).toContain('深海摸鱼群');
    expect(groupNames).toContain('前端互助会');

    const kept = store.getDoc(userDocId('10001'));
    expect(kept?.facts.some((fact) => fact.text === '这是用户自己的真实记忆')).toBe(true);
    expect(kept?.displayName).toBe('我自己的星河');

    const ids = new Set(result.created);
    expect(ids.has(userDocId('10002'))).toBe(true);
    expect(ids.has(userDocId('10003'))).toBe(true);
    expect(ids.has(groupDocId('20001'))).toBe(true);
    expect(ids.has(groupDocId('20002'))).toBe(true);
    expect(ids.has(memberDocId('20001', '10001'))).toBe(true);
    expect(ids.has(memberDocId('20002', '10002'))).toBe(true);

    const again = await seedDemoMemory(root, { store, now: NOW });
    expect(again.created).toHaveLength(0);
    expect(again.skipped.length).toBe(result.created.length + result.skipped.length);
  });

  it('演示数据里同一个 QQ 的私聊记忆与群成员记忆互不串场', async () => {
    const root = await makeRoot();
    const result = await seedDemoMemory(root, { now: NOW });
    const store = await newStore(root);
    const privateDoc = store.getDoc(userDocId('10001'));
    const groupMemberDoc = store.getDoc(memberDocId('20001', '10001'));
    expect(privateDoc).toBeDefined();
    expect(groupMemberDoc).toBeDefined();
    expect(privateDoc?.id).not.toBe(groupMemberDoc?.id);
    const privateTexts = (privateDoc?.facts ?? []).map((fact) => fact.text).join('|');
    const memberTexts = (groupMemberDoc?.facts ?? []).map((fact) => fact.text).join('|');
    expect(privateTexts).toContain('布丁');
    expect(memberTexts).not.toContain('每天上午十点');

    const privateHits = await store.search('落地成盒', { scene: 'private', userId: '10001' });
    expect(privateHits.every((hit) => hit.docId !== groupMemberDoc?.id)).toBe(true);
    const memberHits = await store.search('落地成盒', {
      scene: 'group',
      userId: '10001',
      groupId: '20001',
    });
    expect(memberHits.some((hit) => hit.docId === groupMemberDoc?.id)).toBe(true);
    expect(result.summary.stats.docs).toBe(12);
  });

  it('createMemoryService 聚合 buildContext / remember / search / readDoc / getSummary', async () => {
    const root = await makeRoot();
    const llm: MemoryLlm = async () => JSON.stringify({
      facts: [{ text: '用户喜欢喝冰美式', category: 'preference', weight: 0.8 }],
      relationshipDelta: { affinity: 1 },
      emotion: { mood: '轻松', valence: 0.4, arousal: 0.3, reason: '闲聊' },
    });
    const service = await createMemoryService({
      rootDir: root,
      llm,
      settings: { maxContextTokens: 4096, keepRecentMessages: 4, autoMemoryExtraction: true },
      now: () => NOW,
    });
    const docs = await service.ensureConversationMemory({
      userId: '10001',
      nickname: '星河',
      scene: 'private',
    });
    expect(docs.primaryDocId).toBe(userDocId('10001'));

    const remembered = await service.remember({
      docId: docs.primaryDocId,
      messages: [userMessage('最近只喝冰美式'), assistantMessage('好喝吗')],
    });
    expect(remembered.apply?.addedFacts.length).toBe(1);

    const context = await service.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '星河',
      userId: '10001',
      scene: 'private',
      recentMessages: [userMessage('我喝什么咖啡来着')],
      query: '冰美式',
    });
    expect(context.memoryHits).toBeGreaterThan(0);
    expect(context.messages[0]?.content).toContain('冰美式');

    const hits = await service.search('冰美式', { scene: 'private', userId: '10001' });
    expect(hits.some((hit) => hit.snippet.includes('冰美式'))).toBe(true);

    const read = await service.readDoc(docs.primaryDocId);
    expect(read.markdown).toContain('重要事实');
    expect(read.path.startsWith(root)).toBe(true);

    const summary = await service.getSummary();
    expect(summary.stats.users).toBe(1);
    expect(summary.stats.facts).toBeGreaterThan(0);

    const compacted = await service.maybeCompact({
      docId: docs.primaryDocId,
      messages: Array.from({ length: 20 }, (_, index) => userMessage('第 ' + index + ' 条消息，内容比较长一点。')),
      maxTokens: 400,
      force: true,
    });
    expect(compacted.compacted).toBe(true);
    expect(compacted.summaryVersion).toBe(1);
    expect(estimateTokens('鲸鲸最喜欢白米饭')).toBeGreaterThan(0);
  });
});
