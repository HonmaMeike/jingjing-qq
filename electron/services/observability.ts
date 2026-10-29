import type {
  AppSettings, BillingSettings, NeuralEdge, NeuralEvent, NeuralEventType, NeuralNodeId, NeuralNodeState,
  NeuralSnapshot, UsageByProvider, UsageDay, UsageEntry, UsageSummary, UsageTotals, UsageProvider,
} from '../../shared/types';
import { JsonStore } from '../core/json-store';
import type { EventBus } from '../core/event-bus';
import { nowIso, uid } from '../core/utils';

const NODE_META: Record<NeuralNodeId, { label: string; kind: NeuralNodeState['kind'] }> = {
  user: { label: '用户', kind: 'channel' },
  core: { label: '原意识核心', kind: 'core' },
  persona: { label: '人设', kind: 'state' },
  memories: { label: '识海记忆', kind: 'memory' },
  origin: { label: '原意识', kind: 'memory' },
  attention: { label: '心光', kind: 'state' },
  flow: { label: '心流', kind: 'state' },
  forget: { label: '遗忘', kind: 'memory' },
  deepseek: { label: 'DeepSeek', kind: 'model' },
  tools: { label: '工具', kind: 'tool' },
  tts: { label: 'BreezeBlue 语音', kind: 'model' },
  media: { label: 'MiniMax / Suno', kind: 'model' },
  search: { label: 'Serper 搜索', kind: 'tool' },
  napcat: { label: 'NapCat', kind: 'channel' },
  qq: { label: 'QQ', kind: 'channel' },
  emotion: { label: '情绪', kind: 'state' },
  growth: { label: '成长', kind: 'state' },
  storage: { label: '本地记忆', kind: 'memory' },
};

interface UsageData { entries: UsageEntry[] }
interface TurnState {
  conversationId?: string;
  startedAt: string;
  phase: string;
  progress: number;
  tokens: number;
  latencyMs: number;
}

export class ObservabilityService {
  private events: NeuralEvent[] = [];
  private nodes = new Map<NeuralNodeId, NeuralNodeState>();
  private turn: TurnState | null = null;
  private usageStore: JsonStore<UsageData>;

  private constructor(private usageFile: string, private eventsBus: EventBus, private getSettings: () => AppSettings, usageStore: JsonStore<UsageData>) {
    this.usageStore = usageStore;
    for (const [id, meta] of Object.entries(NODE_META) as [NeuralNodeId, typeof NODE_META[NeuralNodeId]][]) {
      this.nodes.set(id, { id, label: meta.label, kind: meta.kind, status: 'idle', activity: 0 });
    }
    this.eventsBus.emit('neural:snapshot', this.snapshot());
  }

  static async create(opts: { file: string; events: EventBus; getSettings: () => AppSettings }): Promise<ObservabilityService> {
    const store = await JsonStore.open<UsageData>(opts.file, { entries: [] });
    return new ObservabilityService(opts.file, opts.events, opts.getSettings, store);
  }

  recordNeural(input: Omit<NeuralEvent, 'id' | 'at'> & { at?: string }): NeuralEvent {
    const event: NeuralEvent = {
      ...input,
      id: uid('neural-'),
      at: input.at ?? nowIso(),
      detail: input.detail?.slice(0, 600),
    };
    this.events.push(event);
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
    const node = this.nodes.get(event.node);
    if (node) {
      node.status = event.type === 'error' ? 'error' : 'active';
      node.lastEventAt = event.at;
      node.activity = Math.min(100, (node.activity ?? 0) + 8);
      if (event.durationMs !== undefined) node.latencyMs = event.durationMs;
      if (event.detail) node.detail = event.detail.slice(0, 160);
    }
    if (event.target) {
      const target = this.nodes.get(event.target);
      if (target) { target.status = 'active'; target.lastEventAt = event.at; target.activity = Math.min(100, (target.activity ?? 0) + 5); }
    }
    if (event.type === 'llm_delta' && this.turn) this.turn.tokens = Math.max(this.turn.tokens, event.tokens ?? this.turn.tokens);
    this.eventsBus.emit('neural:event', event);
    // 快照节流：高频 token 不推送整包，只在阶段变化时推送
    if (event.type !== 'llm_delta') this.eventsBus.emit('neural:snapshot', this.snapshot());
    return event;
  }

  beginTurn(conversationId?: string, label = '接收消息'): void {
    this.turn = { conversationId, startedAt: nowIso(), phase: label, progress: 0.05, tokens: 0, latencyMs: 0 };
    this.recordNeural({ type: 'state', node: 'core', label: '开始一次思考', detail: label, progress: 0.05, conversationId });
  }

