// 人设隔离：MemoryStore / MemoryService 切换记忆根目录。
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createMemoryService,
  MemoryStore,
  userDocId,
  type MemoryLlm,
} from '../electron/services/memory/index';

const tempRoots: string[] = [];

async function makeRoot(label: string): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'jingjing-memory-root-' + label + '-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await fsp.rm(root, { recursive: true, force: true });
  }
});

async function exists(target: string): Promise<boolean> {
  return fsp.access(target).then(() => true).catch(() => false);
}

function userMessage(text: string): { role: 'user'; content: string } {
  return { role: 'user', content: text };
}

describe('MemoryStore.switchRoot', () => {
  it('切根后索引清空，切回原根后原记忆仍在，数据按根完全隔离', async () => {
    const rootA = await makeRoot('a');
    const rootB = await makeRoot('b');
    const store = new MemoryStore({ rootDir: rootA });
    await store.init();

    const docA = await store.ensureUserDoc({ userId: '10001', nickname: '阿澈', scene: 'private' });
    await store.appendFact(docA.id, { text: '阿澈讨厌别人碰他的键盘', category: 'boundary', weight: 0.9 });
    expect(store.rootDir).toBe(path.resolve(rootA));
    expect(store.listDocs()).toHaveLength(1);

    await store.switchRoot(rootB);
    expect(store.rootDir).toBe(path.resolve(rootB));
    expect(store.listDocs()).toHaveLength(0);
    expect(store.getDoc(docA.id)).toBeUndefined();
    await expect(store.readDoc(docA.id)).rejects.toThrow();

    const docB = await store.ensureUserDoc({ userId: '10002', nickname: '小满', scene: 'private' });
    await store.appendFact(docB.id, { text: '小满正在准备面试', category: 'identity', weight: 0.8 });
    expect(store.listDocs()).toHaveLength(1);
    expect(await exists(path.join(rootB, 'users', '10002.md'))).toBe(true);
    expect(await exists(path.join(rootA, 'users', '10002.md'))).toBe(false);
    expect(await store.readDoc(docB.id)).toContain('小满正在准备面试');

    await store.switchRoot(rootA);
    expect(store.listDocs()).toHaveLength(1);
    expect(store.getDoc(docA.id)?.facts.some((fact) => fact.text.includes('键盘'))).toBe(true);
    expect(store.getDoc(docB.id)).toBeUndefined();
    expect(await exists(path.join(rootA, 'users', '10002.md'))).toBe(false);
  });

  it('切根后旧的 MemoryDoc 快照不能写回新根', async () => {
    const rootA = await makeRoot('a');
    const rootB = await makeRoot('b');
    const store = new MemoryStore({ rootDir: rootA });
    await store.init();
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '阿澈', scene: 'private' });
    await store.appendFact(doc.id, { text: '旧根记忆', category: 'other' });
    const staleDoc = store.getDoc(doc.id);
    expect(staleDoc).toBeDefined();

    await store.switchRoot(rootB);
    await expect(store.saveDoc(staleDoc!)).rejects.toThrow();
    const oldMarkdown = await fsp.readFile(path.join(rootA, 'users', '10001.md'), 'utf8');
    expect(oldMarkdown).toContain('旧根记忆');
    expect(store.listDocs()).toHaveLength(0);
  });

  it('切到相同根目录保持数据不变，不产生重复', async () => {
    const rootA = await makeRoot('a');
    const store = new MemoryStore({ rootDir: rootA });
    await store.init();
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '阿澈', scene: 'private' });
    await store.appendFact(doc.id, { text: '同根切换仍应保留', category: 'other', weight: 0.7 });

    await store.switchRoot(rootA);
    expect(store.listDocs()).toHaveLength(1);
    expect(store.getDoc(doc.id)?.facts).toHaveLength(1);
    expect(path.resolve(store.rootDir)).toBe(path.resolve(rootA));
  });

  it('init/close 在切根后照常工作，另一个 store 实例能从磁盘恢复各根数据', async () => {
    const rootA = await makeRoot('a');
    const rootB = await makeRoot('b');
    const store = new MemoryStore({ rootDir: rootA });
    await store.init();
    const docA = await store.ensureUserDoc({ userId: '10001', nickname: '阿澈', scene: 'private' });
    await store.appendFact(docA.id, { text: 'A 根记忆', category: 'other' });

    await store.switchRoot(rootB);
    await store.close();
    await store.init();
    const docB = await store.ensureUserDoc({ userId: '10002', nickname: '小满', scene: 'private' });
    await store.appendFact(docB.id, { text: 'B 根记忆', category: 'other' });
    await store.close();
    await store.switchRoot(rootA);
    await store.close();

    const reopenedA = new MemoryStore({ rootDir: rootA });
    await reopenedA.init();
    expect(reopenedA.getDoc(docA.id)?.facts.map((fact) => fact.text)).toContain('A 根记忆');
    expect(reopenedA.getDoc(docB.id)).toBeUndefined();

    const reopenedB = new MemoryStore({ rootDir: rootB });
    await reopenedB.init();
    expect(reopenedB.getDoc(docB.id)?.facts.map((fact) => fact.text)).toContain('B 根记忆');
    expect(reopenedB.getDoc(docA.id)).toBeUndefined();
  });

  it('切换与并发写不产生竞态：旧根文件完整、新根可继续写', async () => {
    const rootA = await makeRoot('a');
    const rootB = await makeRoot('b');
    const store = new MemoryStore({ rootDir: rootA });
    await store.init();
    const doc = await store.ensureUserDoc({ userId: '10001', nickname: '阿澈', scene: 'private' });

    const write = store.appendFact(doc.id, { text: '并发期间写入的事实', category: 'other' });
    const switching = store.switchRoot(rootB);
    const settled = await Promise.allSettled([write, switching]);
    expect(settled[1]?.status).toBe('fulfilled');
    expect(store.rootDir).toBe(path.resolve(rootB));

    // 旧根 Markdown 仍是完整可解析的文档（哪怕并发写被切根拦住，也不会写坏旧根）。
    const reopenedA = new MemoryStore({ rootDir: rootA });
    await reopenedA.init();
    expect(reopenedA.getDoc(doc.id)).toBeDefined();
    const oldMarkdown = await fsp.readFile(path.join(rootA, 'users', '10001.md'), 'utf8');
    expect(oldMarkdown).toContain('## 基本档案');
    expect(oldMarkdown).toContain('<!-- memory:data');

    // 切换后继续写只会落在新根。
    const docB = await store.ensureUserDoc({ userId: '10002', nickname: '小满', scene: 'private' });
    await store.appendFact(docB.id, { text: '切根后的新事实', category: 'other' });
    expect(store.listDocs()).toHaveLength(1);
    expect(await exists(path.join(rootB, 'users', '10002.md'))).toBe(true);
    expect(await exists(path.join(rootA, 'users', '10002.md'))).toBe(false);
    expect(oldMarkdown).not.toContain('切根后的新事实');
  });
});

