// 意识结构服务：识海 / 原意识 / 心光 / 心流 / 遗忘 的统一入口。
//
// 主进程典型用法（app-services 注入）：
//   const consciousness = await createConsciousnessService({
//     dataDir, memory, content, personas, growth,
//     getPersonaId: () => settings.get().persona.activeId,
//     llm: memoryLlm, events, logger,
//   });
//   const block = await consciousness.buildContextBlock({ conversationId, userName, userId, scene, query });
//   await consciousness.observeExchange({ conversationId, userName, userId, scene, groupId, userText, assistantText });
//   const overview = await consciousness.overview();
//
// 隔离：所有识海点都带 docId；注入与检索按记忆白名单过滤，默认只用当前用户/当前群 + global，
// 没有对话上下文时只暴露 persona 级自我内容，绝不会把 A 用户记忆注入 B 用户的上下文。
import type { ContentStore } from '../content';
import type { GrowthService } from '../growth';
import type { EventBus } from '../../core/event-bus';
import type { PersonaService } from '../personas';
import {
  GLOBAL_DOC_ID,
  type MemoryLlm,
  type MemoryService,
} from '../memory';
import {
  toAttentionState,
  updateAttention,
} from './attention';
import {
  buildContextBlockText,
  filterPointsByDocs,
  resolveAllowedDocIds,
} from './context';
import {
  generateFlow,
  toMindFlowState,
} from './flow';
import {
  buildOrigin,
  buildResumeBrief,
  originToPublic,
  touchOrigin,
} from './origin';
import {
  buildSea,
  forgettingStats,
  recordRecall,
  searchPoints,
  toSeaPoint,
  toSeaPoints,
  topSeaPoints,
  upsertChatPoint,
} from './sea';
import { ConsciousnessStore } from './store';
import type {
  AttentionState,
  BuildContextBlockInput,
  ConsciousnessLogger,
  ConsciousnessOverview,
  ConsciousnessServiceOptions,
  ConsciousnessStats,
  FlowRecord,
  MindFlowState,
  ObserveExchangeInput,
  ObserveResult,
  OriginData,
  OriginSelf,
  ResumeInput,
  ResumeResult,
  Scene,
  SearchSeaOptions,
  SeaPoint,
  SeaPointProvenance,
  SeaPointRecord,
} from './types';
import { ConsciousnessError } from './types';

export * from './types';
export * from './store';
export * from './sea';
export * from './origin';
export * from './attention';
export * from './flow';
export * from './context';

function normalizeScene(scene: Scene | 'local' | undefined): Scene | undefined {
  if (scene === 'group') return 'group';
  if (scene === 'private' || scene === 'local') return 'private';
  return undefined;
}

export class ConsciousnessService {
  readonly store: ConsciousnessStore;
  private readonly memory: MemoryService;
  private readonly content: ContentStore;
  private readonly personas: PersonaService;
  private readonly growth: GrowthService;
  private readonly getPersonaId: () => string;
  private readonly events: EventBus | undefined;
  private readonly logger: ConsciousnessLogger | undefined;
  private readonly now: () => Date;
  private readonly useLlmForFlow: boolean;
  private llm: MemoryLlm | undefined;
  private writeChain: Promise<unknown> = Promise.resolve();
  private initPromise: Promise<void> | undefined;

  private constructor(options: ConsciousnessServiceOptions, store: ConsciousnessStore) {
    this.store = store;
    this.memory = options.memory;
    this.content = options.content;
    this.personas = options.personas;
    this.growth = options.growth;
    this.getPersonaId = options.getPersonaId ?? (() => 'jingjing');
    this.events = options.events;
    this.logger = options.logger;
    this.now = options.now ?? (() => new Date());
    this.useLlmForFlow = options.useLlmForFlow === true;
    this.llm = options.llm;
  }