  phase(phase: string, progress: number, options: { node?: NeuralNodeId; detail?: string; conversationId?: string } = {}): void {
    if (!this.turn) this.turn = { conversationId: options.conversationId, startedAt: nowIso(), phase, progress, tokens: 0, latencyMs: 0 };
    this.turn.phase = phase;
    this.turn.progress = Math.max(this.turn.progress, Math.min(1, progress));
    this.turn.latencyMs = Date.now() - new Date(this.turn.startedAt).getTime();
    if (this.turn.conversationId === undefined && options.conversationId) this.turn.conversationId = options.conversationId;
    this.recordNeural({ type: 'thought', node: options.node ?? 'core', label: phase, detail: options.detail, progress, conversationId: options.conversationId ?? this.turn.conversationId });
  }

  addTokens(tokens: number): void {
    if (this.turn) this.turn.tokens += tokens;
  }

  endTurn(conversationId?: string): void {
    if (this.turn) {
      this.turn.progress = 1;
      this.turn.latencyMs = Date.now() - new Date(this.turn.startedAt).getTime();
      this.turn.phase = '完成';
      this.recordNeural({ type: 'state', node: 'core', label: '思考完成', detail: conversationId ?? this.turn.conversationId, progress: 1, durationMs: this.turn.latencyMs, conversationId: conversationId ?? this.turn.conversationId });
    }
    this.turn = null;
  }

  failTurn(message: string): void {
    if (this.turn) this.turn.latencyMs = Date.now() - new Date(this.turn.startedAt).getTime();
    this.recordNeural({ type: 'error', node: 'core', label: '思考中断', detail: message, conversationId: this.turn?.conversationId });
    this.turn = null;
  }

  currentTurn(): TurnState | null { return this.turn; }

  /** 记录一次真实 API 调用及费用（费用按设置中的参考单价估算）。 */
  async recordUsage(input: Omit<UsageEntry, 'id' | 'at' | 'costCny'> & { at?: string; costCny?: number }): Promise<UsageEntry> {
    const settings = this.getSettings();
    const cost = input.costCny ?? this.estimateCost(input, settings.billing);
    const entry: UsageEntry = { ...input, id: uid('usage-'), at: input.at ?? nowIso(), costCny: Math.round(cost * 1000000) / 1000000 };
    try {
      const data = this.usageStore.get();
      data.entries = [entry, ...data.entries].slice(0, 8000);
      await this.usageStore.set(data);
    } catch { /* 记账失败不影响真实调用 */ }
    this.recordNeural({ type: 'cost', node: input.provider === 'deepseek' ? 'deepseek' : input.provider === 'breezeblue' ? 'tts' : input.provider === 'serper' ? 'search' : input.provider === 'suno' || input.provider === 'minimax' ? 'media' : 'storage', label: input.service + ' 消耗', detail: `¥${entry.costCny.toFixed(4)} · ${entry.units} ${entry.unit}`, tokens: entry.totalTokens, data: { provider: input.provider, kind: input.kind } });
    const summary = this.usageSummary();
    this.eventsBus.emit('usage:update', summary);
    return entry;
  }

  private estimateCost(input: Omit<UsageEntry, 'id' | 'at' | 'costCny'>, billing: BillingSettings): number {
    switch (input.provider) {
      case 'deepseek': {
        if (input.kind === 'search') return input.units * (billing.deepseekSearchPerCall ?? 0.005);
        const reasoner = /pro|reasoner/i.test(input.model ?? '');
        const inputRate = reasoner ? billing.deepseekReasonerInputPerMillion : billing.deepseekInputPerMillion;
        const outputRate = reasoner ? billing.deepseekReasonerOutputPerMillion : billing.deepseekOutputPerMillion;
        return ((input.inputTokens ?? 0) / 1_000_000) * inputRate + ((input.outputTokens ?? 0) / 1_000_000) * outputRate;
      }
      case 'breezeblue':
        return (input.units / 1000) * billing.breezePerKChar;
      case 'minimax':
        return input.kind === 'video' ? input.units * billing.minimaxVideoSecond : input.units * billing.minimaxImage;
      case 'suno':
        return input.units * billing.sunoTrack;
      case 'serper':
        return input.units * billing.serperSearch;
      default:
        return 0;
    }
  }

  listUsage(limit = 200): UsageEntry[] { return this.usageStore.get().entries.slice(0, limit); }

