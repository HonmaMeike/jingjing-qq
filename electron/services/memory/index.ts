// 长期记忆与上下文压缩引擎的统一出口。
//
// 主进程典型用法：
//   const memory = await createMemoryService({ rootDir, llm, settings: settings.context });
//   const context = await memory.buildContext({ ... });
//   const compacted = await memory.maybeCompact({ docId: context.primaryDocId, messages });
//   const remembered = await memory.remember({ docId: context.primaryDocId, messages });
//   await memory.switchRoot(rootDirForActivePersona); // 人设隔离：切根后只读写新根
//
// 隔离约定：
//   - 私聊只会注入 global + 当前联系人；
//   - 群聊只会注入 global + 当前群 + 当前发言人；
//   - 检索在传了 scene/userId 时强制白名单，其他用户/其他群文档不会出现。
import { DEFAULT_MEMORY_SETTINGS, MemoryError } from './types';
import { MemoryStore } from './store';
import { MemoryRetriever } from './retriever';
import { MemoryExtractor } from './extractor';
import { ContextManager } from './context';
import { seedDemoMemory } from './seed';
import type { ExtractRunResult } from './extractor';
import type {
  BuildContextInput,
  BuildContextResult,
  CompactInput,
  CompactResult,
  ConversationMemoryDocs,
  EnsureConversationMemoryInput,
  ExtractInput,
  ExtractionResult,
  ListDocsFilter,
  MemoryDoc,
  MemoryEngineSettings,
  MemoryLlm,
  MemorySearchHit,
  MemoryServiceOptions,
  MemorySnippet,
  MemoryStats,
  MemorySummary,
  RetrieveOptions,
  RetrieverOptions,
  SeedResult,
} from './types';
import type { MemoryReadResult } from '../../../shared/types';

export * from './types';
export * from './paths';
export * from './markdown';
export * from './docops';
export * from './store';
export * from './retriever';
export * from './extractor';
export * from './context';
export * from './seed';

export interface MemoryServiceConstructorOptions {
  rootDir: string;
  store: MemoryStore;
  settings?: Partial<MemoryEngineSettings>;
  llm?: MemoryLlm;
  retrieverOptions?: RetrieverOptions;
  now?: () => Date;
}

const EMPTY_EXTRACTION: ExtractionResult = { facts: [], relationshipDelta: {}, raw: '' };

export class MemoryService {
  /** 当前记忆根目录；随 switchRoot 变化，供 seedDemo/诊断读取。 */
  rootDir: string;
  readonly settings: MemoryEngineSettings;
  readonly store: MemoryStore;
  readonly retriever: MemoryRetriever;
  readonly extractor: MemoryExtractor;
  readonly context: ContextManager;
  private llm: MemoryLlm | undefined;

  constructor(options: MemoryServiceConstructorOptions) {
    this.rootDir = options.rootDir;
    this.settings = { ...DEFAULT_MEMORY_SETTINGS, ...(options.settings ?? {}) };
    this.store = options.store;
    this.llm = options.llm;
    this.retriever = new MemoryRetriever(this.store, options.retrieverOptions ?? {});
    this.extractor = new MemoryExtractor(this.store, this.llm);
    this.context = new ContextManager({
      memoryStore: this.store,
      maxTokens: this.settings.maxContextTokens,
      compactAtPercent: this.settings.compactAtPercent,
      keepRecentMessages: this.settings.keepRecentMessages,
      memoryTopK: this.settings.memoryTopK,
      maxMemoryTokens: this.settings.maxMemoryTokens,
      detailPreservingCompression: this.settings.detailPreservingCompression,
      retriever: this.retriever,
      now: options.now,
    });
  }

  init(): Promise<void> {
    return this.store.init();
  }

  close(): Promise<void> {
    return this.store.close();
  }

  /**
   * 切换记忆根目录（人设隔离）。
   * retriever / context / extractor 都持有同一个 store 实例，无需重建；
   * 切根完成后 listDocs / search / buildContext / remember 只会看到新根的数据。
   */
  async switchRoot(rootDir: string): Promise<void> {
    await this.store.switchRoot(rootDir);
    this.rootDir = this.store.rootDir;
  }