  /** 内部工厂：由 createConsciousnessService 调用。 */
  static async create(options: ConsciousnessServiceOptions): Promise<ConsciousnessService> {
    const store = await ConsciousnessStore.create(options.dataDir, { now: options.now, logger: options.logger });
    const service = new ConsciousnessService(options, store);
    if (options.autoBuild !== false) await service.init();
    return service;
  }

  // -------------------------------------------------------------------------
  // 生命周期
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    await this.ready();
  }

  async flush(): Promise<void> {
    await this.writeChain;
    await this.store.flush();
  }

  setLlm(llm: MemoryLlm | undefined): void {
    this.llm = llm;
  }

  private async ready(): Promise<void> {
    if (!this.initPromise) {
      const created = this.doInit().catch((error: unknown) => {
        this.initPromise = undefined;
        throw error;
      });
      this.initPromise = created;
    }
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    const personaId = this.currentPersonaId();
    let points = this.store.seaPoints(personaId);
    if (points.length === 0) {
      points = await this.refreshSeaInternal(personaId);
    }
    if (!this.store.origin(personaId)) {
      await this.refreshOriginInternal(personaId);
    }
    this.logger?.info('consciousness', '意识结构已就绪：识海 ' + points.length + ' 点');
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.writeChain.then(operation, operation);
    this.writeChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private currentPersonaId(): string {
    const id = String(this.getPersonaId() ?? '').trim();
    return id || 'jingjing';
  }

  private nowDate(): Date {
    return this.now();
  }

  private personaBundle(personaId: string): {
    persona: ReturnType<PersonaService['active']>;
    growth: ReturnType<GrowthService['get']>;
    globalDoc: ReturnType<MemoryService['store']['getDoc']>;
    globalExtras: ReturnType<MemoryService['store']['getExtras']>;
  } {
    const persona = this.personas.get(personaId) ?? this.personas.active();
    const growth = this.growth.get(personaId);
    const globalDoc = this.memory.store.getDoc(GLOBAL_DOC_ID);
    const globalExtras = globalDoc ? this.memory.store.getExtras(globalDoc.id) : undefined;
    return { persona, growth, globalDoc, globalExtras };
  }

  // -------------------------------------------------------------------------
  // 重建：识海 / 原意识
  // -------------------------------------------------------------------------

  private async refreshSeaInternal(personaId: string): Promise<SeaPointRecord[]> {
    const existing = this.store.seaPoints(personaId);
    const data = buildSea({
      memory: this.memory,
      content: this.content,
      existing,
      now: this.nowDate(),
      personaId,
    });
    await this.store.saveSea(personaId, data);
    return data.points;
  }

  private async refreshOriginInternal(personaId: string): Promise<OriginData> {
    const { persona, growth, globalDoc, globalExtras } = this.personaBundle(personaId);
    const previous = this.store.origin(personaId);
    const origin = buildOrigin({
      personaId,
      persona,
      growth,
      globalDoc,
      globalExtras,
      seaPoints: this.store.seaPoints(personaId),
      previous,
      now: this.nowDate(),
    });
    await this.store.saveOrigin(origin);
    return origin;
  }

  /** 从 MemoryService + ContentStore 重建识海与原意识（真实数据，不是模板）。 */
  async rebuild(personaId?: string): Promise<ConsciousnessOverview> {
    await this.ready();
    const pid = personaId ?? this.currentPersonaId();
    return this.enqueue(async () => {
      await this.refreshSeaInternal(pid);
      await this.refreshOriginInternal(pid);
      return this.buildOverview(pid);
    });
  }

  // -------------------------------------------------------------------------
  // overview
  // -------------------------------------------------------------------------

  async overview(personaId?: string): Promise<ConsciousnessOverview> {
    await this.ready();
    return this.buildOverview(personaId ?? this.currentPersonaId());
  }

  private buildOverview(personaId: string): ConsciousnessOverview {
    const now = this.nowDate();
    const points = this.store.seaPoints(personaId);
    const origin = this.store.origin(personaId) ?? null;
    const attentionRecords = this.store.attentionList(personaId);
    const flowRecords = this.store.flowList(personaId);
    const latestAttention = attentionRecords[0];
    const latestFlow = flowRecords[0];
    const topPoint = topSeaPoints(points, 1)[0];
    const brief = buildResumeBrief({
      origin: origin ?? undefined,
      attention: latestAttention,
      flow: latestFlow,
      point: topPoint,
      now,
    });
    const originData: OriginData = origin ?? {
      personaId,
      coreSelf: '',
      anchors: [],
      continuity: '',
      updatedAt: now.toISOString(),
      builtAt: now.toISOString(),
      lastTopics: [],
      openLoops: [],
      sources: { personaId, personaName: '', selfImage: '', anchorCount: 0, seaPointCount: points.length },
    };
    return {
      origin: originToPublic(originData),
      attention: attentionRecords.map(toAttentionState),
      flows: flowRecords.map(toMindFlowState),
      points: toSeaPoints(points),
      forgetting: forgettingStats(points, now),
      continuity: {
        lastSeenAt: latestAttention?.updatedAt ?? originData.lastSeenAt ?? originData.updatedAt,
        lastTopics: latestAttention && latestAttention.topics.length > 0
          ? [...latestAttention.topics]
          : [...originData.lastTopics],
        openLoops: latestAttention && latestAttention.unresolved.length > 0
          ? [...latestAttention.unresolved]
          : [...originData.openLoops],
        brief,
      },
      generatedAt: now.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // 上下文注入
  // -------------------------------------------------------------------------

  /** 生成可直接注入 system prompt 的意识文本。 */
  async buildContextBlock(input: BuildContextBlockInput): Promise<string> {
    await this.ready();
    const personaId = input.personaId ?? this.currentPersonaId();
    const now = this.nowDate();
    let origin = this.store.origin(personaId);
    if (!origin) origin = await this.refreshOriginInternal(personaId);
    let points = this.store.seaPoints(personaId);
    if (points.length === 0) {
      points = await this.enqueue(() => this.refreshSeaInternal(personaId));
    }
    const allowedDocIds = resolveAllowedDocIds(this.memory, input);
    const allowedPoints = filterPointsByDocs(points, allowedDocIds);
    // 只使用当前会话的心光/心流，绝不把另一个联系人的会话焦点注入进来。
    const attention = this.store.attention(personaId, input.conversationId);
    const flow = this.store.flow(personaId, input.conversationId);
    // 没有当前会话的心光时，连续性只保留「我是谁」，不复述上次任意会话的话题（避免跨联系人泄露）。
    const continuityOrigin: OriginData = attention
      ? origin
      : { ...origin, lastTopics: [], openLoops: [] };
    const query = (input.query ?? '').trim() ||
      [attention?.focus, ...(attention?.topics ?? []).slice(0, 2)].filter(Boolean).join(' ');
    const built = buildContextBlockText({
      origin: continuityOrigin,
      attention,
      flow,
      points: allowedPoints,
      query,
      maxChars: input.maxChars,
      now,
    });
    return built.text;
  }

  // -------------------------------------------------------------------------
  // 每次对话后：更新识海 / 心光 / 心流 / 遗忘
  // -------------------------------------------------------------------------

  async observeExchange(input: ObserveExchangeInput): Promise<ObserveResult> {
    await this.ready();
    const personaId = input.personaId ?? this.currentPersonaId();
    const now = this.nowDate();
    return this.enqueue(async () => {
      const allowedDocIds = resolveAllowedDocIds(this.memory, input);

      // 1) 从长期记忆里回忆：真实 snippet 会成为心流里的「回忆」节点。
      let memoryHits = 0;
      let snippets: string[] = [];
      try {
        const hits = await this.memory.search(input.userText, { docIds: allowedDocIds, topK: 5, now });
        memoryHits = hits.length;
        snippets = hits.map((hit) => hit.snippet);
      } catch (error) {
        this.logger?.warn('consciousness', '记忆检索失败（不影响心光/心流）：', error instanceof Error ? error.message : String(error));
      }

      // 2) 心光：话题、未完成事项、情绪、强度。
      const previousAttention = this.store.attention(personaId, input.conversationId);
      const attention = updateAttention({
        personaId,
        conversationId: input.conversationId,
        userName: input.userName,
        userText: input.userText,
        now,
        memoryHits,
        previous: previousAttention,
      });
      await this.store.saveAttention(attention);

      // 3) 识海：唤醒相关点（回忆强化）并沉淀本轮对话点。
      let points = this.store.seaPoints(personaId);
      if (points.length === 0) points = await this.refreshSeaInternal(personaId);
      const allowedPoints = filterPointsByDocs(points, allowedDocIds);
      const recallQuery = [
        attention.focus,
        ...attention.topics.slice(0, 2),
        input.userText.slice(0, 60),
      ].filter(Boolean).join(' ');
      const recalled = searchPoints(allowedPoints, recallQuery, { topK: 3, minSalience: 0.02 });
      for (const point of recalled) recordRecall(point, now, 'touch');
      const chatDocId = this.primaryDocId(allowedDocIds, input.scene);
      const chatPoint = upsertChatPoint(points, {
        conversationId: input.conversationId,
        userText: input.userText,
        assistantText: input.assistantText,
        at: now,
        docId: chatDocId,
        scene: normalizeScene(input.scene),
        groupId: input.groupId,
        userId: input.userId,
        displayName: input.userName,
        topics: attention.topics,
        memoryHitCount: memoryHits,
      });
      await this.store.saveSea(personaId, { points, updatedAt: now.toISOString() });

      // 4) 心流：感知→联想→回忆→推理→回复→反思（规则 + 可选 LLM）。
      const previousFlow = this.store.flow(personaId, input.conversationId);
      const flow = await generateFlow({
        personaId,
        conversationId: input.conversationId,
        userName: input.userName,
        userText: input.userText,
        assistantText: input.assistantText,
        now,
        topics: attention.topics,
        mood: attention.mood,
        unresolved: attention.unresolved,
        memoryHits: snippets,
        recalled: recalled[0],
        previous: previousFlow,
        llm: this.llm,
        useLlm: this.useLlmForFlow,
      });
      await this.store.saveFlow(flow);

      // 5) 原意识：记录上次见面 / 上次话题 / 未完成的事，供 resume 接上。
      let origin = this.store.origin(personaId);
      if (!origin) {
        origin = await this.refreshOriginInternal(personaId);
      } else {
        origin = touchOrigin(origin, {
          at: now,
          topics: attention.topics.slice(0, 3),
          openLoops: attention.unresolved,
        });
        await this.store.saveOrigin(origin);
      }

      const changes: string[] = [];
      if (chatPoint.added) changes.push('识海新增 1 个对话点');
      if (recalled.length > 0) changes.push('唤醒 ' + recalled.length + ' 条记忆');
      if (attention.focus) changes.push('心光聚焦「' + attention.focus + '」');
      if (attention.unresolved.length > 0) changes.push('未完成话题 ' + attention.unresolved.length + ' 条');
      changes.push('心流链路 ' + flow.chain.length + ' 步');

      if (this.events) await this.emitOverview(personaId);

      const result: ObserveResult = {
        personaId,
        conversationId: input.conversationId,
        attention: toAttentionState(attention),
        flow: toMindFlowState(flow),
        recalled: recalled.map(toSeaPoint),
        addedPoints: chatPoint.added ? 1 : 0,
        reinforced: recalled.length,
        memoryHits,
        changes,
      };
      if (chatPoint.added) result.addedPointId = chatPoint.point.id;
      return result;
    });
  }

  private async emitOverview(personaId: string): Promise<void> {
    if (!this.events) return;
    try {
      const overview = await this.overview(personaId);
      this.events.emit('consciousness:update', overview);
    } catch (error) {
      this.logger?.warn('consciousness', '推送意识概览失败：', error instanceof Error ? error.message : String(error));
    }
  }

  private primaryDocId(allowedDocIds: string[], scene: Scene | 'local' | undefined): string | undefined {
    const nonGlobal = allowedDocIds.filter((id) => id !== GLOBAL_DOC_ID);
    if (nonGlobal.length === 0) return undefined;
    if (scene === 'group') {
      const groupDoc = nonGlobal.find((id) => id.startsWith('group_') && !id.includes('__user_'));
      if (groupDoc) return groupDoc;
    }
    const userDoc = nonGlobal.find((id) => id.startsWith('user_') || id.includes('__user_'));
    return userDoc ?? nonGlobal[0];
  }

  // -------------------------------------------------------------------------
  // 检索 / 强化 / 读接口
  // -------------------------------------------------------------------------

  /** 真实检索识海点（默认给命中点记一次回忆，体现遗忘/强化）。 */
  async search(query: string, options: SearchSeaOptions = {}): Promise<SeaPoint[]> {
    await this.ready();
    const personaId = options.personaId ?? this.currentPersonaId();
    const now = this.nowDate();
    return this.enqueue(async () => {
      let points = this.store.seaPoints(personaId);
      if (points.length === 0) points = await this.refreshSeaInternal(personaId);
      // UI 面板检索：显式给了 docIds / userId 才做隔离；否则检索当前 persona 的整片识海。
      const scoped = Boolean(options.docIds?.length || options.userId);
      const allowedDocIds = scoped
        ? resolveAllowedDocIds(this.memory, {
            docIds: options.docIds,
            userId: options.userId,
            groupId: options.groupId,
            scene: options.scene,
          })
        : undefined;
      const allowedPoints = allowedDocIds ? filterPointsByDocs(points, allowedDocIds) : points;
      const hits = searchPoints(allowedPoints, query, {
        topK: options.topK ?? options.limit ?? 20,
        minSalience: options.minSalience,
        kinds: options.kinds,
      });
      if (options.touch !== false && hits.length > 0) {
        for (const point of hits) recordRecall(point, now, 'touch');
        await this.store.saveSea(personaId, { points, updatedAt: now.toISOString() });
      }
      return hits.map(toSeaPoint);
    });
  }

  /** 真实检索识海点（retrieve 是 search 的别名，方便主进程按任务接口调用）。 */
  retrieve(
    query: string,
    options: { docIds?: string[]; topK?: number; personaId?: string; touch?: boolean } = {},
  ): Promise<SeaPoint[]> {
    return this.search(query, {
      docIds: options.docIds,
      topK: options.topK,
      personaId: options.personaId,
      touch: options.touch,
    });
  }

  async touchPoint(pointId: string, personaId?: string): Promise<SeaPoint | undefined> {
    return this.recordTouch(pointId, 'touch', personaId);
  }

  async strengthen(pointId: string, personaId?: string): Promise<SeaPoint | undefined> {
    return this.recordTouch(pointId, 'strengthen', personaId);
  }

  private async recordTouch(
    pointId: string,
    mode: 'touch' | 'strengthen',
    personaId?: string,
  ): Promise<SeaPoint | undefined> {
    await this.ready();
    const pid = personaId ?? this.currentPersonaId();
    const now = this.nowDate();
    return this.enqueue(async () => {
      const points = this.store.seaPoints(pid);
      const point = points.find((item) => item.id === pointId);
      if (!point) return undefined;
      recordRecall(point, now, mode);
      await this.store.saveSea(pid, { points, updatedAt: now.toISOString() });
      return toSeaPoint(point);
    });
  }

  async getPoint(pointId: string, personaId?: string): Promise<SeaPointRecord | undefined> {
    await this.ready();
    const pid = personaId ?? this.currentPersonaId();
    return this.store.seaPoints(pid).find((point) => point.id === pointId);
  }

  async getProvenance(pointId: string, personaId?: string): Promise<SeaPointProvenance | undefined> {
    const point = await this.getPoint(pointId, personaId);
    return point ? { ...point.provenance } : undefined;
  }

  async getOrigin(personaId?: string): Promise<OriginSelf> {
    await this.ready();
    const pid = personaId ?? this.currentPersonaId();
    let origin = this.store.origin(pid);
    if (!origin) origin = await this.refreshOriginInternal(pid);
    return originToPublic(origin);
  }

  /** 含来源信息的原意识（测试/诊断用，不直接暴露在 shared 类型里）。 */
  async getOriginRecord(personaId?: string): Promise<OriginData | undefined> {
    await this.ready();
    return this.store.origin(personaId ?? this.currentPersonaId());
  }

  async getPoints(personaId?: string, limit = 80): Promise<SeaPoint[]> {
    await this.ready();
    const pid = personaId ?? this.currentPersonaId();
    return toSeaPoints(topSeaPoints(this.store.seaPoints(pid), limit));
  }

  async getAttention(conversationId: string, personaId?: string): Promise<AttentionState | undefined> {
    await this.ready();
    const record = this.store.attention(personaId ?? this.currentPersonaId(), conversationId);
    return record ? toAttentionState(record) : undefined;
  }

  async getFlow(conversationId: string, personaId?: string): Promise<MindFlowState | undefined> {
    await this.ready();
    const record: FlowRecord | undefined = this.store.flow(personaId ?? this.currentPersonaId(), conversationId);
    return record ? toMindFlowState(record) : undefined;
  }

  /** 「上次我们聊到……」连续性 brief + 概览。 */
  async resume(input: ResumeInput = {}): Promise<ResumeResult> {
    await this.ready();
    const personaId = input.personaId ?? this.currentPersonaId();
    const now = this.nowDate();
    let origin = this.store.origin(personaId);
    if (!origin) origin = await this.refreshOriginInternal(personaId);
    const attentionRecords = this.store.attentionList(personaId);
    const conversationId = input.conversationId ?? attentionRecords[0]?.conversationId;
    const attention = conversationId ? this.store.attention(personaId, conversationId) : attentionRecords[0];
    const flow = conversationId ? this.store.flow(personaId, conversationId) : this.store.flowList(personaId)[0];
    let points = this.store.seaPoints(personaId);
    if (points.length === 0) points = await this.enqueue(() => this.refreshSeaInternal(personaId));
    // resume 面对 UI，没有明确的联系人上下文，只允许 persona 级 / global 记忆，避免泄露联系人隐私。
    const allowedPoints = filterPointsByDocs(points, [GLOBAL_DOC_ID]);
    const query = attention?.focus ?? '';
    const point = searchPoints(allowedPoints, query, { topK: 1 })[0];
    const brief = buildResumeBrief({ origin, attention, flow, point, now });
    const overview = await this.overview(personaId);
    const result: ResumeResult = {
      brief,
      overview,
      personaId,
      lastTopics: attention && attention.topics.length > 0 ? [...attention.topics] : [...origin.lastTopics],
      openLoops: attention && attention.unresolved.length > 0 ? [...attention.unresolved] : [...origin.openLoops],
    };
    if (conversationId) result.conversationId = conversationId;
    const lastSeenAt = attention?.updatedAt ?? origin.lastSeenAt;
    if (lastSeenAt) result.lastSeenAt = lastSeenAt;
    return result;
  }

  getStats(): ConsciousnessStats {
    return this.store.stats();
  }
}

/** 一步创建并初始化意识服务（主进程启动时调用）。 */
export async function createConsciousnessService(options: ConsciousnessServiceOptions): Promise<ConsciousnessService> {
  if (!options || !options.dataDir) {
    throw new ConsciousnessError('invalid_options', 'createConsciousnessService 需要 dataDir');
  }
  if (!options.memory || !options.content || !options.personas || !options.growth) {
    throw new ConsciousnessError('invalid_options', 'createConsciousnessService 需要 memory/content/personas/growth');
  }
  return ConsciousnessService.create(options);
}