  usageSummary(): UsageSummary {
    const entries = this.usageStore.get().entries;
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);
    const monthKey = todayKey.slice(0, 7);
    const totals = (list: UsageEntry[]): UsageTotals => ({
      calls: list.length,
      costCny: list.reduce((sum, e) => sum + e.costCny, 0),
      inputTokens: list.reduce((sum, e) => sum + (e.inputTokens ?? 0), 0),
      outputTokens: list.reduce((sum, e) => sum + (e.outputTokens ?? 0), 0),
      totalTokens: list.reduce((sum, e) => sum + (e.totalTokens ?? 0), 0),
      units: list.reduce((sum, e) => sum + e.units, 0),
    });
    const today = totals(entries.filter((e) => e.at.slice(0, 10) === todayKey));
    const month = totals(entries.filter((e) => e.at.slice(0, 7) === monthKey));
    const all = totals(entries);
    const providers: UsageProvider[] = ['deepseek', 'breezeblue', 'minimax', 'suno', 'serper', 'bilibili', 'napcat', 'memory', 'other'];
    const providerLabels: Record<string, string> = { deepseek: 'DeepSeek', breezeblue: 'BreezeBlue', minimax: 'MiniMax', suno: 'Suno', serper: 'Serper', bilibili: '哔哩哔哩', napcat: 'NapCat', memory: '记忆', other: '其他' };
    const unitFor: Record<string, string> = { deepseek: 'tokens', breezeblue: '字符', minimax: '媒体', suno: '首', serper: '次', bilibili: '次', napcat: '条', memory: '次', other: '次' };
    const maxCost = Math.max(0.000001, ...providers.map((p) => entries.filter((e) => e.provider === p && e.at.slice(0, 7) === monthKey).reduce((s, e) => s + e.costCny, 0)));
    const byProvider: UsageByProvider[] = providers.map((provider) => {
      const list = entries.filter((e) => e.provider === provider && e.at.slice(0, 7) === monthKey);
      const cost = list.reduce((s, e) => s + e.costCny, 0);
      return { provider, label: providerLabels[provider], calls: list.length, costCny: cost, units: list.reduce((s, e) => s + e.units, 0), unit: unitFor[provider], tokens: list.reduce((s, e) => s + (e.totalTokens ?? 0), 0), percent: Math.round((cost / maxCost) * 100) };
    }).filter((p) => p.calls > 0).sort((a, b) => b.costCny - a.costCny);
    const byDay: UsageDay[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      const list = entries.filter((e) => e.at.slice(0, 10) === date);
      byDay.push({ date, costCny: list.reduce((s, e) => s + e.costCny, 0), calls: list.length, tokens: list.reduce((s, e) => s + (e.totalTokens ?? 0), 0) });
    }
    const monthly = this.getSettings().billing.monthlyBudgetCny || 0;
    const remaining = Math.max(0, monthly - month.costCny);
    return {
      today, month, all, byProvider, byDay,
      recent: entries.slice(0, 60),
      budget: { monthlyCny: monthly, usedCny: month.costCny, remainingCny: remaining, percent: monthly ? Math.min(100, Math.round((month.costCny / monthly) * 100)) : 0 },
      generatedAt: nowIso(),
    };
  }

  snapshot(): NeuralSnapshot {
    const now = Date.now();
    const recent = this.events.slice(-120);
    const lastMinute = this.events.filter((e) => now - new Date(e.at).getTime() < 60_000);
    for (const node of this.nodes.values()) {
      const last = node.lastEventAt ? new Date(node.lastEventAt).getTime() : 0;
      if (now - last > 5000) node.status = node.status === 'error' ? 'error' : node.status === 'offline' ? 'offline' : 'idle';
      node.activity = Math.max(0, Math.round((node.activity ?? 0) * 0.92));
    }
    const edgesMap = new Map<string, NeuralEdge>();
    for (const e of this.events.slice(-80)) {
      if (!e.target) continue;
      const key = e.node + '->' + e.target;
      const active = now - new Date(e.at).getTime() < 5000 ? 1 : 0;
      const found = edgesMap.get(key);
      if (found) { found.weight += 1; found.active += active; } else edgesMap.set(key, { from: e.node, to: e.target, weight: 1, active });
    }
    const totalTurnTokens = this.turn?.tokens ?? 0;
    return {
      events: recent,
      nodes: [...this.nodes.values()],
      edges: [...edgesMap.values()].sort((a, b) => b.weight - a.weight).slice(0, 40),
      stats: {
        thinking: !!this.turn,
        phase: this.turn?.phase ?? '待机',
        progress: this.turn?.progress ?? 0,
        eventsPerMin: lastMinute.length,
        tokensThisTurn: totalTurnTokens,
        latencyMs: this.turn?.latencyMs ?? 0,
        conversationId: this.turn?.conversationId,
        startedAt: this.turn?.startedAt,
      },
      costToday: this.usageSummary().today.costCny,
      generatedAt: nowIso(),
    };
  }

  async clearUsage(): Promise<void> { await this.usageStore.set({ entries: [] }); this.eventsBus.emit('usage:update', this.usageSummary()); }

  clearEvents(): void { this.events = []; for (const node of this.nodes.values()) { node.status = 'idle'; node.activity = 0; node.detail = undefined; } this.eventsBus.emit('neural:snapshot', this.snapshot()); }
}
