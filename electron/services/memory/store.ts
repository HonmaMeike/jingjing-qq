// MemoryStore：按联系人 / 群彻底隔离的 Markdown 记忆库。
//
// 存储布局（见 paths.ts）：
//   users/<safeQQ>.md                 私聊联系人
//   groups/<safeGroupId>/group.md     群记忆
//   groups/<safeGroupId>/members/<safeQQ>.md  群内成员记忆（不同群同 QQ 独立）
//   global/self.md                    全局自我记忆
//   summaries/<docId>/<timestamp>.json 版本化压缩摘要
//   archive/<docId>/<timestamp>.json   原始消息归档（只增不删）
//
// 所有写入都是「临时文件 + fsync + rename」的原子写；所有路径都经过 paths.ts 安全化。
import type { Dirent } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  appendEmotionPoint as appendEmotionToExtras,
  addAnchors as appendAnchorsToExtras,
  addEpisode as appendEpisodeToExtras,
  applyRelationshipUpdate,
  mergeFact,
  mergeFacts,
  normalizeExtras,
  type MergeFactsOptions,
} from './docops';
import {
  archiveDir,
  archiveFilePath,
  docIdFor,
  globalDocPath,
  groupDocPath,
  groupDocId,
  isInside,
  memberDocPath,
  safeSegment,
  summariesDir,
  summaryFilePath,
  userDocPath,
} from './paths';
import {
  atomicWriteFile,
  ensureDir,
  fileSizeIfExists,
  fileTimestamp,
  isErrno,
  readTextIfExists,
  removeIfExists,
  sha1Short,
  walkFiles,
} from './fsutil';
import { buildPreview, emptyExtras, emptyRelationship, parseMemoryMarkdown, renderMemoryMarkdown, type ParseFallback } from './markdown';
import { MemoryRetriever } from './retriever';
import { normalizeLine, normalizeText, toIso } from './time';
import {
  GLOBAL_DOC_ID,
  MemoryError,
  PathSafetyError,
} from './types';
import type {
  AppendFactsResult,
  ArchiveResult,
  ArchivedMessage,
  ContextInputMessage,
  EnsureGroupDocInput,
  EnsureUserDocInput,
  EpisodeInput,
  EmotionInput,
  FactInput,
  FactMergeOutcome,
  ListDocsFilter,
  MemoryDoc,
  MemoryDocExtras,
  MemoryEpisode,
  MemoryFact,
  MemoryScene,
  MemoryScopeKind,
  MemorySearchHit,
  MemoryStats,
  MemorySummary,
  RelationshipState,
  RelationshipUpdate,
  RetrieveOptions,
  SummarySaveInput,
  SummaryVersion,
} from './types';

export interface MemoryStoreOptionsResolved {
  rootDir: string;
  platform: string;
  maxDocBytes: number;
}

export interface AppendFactResult extends FactMergeOutcome {
  doc: MemoryDoc;
}

export interface ForgetFactResult {
  removed: boolean;
  fact?: MemoryFact;
  doc: MemoryDoc;
}

export interface ReadMemoryDocResult {
  doc: MemoryDoc;
  markdown: string;
  path: string;
}

const MD_EXTENSION = '.md';

export class MemoryStore {
  /** 当前记忆根目录；人设切换时由 switchRoot 修改（读取方仍可直接 store.rootDir）。 */
  rootDir: string;
  readonly platform: string;
  private readonly maxDocBytes: number;
  private readonly docs = new Map<string, MemoryDoc>();
  private readonly extras = new Map<string, MemoryDocExtras>();
  private readonly summaryVersions = new Map<string, number>();
  private readonly retriever: MemoryRetriever;
  private initPromise: Promise<void> | undefined;
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(options: { rootDir: string; platform?: string; maxDocBytes?: number }) {
    if (!options || !options.rootDir) {
      throw new MemoryError('invalid_root', 'MemoryStore 需要 rootDir');
    }
    this.rootDir = path.resolve(options.rootDir);
    this.platform = options.platform ?? process.platform;
    this.maxDocBytes = options.maxDocBytes ?? 512 * 1024;
    this.retriever = new MemoryRetriever(this);
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    const pending = this.initPromise;
    if (pending) return pending;
    const created = this.enqueue(() => this.doInit()).catch((error: unknown) => {
      this.initPromise = undefined;
      throw error;
    });
    this.initPromise = created;
    return created;
  }

