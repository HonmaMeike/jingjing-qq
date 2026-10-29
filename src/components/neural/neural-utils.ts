import type {
  NeuralEdge, NeuralEvent, NeuralEventType, NeuralNodeId, NeuralNodeState,
} from '@shared/types';

export const NEURAL_NODE_LABELS: Record<NeuralNodeId, string> = {
  user: '用户',
  core: '原意识核心',
  persona: '人设',
  memories: '识海记忆',
  origin: '原意识',
  attention: '心光',
  flow: '心流',
  forget: '遗忘',
  deepseek: 'DeepSeek',
  tools: '工具',
  tts: 'BreezeBlue 语音',
  media: 'MiniMax / Suno',
  search: 'Serper 搜索',
  napcat: 'NapCat',
  qq: 'QQ',
  emotion: '情绪',
  growth: '成长',
  storage: '本地记忆',
};

export const NEURAL_INNER_RING: NeuralNodeId[] = [
  'persona', 'attention', 'flow', 'emotion', 'growth', 'memories', 'origin', 'forget',
];

export const NEURAL_OUTER_RING: NeuralNodeId[] = [
  'user', 'deepseek', 'tts', 'media', 'search', 'tools', 'storage', 'napcat', 'qq',
];

export const NEURAL_KIND_LABELS: Record<NeuralNodeState['kind'], string> = {
  core: '核心',
  memory: '记忆',
  model: '模型',
  channel: '通道',
  tool: '工具',
  state: '状态',
};

export const NEURAL_NODE_KIND_COLOR: Record<NeuralNodeState['kind'], string> = {
  core: 'var(--brand-2)',
  memory: 'var(--mint)',
  model: 'var(--brand)',
  channel: 'var(--aqua)',
  tool: 'var(--amber)',
  state: 'var(--pink)',
};

export const NEURAL_NODE_KIND_CANVAS_VAR: Record<NeuralNodeState['kind'], string> = {
  core: '--brand-2',
  memory: '--mint',
  model: '--brand',
  channel: '--aqua',
  tool: '--amber',
  state: '--pink',
};

export const NEURAL_STATUS_LABELS: Record<NeuralNodeState['status'], string> = {
  idle: '待机',
  active: '活跃',
  busy: '忙碌',
  error: '异常',
  offline: '离线',
};

export type NeuralEventTone = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'pink' | 'mint';

export interface NeuralEventMeta {
  label: string;
  tone: NeuralEventTone;
  color: string;
  canvasVar: string;
}

export const NEURAL_EVENT_META: Record<NeuralEventType, NeuralEventMeta> = {
  message_in: { label: '收到消息', tone: 'mint', color: 'var(--mint)', canvasVar: '--mint' },
  thought: { label: '思考', tone: 'brand', color: 'var(--brand-2)', canvasVar: '--brand-2' },
  memory: { label: '记忆', tone: 'mint', color: 'var(--mint)', canvasVar: '--mint' },
  context: { label: '上下文', tone: 'brand', color: 'var(--brand-3)', canvasVar: '--brand-3' },
  llm_start: { label: '推理开始', tone: 'brand', color: 'var(--brand)', canvasVar: '--brand' },
  llm_delta: { label: '生成中', tone: 'brand', color: 'var(--brand-2)', canvasVar: '--brand-2' },
  llm_end: { label: '推理完成', tone: 'success', color: 'var(--success)', canvasVar: '--success' },
  tool: { label: '工具调用', tone: 'warning', color: 'var(--amber)', canvasVar: '--amber' },
  tts: { label: '语音合成', tone: 'pink', color: 'var(--pink)', canvasVar: '--pink' },
  media: { label: '媒体生成', tone: 'pink', color: 'var(--pink)', canvasVar: '--pink' },
  state: { label: '状态变化', tone: 'default', color: 'var(--brand-3)', canvasVar: '--brand-3' },
  reply: { label: '回复', tone: 'success', color: 'var(--aqua)', canvasVar: '--aqua' },
  cost: { label: '费用', tone: 'warning', color: 'var(--amber)', canvasVar: '--amber' },
  napcat: { label: 'NapCat', tone: 'mint', color: 'var(--mint)', canvasVar: '--mint' },
  error: { label: '异常', tone: 'danger', color: 'var(--danger)', canvasVar: '--danger' },
  system: { label: '系统', tone: 'default', color: 'var(--text-3)', canvasVar: '--text-3' },
};