  setLlm(llm: MemoryLlm | undefined): void {
    this.llm = llm;
    this.extractor.setLlm(llm);
  }

  /** 为当前会话准备/刷新记忆文档，返回本次上下文允许使用的文档。 */
  async ensureConversationMemory(input: EnsureConversationMemoryInput): Promise<ConversationMemoryDocs> {
    const globalDoc = await this.store.ensureGlobalDoc();
    if (input.scene === 'group') {
      const groupId = (input.groupId ?? '').trim();
      if (!groupId) throw new MemoryError('missing_group', '群聊记忆必须提供 groupId');
      const groupDoc = await this.store.ensureGroupDoc({
        groupId,
        groupName: input.groupName ?? '群 ' + groupId,
      });
      const memberDoc = await this.store.ensureUserDoc({ ...input, groupId });
      return { primaryDocId: groupDoc.id, userDoc: memberDoc, memberDoc, groupDoc, globalDoc };
    }
    const userDoc = await this.store.ensureUserDoc({ ...input, scene: 'private' });
    return { primaryDocId: userDoc.id, userDoc, globalDoc };
  }

  /** 构建带长期记忆的上下文（超预算自动裁剪最旧消息，并注入最近摘要）。 */
  buildContext(input: BuildContextInput): Promise<BuildContextResult> {
    return this.context.buildContext(input);
  }

  /** 细节保留式压缩：归档原始消息 -> LLM 结构化摘要 -> 版本化落盘。 */
  maybeCompact(input: CompactInput): Promise<CompactResult> {
    return this.context.maybeCompact({ ...input, llm: input.llm ?? this.llm });
  }

  /** 从对话抽取长期记忆并落库（受 autoMemoryExtraction 开关控制，force 可绕过）。 */
  async remember(input: ExtractInput, options: { force?: boolean } = {}): Promise<ExtractRunResult> {
    if (!this.settings.autoMemoryExtraction && options.force !== true) {
      return { extraction: { ...EMPTY_EXTRACTION } };
    }
    if (!options.force && !this.extractor.shouldExtract(input.messages)) {
      return { extraction: { ...EMPTY_EXTRACTION } };
    }
    return this.extractor.run(input);
  }

  forgetFact(docId: string, factIdOrText: string): ReturnType<MemoryStore['forgetFact']> {
    return this.store.forgetFact(docId, factIdOrText);
  }

  forgetDoc(docId: string): Promise<boolean> {
    return this.store.deleteDoc(docId);
  }

  async readDoc(docId: string): Promise<MemoryReadResult> {
    const result = await this.store.readDocResult(docId);
    return { doc: result.doc, markdown: result.markdown, path: result.path };
  }

  listDocs(filter?: ListDocsFilter): MemoryDoc[] {
    return this.store.listDocs(filter);
  }

  search(query: string, options: RetrieveOptions = {}): Promise<MemorySearchHit[]> {
    return this.store.search(query, options);
  }

  searchSnippets(query: string, options: RetrieveOptions = {}): MemorySnippet[] {
    return this.retriever.retrieve(query, options);
  }

  getSummary(): Promise<MemorySummary> {
    return this.store.getSummary();
  }

  getStats(): Promise<MemoryStats> {
    return this.store.getStats();
  }

  getGroupMembers(groupId: string): Promise<MemoryDoc[]> {
    return this.store.getGroupMembers(groupId);
  }

  /** 演示数据（3 联系人 + 2 群 + 群成员），不覆盖已有文档。 */
  seedDemo(): Promise<SeedResult> {
    return seedDemoMemory(this.rootDir, { store: this.store });
  }
}

/** 一步创建并初始化记忆服务（主进程启动时调用）。 */
export async function createMemoryService(options: MemoryServiceOptions): Promise<MemoryService> {
  if (!options || !options.rootDir) {
    throw new MemoryError('invalid_root', 'createMemoryService 需要 rootDir');
  }
  const store = new MemoryStore({ rootDir: options.rootDir, platform: options.platform });
  await store.init();
  return new MemoryService({
    rootDir: store.rootDir,
    store,
    settings: options.settings,
    llm: options.llm,
    retrieverOptions: options.retrieverOptions,
    now: options.now,
  });
}