  async close(): Promise<void> {
    await this.waitForWrites();
  }

  /**
   * 切换记忆根目录（人设隔离用）。
   *
   * 顺序与竞态：
   * 1. 先 await waitForWrites()，让切换前已排队的写全部落盘；
   * 2. 在写链上执行「换 rootDir + 清空索引 + 重新 doInit」，因此与并发写严格串行：
   *    切换前排队的写完成在旧根，切换后排队的写只会落在新根；
   * 3. initPromise 指向切换任务，切换期间调用 init()/ready() 会等待切换完成，
   *    不会读到旧根的索引；doInit 失败时重置 initPromise，允许下次重试。
   * 写入链本身不重建、不丢弃，后续写仍按顺序执行。
   */
  async switchRoot(rootDir: string): Promise<void> {
    const nextRoot = path.resolve(rootDir);
    await this.waitForWrites();
    const switching = this.enqueue(async () => {
      this.rootDir = nextRoot;
      this.docs.clear();
      this.extras.clear();
      this.summaryVersions.clear();
      await this.doInit();
    });
    const guarded = switching.catch((error: unknown) => {
      this.initPromise = undefined;
      throw error;
    });
    this.initPromise = guarded;
    await guarded;
  }

  private async ready(): Promise<void> {
    await this.init();
  }

  private async waitForWrites(): Promise<void> {
    await this.writeChain;
  }

  /** 串行化所有写操作，避免并发读改写丢失更新。 */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(operation, operation);
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async doInit(): Promise<void> {
    await ensureDir(this.rootDir);
    await ensureDir(path.join(this.rootDir, 'users'));
    await ensureDir(path.join(this.rootDir, 'groups'));
    await ensureDir(path.join(this.rootDir, 'global'));
    await ensureDir(path.join(this.rootDir, 'summaries'));
    await ensureDir(path.join(this.rootDir, 'archive'));

    this.docs.clear();
    this.extras.clear();
    this.summaryVersions.clear();

    const markdownFiles = (await walkFiles(this.rootDir)).filter((file) =>
      file.toLowerCase().endsWith(MD_EXTENSION),
    );
    for (const file of markdownFiles) {
      await this.loadFromDisk(file);
    }
    await this.preloadSummaryVersions();
  }