export interface NeuralStage {
  key: string;
  label: string;
  detail: string;
  threshold: number;
}

export const NEURAL_STAGES: NeuralStage[] = [
  { key: 'perceive', label: '感知消息', detail: '接收消息、唤醒人设与情绪', threshold: 0.03 },
  { key: 'memory', label: '唤醒识海', detail: '检索长期记忆、关系与上下文', threshold: 0.18 },
  { key: 'context', label: '构建上下文', detail: '原意识、心光与对话窗口合流', threshold: 0.34 },
  { key: 'reason', label: 'DeepSeek 推理', detail: '把上下文交给模型生成回复', threshold: 0.5 },
  { key: 'tools', label: '工具与解析', detail: '搜索、配图、语音与状态协议', threshold: 0.68 },
  { key: 'reply', label: '组织回复', detail: '解析正文、情绪与附件', threshold: 0.82 },
  { key: 'write', label: '写入记忆', detail: '归档、抽取记忆、更新关系与成长', threshold: 0.94 },
  { key: 'done', label: '完成', detail: '一轮思考收束，回到待机', threshold: 1 },
];

export function neuralNodeLabel(id: NeuralNodeId, nodes?: NeuralNodeState[]): string {
  const node = nodes?.find((item) => item.id === id);
  return node?.label ?? NEURAL_NODE_LABELS[id] ?? id;
}

export function neuralEventLabel(type: NeuralEventType): string {
  return NEURAL_EVENT_META[type]?.label ?? type;
}

export function neuralEventTone(type: NeuralEventType): NeuralEventTone {
  return NEURAL_EVENT_META[type]?.tone ?? 'default';
}

export function formatLatency(ms?: number): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '—';
  if (ms <= 0) return '—';
  if (ms < 1000) return Math.round(ms) + ' ms';
  return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s';
}

export function formatCost(value?: number): string {
  const amount = value ?? 0;
  if (!Number.isFinite(amount)) return '¥0.00';
  if (amount > 0 && amount < 0.01) return '¥' + amount.toFixed(4);
  return '¥' + amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatCount(value?: number): string {
  const count = value ?? 0;
  if (!Number.isFinite(count)) return '0';
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 10_000) return (count / 10_000).toFixed(1) + 'w';
  return count.toLocaleString('zh-CN');
}

export function formatTokens(value?: number): string {
  const count = value ?? 0;
  return count.toLocaleString('zh-CN') + ' tokens';
}

export function stageStatus(index: number, progress: number, thinking: boolean): 'done' | 'active' | 'pending' | 'idle' {
  if (!thinking && progress <= 0) return 'idle';
  const stage = NEURAL_STAGES[index];
  if (!stage) return 'pending';
  if (progress >= 1) return 'done';
  if (progress >= stage.threshold) {
    const next = NEURAL_STAGES[index + 1];
    if (!next || progress < next.threshold) return 'active';
    return 'done';
  }
  return 'pending';
}

export function currentStageIndex(progress: number): number {
  for (let index = 0; index < NEURAL_STAGES.length; index += 1) {
    const stage = NEURAL_STAGES[index];
    const next = NEURAL_STAGES[index + 1];
    if (progress < stage.threshold) return Math.max(0, index - 1);
    if (!next || progress < next.threshold) return index;
  }
  return NEURAL_STAGES.length - 1;
}

export function edgeKey(edge: NeuralEdge): string {
  return edge.from + '->' + edge.to;
}

export function eventRoute(event: NeuralEvent, nodes?: NeuralNodeState[]): string {
  if (!event.target) return neuralNodeLabel(event.node, nodes);
  return neuralNodeLabel(event.node, nodes) + ' → ' + neuralNodeLabel(event.target, nodes);
}