describe('MemoryService.switchRoot', () => {
  it('切根后 buildContext/search 不再读取旧根，写入也只落新根', async () => {
    const rootA = await makeRoot('a');
    const rootB = await makeRoot('b');
    const service = await createMemoryService({ rootDir: rootA });

    const docsA = await service.ensureConversationMemory({ userId: '10001', nickname: '阿澈', scene: 'private' });
    await service.store.appendFact(docsA.userDoc.id, {
      text: '阿澈的秘密暗号是蓝鲸七号',
      category: 'other',
      weight: 1,
    });
    const contextA = await service.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      recentMessages: [userMessage('你还记得我的暗号吗')],
      query: '蓝鲸七号',
    });
    expect(contextA.messages[0]?.content).toContain('蓝鲸七号');
    expect((await service.search('蓝鲸七号', { scene: 'private', userId: '10001' })).length).toBeGreaterThan(0);

    await service.switchRoot(rootB);
    expect(path.resolve(service.rootDir)).toBe(path.resolve(rootB));
    expect(service.listDocs()).toHaveLength(0);
    expect(service.store.getDoc(userDocId('10001'))).toBeUndefined();

    const contextB = await service.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      recentMessages: [userMessage('你还记得我的暗号吗')],
      query: '蓝鲸七号',
    });
    expect(contextB.messages[0]?.content).not.toContain('蓝鲸七号');
    expect(await service.search('蓝鲸七号', { scene: 'private', userId: '10001' })).toHaveLength(0);

    // 新根重新建立文档并写入，只落新根。
    const docsB = await service.ensureConversationMemory({ userId: '10001', nickname: '阿澈', scene: 'private' });
    await service.store.appendFact(docsB.userDoc.id, {
      text: '切根后写入的新记忆',
      category: 'other',
      weight: 0.8,
    });
    const contextB2 = await service.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      recentMessages: [userMessage('刚才说了什么')],
      query: '切根后写入',
    });
    expect(contextB2.messages[0]?.content).toContain('切根后写入的新记忆');
    expect(await exists(path.join(rootB, 'users', '10001.md'))).toBe(true);

    const oldMarkdown = await fsp.readFile(path.join(rootA, 'users', '10001.md'), 'utf8');
    expect(oldMarkdown).toContain('蓝鲸七号');
    expect(oldMarkdown).not.toContain('切根后写入的新记忆');

    // 切回 A：旧记忆回来，B 的新记忆不可见。
    await service.switchRoot(rootA);
    expect(service.store.getDoc(userDocId('10001'))?.facts.some((fact) => fact.text.includes('蓝鲸七号'))).toBe(true);
    expect(await service.search('切根后写入', { scene: 'private', userId: '10001' })).toHaveLength(0);
  });

  it('切根后 retriever/context/extractor 复用同一 store：remember 与检索只作用于新根', async () => {
    const rootA = await makeRoot('a');
    const rootB = await makeRoot('b');
    const llm: MemoryLlm = async () => JSON.stringify({
      facts: [{ text: '用户喜欢喝冰美式', category: 'preference', weight: 0.8 }],
      relationshipDelta: { affinity: 1 },
    });
    const service = await createMemoryService({
      rootDir: rootA,
      llm,
      settings: { autoMemoryExtraction: true },
    });
    await service.switchRoot(rootB);
    const docs = await service.ensureConversationMemory({ userId: '10001', nickname: '阿澈', scene: 'private' });
    const remembered = await service.remember({
      docId: docs.userDoc.id,
      scene: 'private',
      messages: [
        userMessage('最近只喝冰美式'),
        { role: 'assistant', content: '好喝吗' },
      ],
    });
    expect(remembered.apply?.addedFacts.length).toBe(1);
    expect(await exists(path.join(rootB, 'users', '10001.md'))).toBe(true);
    expect(await exists(path.join(rootA, 'users', '10001.md'))).toBe(false);

    const context = await service.buildContext({
      personaPrompt: '你是鲸鲸',
      userName: '阿澈',
      userId: '10001',
      scene: 'private',
      recentMessages: [userMessage('我喝什么咖啡来着')],
      query: '冰美式',
    });
    expect(context.messages[0]?.content).toContain('冰美式');
    expect(service.searchSnippets('冰美式', { scene: 'private', userId: '10001' }).length).toBeGreaterThan(0);

    // 切回空根 A：抽取器/检索器都不会看到 B 的数据。
    await service.switchRoot(rootA);
    expect(service.listDocs()).toHaveLength(0);
    expect(await service.search('冰美式', { scene: 'private', userId: '10001' })).toHaveLength(0);
  });

  it('createMemoryService 仍从指定根初始化；切根不影响 close', async () => {
    const rootA = await makeRoot('a');
    const rootB = await makeRoot('b');
    const service = await createMemoryService({ rootDir: rootA });
    const docsA = await service.ensureConversationMemory({ userId: '10001', nickname: '阿澈', scene: 'private' });
    expect(service.rootDir).toBe(path.resolve(rootA));
    expect(service.listDocs().length).toBeGreaterThan(0);
    expect(service.store.getDoc(docsA.userDoc.id)).toBeDefined();

    await service.switchRoot(rootB);
    expect(service.rootDir).toBe(path.resolve(rootB));
    expect(service.listDocs()).toHaveLength(0);
    await service.close();
    // close 之后仍可继续使用（close 只等待写入链落盘）。
    const docsB = await service.ensureConversationMemory({ userId: '10002', nickname: '小满', scene: 'private' });
    await service.store.appendFact(docsB.userDoc.id, { text: 'close 之后的新记忆', category: 'other' });
    expect(service.store.getDoc(docsB.userDoc.id)?.facts.length).toBe(1);
    await service.close();
  });
});