  private async preloadSummaryVersions(): Promise<void> {
    const root = path.join(this.rootDir, 'summaries');
    let entries: Dirent[] = [];
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) throw error;
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const versions = await this.readSummaryFiles(entry.name);
      const maxVersion = versions.reduce((max, item) => Math.max(max, item.version), 0);
      this.summaryVersions.set(entry.name, maxVersion);
    }
  }

  private async loadFromDisk(filePath: string): Promise<void> {
    const relative = path.relative(this.rootDir, filePath);
    const parts = relative.split(path.sep);
    let scope: MemoryScopeKind;
    let externalId: string;
    let scene: MemoryScene;
    let groupId: string | undefined;
    if (parts[0] === 'users' && parts.length === 2) {
      scope = 'user';
      scene = 'private';
      externalId = stripMarkdownExtension(parts[1] as string);
    } else if (parts[0] === 'groups' && parts.length === 3 && parts[2] === 'group.md') {
      scope = 'group';
      scene = 'group';
      groupId = parts[1] as string;
      externalId = groupId;
    } else if (parts[0] === 'groups' && parts.length === 4 && parts[2] === 'members') {
      scope = 'user';
      scene = 'group';
      groupId = parts[1] as string;
      externalId = stripMarkdownExtension(parts[3] as string);
    } else if (parts[0] === 'global' && parts.length === 2 && parts[1] === 'self.md') {
      scope = 'global';
      scene = 'global';
      externalId = 'self';
    } else {
      // 不是记忆文档（例如用户放的 README），忽略。
      return;
    }
    const id = docIdFor(scope, externalId, groupId, this.platform);
    const markdown = await readTextIfExists(filePath);
    if (markdown === undefined) return;
    const fallback: ParseFallback = { id, scope, externalId, scene, groupId };
    const parsed = parseMemoryMarkdown(markdown, filePath, fallback);
    if (!parsed) return;
    const doc = parsed.doc;
    // 以路径推导的 id 为准，防止手改文件里的 id 造成串档。
    doc.id = id;
    doc.filePath = filePath;
    this.docs.set(id, doc);
    this.extras.set(id, parsed.extras);
  }

  // -------------------------------------------------------------------------
  // 文档创建与读取
  // -------------------------------------------------------------------------

  async ensureUserDoc(input: EnsureUserDocInput): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      const userId = normalizeLine(input.userId, 128);
      if (!userId) throw new MemoryError('invalid_user', 'userId 不能为空');
      const nickname = normalizeLine(input.nickname, 120) || 'QQ ' + userId;
      const isGroup = input.scene === 'group';
      const groupId = isGroup ? normalizeLine(input.groupId ?? '', 128) : '';
      if (isGroup && !groupId) {
        throw new MemoryError('missing_group', '群聊记忆必须提供 groupId');
      }
      const scene: MemoryScene = isGroup ? 'group' : 'private';
      const id = docIdFor('user', userId, isGroup ? groupId : undefined, this.platform);
      const existing = this.docs.get(id);
      if (existing) {
        let changed = false;
        if (existing.displayName !== nickname) {
          existing.displayName = nickname;
          changed = true;
        }
        if (input.avatar && existing.avatar !== input.avatar) {
          existing.avatar = input.avatar;
          changed = true;
        }
        if (isGroup && input.groupName && existing.groupName !== input.groupName) {
          existing.groupName = input.groupName;
          changed = true;
        }
        if (changed) {
          existing.updatedAt = toIso();
          await this.writeDoc(id);
        }
        return cloneDoc(existing);
      }
      const now = new Date();
      const filePath = isGroup
        ? memberDocPath(this.rootDir, groupId, userId, this.platform)
        : userDocPath(this.rootDir, userId, this.platform);
      const doc: MemoryDoc = {
        id,
        scope: 'user',
        externalId: userId,
        displayName: nickname,
        scene,
        filePath,
        createdAt: toIso(now),
        updatedAt: toIso(now),
        facts: [],
        relationship: emptyRelationship(now),
        tags: [],
        preview: '',
        messageCount: 0,
        episodeCount: 0,
      };
      if (input.avatar) doc.avatar = input.avatar;
      if (isGroup) {
        doc.groupId = groupId;
        if (input.groupName) doc.groupName = input.groupName;
      }
      this.docs.set(id, doc);
      this.extras.set(id, emptyExtras());
      await this.writeDoc(id);
      return cloneDoc(doc);
    });
  }

  async ensureGroupDoc(input: EnsureGroupDocInput): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      const groupId = normalizeLine(input.groupId, 128);
      if (!groupId) throw new MemoryError('invalid_group', 'groupId 不能为空');
      const groupName = normalizeLine(input.groupName, 120) || '群 ' + groupId;
      const id = groupDocId(groupId, this.platform);
      const existing = this.docs.get(id);
      if (existing) {
        let changed = false;
        if (existing.displayName !== groupName) {
          existing.displayName = groupName;
          changed = true;
        }
        if (input.avatar && existing.avatar !== input.avatar) {
          existing.avatar = input.avatar;
          changed = true;
        }
        if (changed) {
          existing.updatedAt = toIso();
          await this.writeDoc(id);
        }
        return cloneDoc(existing);
      }
      const now = new Date();
      const filePath = groupDocPath(this.rootDir, groupId, this.platform);
      const doc: MemoryDoc = {
        id,
        scope: 'group',
        externalId: groupId,
        displayName: groupName,
        scene: 'group',
        filePath,
        createdAt: toIso(now),
        updatedAt: toIso(now),
        facts: [],
        relationship: emptyRelationship(now),
        tags: [],
        preview: '',
        messageCount: 0,
        episodeCount: 0,
      };
      if (input.avatar) doc.avatar = input.avatar;
      this.docs.set(id, doc);
      this.extras.set(id, emptyExtras());
      await this.writeDoc(id);
      return cloneDoc(doc);
    });
  }

  async ensureGlobalDoc(): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      const existing = this.docs.get(GLOBAL_DOC_ID);
      if (existing) return cloneDoc(existing);
      const now = new Date();
      const doc: MemoryDoc = {
        id: GLOBAL_DOC_ID,
        scope: 'global',
        externalId: 'self',
        displayName: '鲸鲸的自我记忆',
        scene: 'global',
        filePath: globalDocPath(this.rootDir),
        createdAt: toIso(now),
        updatedAt: toIso(now),
        facts: [],
        relationship: emptyRelationship(now),
        tags: [],
        preview: '',
        messageCount: 0,
        episodeCount: 0,
      };
      this.docs.set(GLOBAL_DOC_ID, doc);
      this.extras.set(GLOBAL_DOC_ID, emptyExtras());
      await this.writeDoc(GLOBAL_DOC_ID);
      return cloneDoc(doc);
    });
  }

  getDoc(docId: string): MemoryDoc | undefined {
    const doc = this.docs.get(docId);
    return doc ? cloneDoc(doc) : undefined;
  }

  getExtras(docId: string): MemoryDocExtras | undefined {
    const extras = this.extras.get(docId);
    return extras ? cloneExtras(extras) : undefined;
  }

  hasDoc(docId: string): boolean {
    return this.docs.has(docId);
  }

  async readDoc(docId: string): Promise<string> {
    await this.ready();
    const doc = this.docs.get(docId);
    if (!doc) throw new MemoryError('doc_not_found', '记忆文档不存在：' + docId);
    const markdown = await readTextIfExists(doc.filePath);
    if (markdown !== undefined) return markdown;
    return renderMemoryMarkdown(doc, this.extras.get(docId) ?? emptyExtras());
  }

  async readDocResult(docId: string): Promise<ReadMemoryDocResult> {
    await this.ready();
    const doc = this.docs.get(docId);
    if (!doc) throw new MemoryError('doc_not_found', '记忆文档不存在：' + docId);
    const markdown = await this.readDoc(docId);
    return { doc: cloneDoc(doc), markdown, path: doc.filePath };
  }

  listDocs(filter: ListDocsFilter = {}): MemoryDoc[] {
    const scopes: MemoryScopeKind[] | undefined =
      filter.scope === undefined
        ? undefined
        : typeof filter.scope === 'string'
          ? [filter.scope]
          : [...filter.scope];
    const search = filter.search?.trim().toLowerCase();
    const docs: MemoryDoc[] = [];
    for (const doc of this.docs.values()) {
      if (scopes && !scopes.includes(doc.scope)) continue;
      if (filter.scene && doc.scene !== filter.scene) continue;
      if (filter.groupId && !sameGroupId(doc, filter.groupId, this.platform)) continue;
      if (filter.pinnedOnly && doc.pinned !== true) continue;
      if (search) {
        const haystack = (doc.displayName + ' ' + doc.preview + ' ' + doc.facts.map((fact) => fact.text).join(' ')).toLowerCase();
        if (!haystack.includes(search)) continue;
      }
      docs.push(cloneDoc(doc));
    }
    docs.sort(
      (left, right) =>
        timeValue(right.updatedAt) - timeValue(left.updatedAt) ||
        left.displayName.localeCompare(right.displayName, 'zh-CN'),
    );
    if (filter.limit !== undefined && filter.limit >= 0) return docs.slice(0, filter.limit);
    return docs;
  }

  async saveDoc(doc: MemoryDoc, extrasPatch?: Partial<MemoryDocExtras>): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      if (!doc || !doc.id) throw new MemoryError('invalid_doc', 'saveDoc 需要带 id 的文档');
      if (!isInside(this.rootDir, doc.filePath)) {
        throw new PathSafetyError('文档路径不在记忆根目录内：' + doc.filePath);
      }
      const previous = this.extras.get(doc.id);
      const merged: MemoryDocExtras = normalizeExtras({
        ...(previous ?? emptyExtras()),
        ...(extrasPatch ?? {}),
      });
      const next = cloneDoc(doc);
      next.updatedAt = toIso();
      if (!next.createdAt) next.createdAt = next.updatedAt;
      next.preview = buildPreview(next, merged);
      this.docs.set(next.id, next);
      this.extras.set(next.id, merged);
      await this.writeDoc(next.id);
      return cloneDoc(next);
    });
  }

  async updateManualNote(docId: string, note: string): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      const extras = this.requireExtras(docId);
      extras.manualNote = normalizeText(note, 4000);
      const doc = this.requireDoc(docId);
      doc.updatedAt = toIso();
      await this.writeDoc(docId);
      return cloneDoc(doc);
    });
  }

  /**
   * 在单次写盘中完成一组变更（提取器批量落库用）：
   * 保证关系、事实、经历、锚点、情绪一起原子可见，避免多次写盘。
   */
  async mutateDoc(
    docId: string,
    mutator: (doc: MemoryDoc, extras: MemoryDocExtras) => void,
  ): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const extras = this.requireExtras(docId);
      mutator(doc, extras);
      doc.updatedAt = toIso();
      doc.preview = buildPreview(doc, extras);
      await this.writeDoc(docId);
      return cloneDoc(doc);
    });
  }

  // -------------------------------------------------------------------------
  // 事实 / 关系 / 经历 / 锚点 / 情绪
  // -------------------------------------------------------------------------

  async appendFacts(
    docId: string,
    inputs: readonly FactInput[],
    options: MergeFactsOptions = {},
  ): Promise<AppendFactsResult> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const now = new Date();
      const merged = mergeFacts(doc, inputs, now, options);
      if (merged.added.length > 0 || merged.updated.length > 0) {
        doc.updatedAt = toIso(now);
        doc.preview = buildPreview(doc, this.requireExtras(docId));
        await this.writeDoc(docId);
      }
      return {
        added: merged.added.map((fact) => ({ ...fact })),
        updated: merged.updated.map((fact) => ({ ...fact })),
        skipped: merged.skipped,
        doc: cloneDoc(doc),
      };
    });
  }

  async appendFact(docId: string, input: FactInput): Promise<AppendFactResult> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const outcome = mergeFact(doc, input, new Date());
      if (outcome.status !== 'skipped') {
        doc.updatedAt = toIso();
        doc.preview = buildPreview(doc, this.requireExtras(docId));
        await this.writeDoc(docId);
      }
      return { ...outcome, doc: cloneDoc(doc) };
    });
  }

  async forgetFact(docId: string, factIdOrText: string): Promise<ForgetFactResult> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const target = normalizeLine(factIdOrText, 400);
      if (!target) return { removed: false, doc: cloneDoc(doc) };
      const targetKey = target.toLowerCase();
      const index = doc.facts.findIndex(
        (fact) => fact.id === target || fact.text.toLowerCase() === targetKey,
      );
      if (index === -1) return { removed: false, doc: cloneDoc(doc) };
      const removed = doc.facts.splice(index, 1)[0];
      doc.updatedAt = toIso();
      doc.preview = buildPreview(doc, this.requireExtras(docId));
      await this.writeDoc(docId);
      const result: ForgetFactResult = { removed: true, doc: cloneDoc(doc) };
      if (removed) result.fact = { ...removed };
      return result;
    });
  }

  async updateRelationship(docId: string, update: RelationshipUpdate): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      applyRelationshipUpdate(doc, update, new Date());
      doc.updatedAt = toIso();
      await this.writeDoc(docId);
      return cloneDoc(doc);
    });
  }

  async addEpisode(docId: string, input: EpisodeInput): Promise<{ episode?: MemoryEpisode; doc: MemoryDoc }> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const extras = this.requireExtras(docId);
      const episode = appendEpisodeToExtras(extras, input, new Date());
      doc.episodeCount = extras.episodes.length;
      doc.updatedAt = toIso();
      await this.writeDoc(docId);
      return episode ? { episode: cloneEpisode(episode), doc: cloneDoc(doc) } : { doc: cloneDoc(doc) };
    });
  }

  async addAnchors(docId: string, quotes: readonly string[]): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const added = appendAnchorsToExtras(this.requireExtras(docId), quotes);
      if (added.length > 0) {
        doc.updatedAt = toIso();
        await this.writeDoc(docId);
      }
      return cloneDoc(doc);
    });
  }

  async appendEmotion(docId: string, input: EmotionInput): Promise<MemoryDoc> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const point = appendEmotionToExtras(doc, this.requireExtras(docId), input, new Date());
      if (point) {
        doc.updatedAt = toIso();
        await this.writeDoc(docId);
      }
      return cloneDoc(doc);
    });
  }

  async addRelationshipNote(docId: string, note: string): Promise<MemoryDoc> {
    return this.updateRelationship(docId, { note, touch: false });
  }

  async recordInteraction(docId: string, mood?: string): Promise<MemoryDoc> {
    return this.updateRelationship(docId, mood ? { mood, touch: true } : { touch: true });
  }

  // -------------------------------------------------------------------------
  // 原始消息归档 / 摘要版本
  // -------------------------------------------------------------------------

  async archiveMessages(
    docId: string,
    messages: readonly (ContextInputMessage | ArchivedMessage)[],
    meta: Record<string, unknown> = {},
  ): Promise<ArchiveResult> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const normalized = messages.map(normalizeArchiveMessage);
      const now = new Date();
      const stamp = fileTimestamp(now);
      const dir = archiveDir(this.rootDir, docId, this.platform);
      await ensureDir(dir);
      let filePath = archiveFilePath(this.rootDir, docId, stamp, this.platform);
      if ((await fileSizeIfExists(filePath)) > 0) {
        filePath = archiveFilePath(this.rootDir, docId, stamp + '-' + sha1Short(String(Math.random())), this.platform);
      }
      const payload = {
        docId,
        archivedAt: toIso(now),
        count: normalized.length,
        messages: normalized,
        meta,
      };
      await atomicWriteFile(filePath, JSON.stringify(payload, null, 2));
      doc.messageCount = Math.max(doc.messageCount, normalized.length);
      doc.updatedAt = toIso(now);
      await this.writeDoc(docId);
      return { path: filePath, count: normalized.length, createdAt: toIso(now) };
    });
  }

  async saveSummary(docId: string, input: SummarySaveInput): Promise<SummaryVersion> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.requireDoc(docId);
      const now = new Date();
      const currentVersion = await this.getSummaryVersion(docId);
      const version = currentVersion + 1;
      const dir = summariesDir(this.rootDir, docId, this.platform);
      await ensureDir(dir);
      const stamp = fileTimestamp(now);
      let filePath = summaryFilePath(this.rootDir, docId, stamp, this.platform);
      if ((await fileSizeIfExists(filePath)) > 0) {
        filePath = summaryFilePath(this.rootDir, docId, stamp + '-v' + version, this.platform);
      }
      const payload: SummaryVersion = {
        version,
        docId,
        createdAt: toIso(now),
        summary: normalizeText(input.summary, 20000),
        facts: (input.facts ?? []).map((fact) => ({ ...fact })),
        anchors: [...(input.anchors ?? [])],
        keptMessageIds: [...(input.keptMessageIds ?? [])],
        archivedPath: input.archivedPath,
        tokensBefore: input.tokensBefore,
        tokensAfter: input.tokensAfter,
        messageCount: input.messageCount,
        path: filePath,
      };
      await atomicWriteFile(filePath, JSON.stringify(payload, null, 2));
      this.summaryVersions.set(docId, version);
      this.requireExtras(docId).summaryVersion = version;
      doc.updatedAt = toIso(now);
      await this.writeDoc(docId);
      return { ...payload };
    });
  }

  async getSummaryVersion(docId: string): Promise<number> {
    await this.ready();
    const cached = this.summaryVersions.get(docId);
    if (cached !== undefined) return cached;
    const versions = await this.readSummaryFiles(docId);
    const maxVersion = versions.reduce((max, item) => Math.max(max, item.version), 0);
    this.summaryVersions.set(docId, maxVersion);
    return maxVersion;
  }

  async listSummaryVersions(docId: string): Promise<SummaryVersion[]> {
    await this.ready();
    return this.readSummaryFiles(docId);
  }

  async getLatestSummary(docId: string): Promise<SummaryVersion | undefined> {
    const versions = await this.listSummaryVersions(docId);
    return versions.length > 0 ? versions[versions.length - 1] : undefined;
  }

  private async readSummaryFiles(docId: string): Promise<SummaryVersion[]> {
    const dir = summariesDir(this.rootDir, docId, this.platform);
    const files = (await walkFiles(dir)).filter((file) => file.toLowerCase().endsWith('.json'));
    const versions: SummaryVersion[] = [];
    for (const file of files) {
      const text = await readTextIfExists(file);
      if (!text) continue;
      try {
        const parsed = JSON.parse(text) as SummaryVersion;
        if (typeof parsed.version === 'number' && Number.isFinite(parsed.version)) {
          versions.push({ ...parsed, path: file });
        }
      } catch {
        // 损坏的摘要文件跳过，不影响其他版本。
      }
    }
    versions.sort((left, right) => left.version - right.version);
    return versions;
  }

  // -------------------------------------------------------------------------
  // 删除 / 统计 / 群成员 / 检索
  // -------------------------------------------------------------------------

  async deleteDoc(docId: string): Promise<boolean> {
    await this.ready();
    return this.enqueue(async () => {
      const doc = this.docs.get(docId);
      if (!doc) return false;
      await removeIfExists(doc.filePath);
      await removeIfExists(summariesDir(this.rootDir, docId, this.platform), { recursive: true });
      await removeIfExists(archiveDir(this.rootDir, docId, this.platform), { recursive: true });
      this.docs.delete(docId);
      this.extras.delete(docId);
      this.summaryVersions.delete(docId);
      await this.pruneEmptyGroupDirs();
      return true;
    });
  }

  private async pruneEmptyGroupDirs(): Promise<void> {
    const groupsRoot = path.join(this.rootDir, 'groups');
    let entries: Dirent[] = [];
    try {
      entries = await fsp.readdir(groupsRoot, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const groupDir = path.join(groupsRoot, entry.name);
      const membersDir = path.join(groupDir, 'members');
      try {
        await fsp.rmdir(membersDir);
      } catch {
        // 非空或不存在，忽略。
      }
      try {
        await fsp.rmdir(groupDir);
      } catch {
        // 非空或不存在，忽略。
      }
    }
  }

  async getStats(): Promise<MemoryStats> {
    await this.ready();
    let users = 0;
    let groups = 0;
    let facts = 0;
    let storageBytes = 0;
    for (const doc of this.docs.values()) {
      facts += doc.facts.length;
      if (doc.scope === 'group') groups += 1;
      else if (doc.scope === 'user') users += 1;
      storageBytes += await fileSizeIfExists(doc.filePath);
    }
    return { users, groups, facts, docs: this.docs.size, storageBytes };
  }

  async getSummary(): Promise<MemorySummary> {
    await this.ready();
    const docs = this.listDocs();
    const groups: MemorySummary['groups'] = [];
    for (const doc of docs) {
      if (doc.scope !== 'group') continue;
      const memberCount = docs.filter(
        (candidate) => candidate.scope === 'user' && sameGroupId(candidate, doc.externalId, this.platform),
      ).length;
      groups.push({
        id: doc.externalId,
        name: doc.displayName,
        memberCount,
        updatedAt: doc.updatedAt,
        preview: doc.preview,
      });
    }
    groups.sort((left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt));
    return { docs, groups, stats: await this.getStats() };
  }

  async getGroupMembers(groupId: string): Promise<MemoryDoc[]> {
    await this.ready();
    const members = this.listDocs({ scope: 'user', groupId }).filter((doc) => doc.groupId !== undefined);
    members.sort(
      (left, right) =>
        right.relationship.affinity - left.relationship.affinity ||
        left.displayName.localeCompare(right.displayName, 'zh-CN'),
    );
    return members;
  }

  getRetriever(): MemoryRetriever {
    return this.retriever;
  }

  async search(query: string, options: RetrieveOptions = {}): Promise<MemorySearchHit[]> {
    await this.ready();
    return this.retriever.retrieve(query, options).map((snippet) => ({
      docId: snippet.docId,
      displayName: snippet.displayName,
      scope: snippet.scope,
      snippet: snippet.snippet,
      score: snippet.score,
    }));
  }

  // -------------------------------------------------------------------------
  // 内部工具
  // -------------------------------------------------------------------------

  private requireDoc(docId: string): MemoryDoc {
    const doc = this.docs.get(docId);
    if (!doc) throw new MemoryError('doc_not_found', '记忆文档不存在：' + docId);
    return doc;
  }

  private requireExtras(docId: string): MemoryDocExtras {
    const extras = this.extras.get(docId);
    if (!extras) throw new MemoryError('doc_not_found', '记忆文档不存在：' + docId);
    return extras;
  }

  private async writeDoc(docId: string): Promise<void> {
    const doc = this.requireDoc(docId);
    const extras = this.requireExtras(docId);
    doc.preview = buildPreview(doc, extras);
    const markdown = renderMemoryMarkdown(doc, extras);
    const bytes = Buffer.byteLength(markdown, 'utf8');
    if (bytes > this.maxDocBytes) {
      throw new MemoryError('doc_too_large', '记忆文档超过上限 ' + this.maxDocBytes + ' 字节：' + docId);
    }
    await atomicWriteFile(doc.filePath, markdown);
  }
}

// ---------------------------------------------------------------------------
// 纯工具（导出便于测试）
// ---------------------------------------------------------------------------

export function sameGroupId(doc: MemoryDoc, groupId: string, platform?: string): boolean {
  if (doc.groupId === undefined) return false;
  if (doc.groupId === groupId) return true;
  return doc.groupId === safeSegment(groupId, platform);
}

export function cloneDoc(doc: MemoryDoc): MemoryDoc {
  const clone: MemoryDoc = {
    ...doc,
    facts: doc.facts.map((fact) => ({ ...fact })),
    relationship: {
      ...doc.relationship,
      notes: [...doc.relationship.notes],
    },
    tags: [...doc.tags],
  };
  return clone;
}

export function cloneExtras(extras: MemoryDocExtras): MemoryDocExtras {
  return {
    anchors: [...extras.anchors],
    episodes: extras.episodes.map(cloneEpisode),
    emotionTrail: extras.emotionTrail.map((point) => ({ ...point })),
    manualNote: extras.manualNote,
    summaryVersion: extras.summaryVersion,
  };
}

export function cloneEpisode(episode: MemoryEpisode): MemoryEpisode {
  return { ...episode, anchors: [...episode.anchors] };
}

export function normalizeArchiveMessage(message: ContextInputMessage | ArchivedMessage): ArchivedMessage {
  const content = 'content' in message && typeof message.content === 'string'
    ? message.content
    : 'text' in message && typeof message.text === 'string'
      ? message.text
      : '';
  const result: ArchivedMessage = {
    role: message.role,
    content: content.slice(0, 8000),
  };
  const name = 'name' in message && typeof message.name === 'string'
    ? message.name
    : 'senderName' in message && typeof message.senderName === 'string'
      ? message.senderName
      : undefined;
  if (name) result.name = name;
  if (typeof message.createdAt === 'string') result.createdAt = message.createdAt;
  return result;
}

function stripMarkdownExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith(MD_EXTENSION)
    ? fileName.slice(0, -MD_EXTENSION.length)
    : fileName;
}

function timeValue(iso: string | undefined): number {
  if (!iso) return 0;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}
