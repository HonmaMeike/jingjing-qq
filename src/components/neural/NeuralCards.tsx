import type { NeuralEdge, NeuralEvent, NeuralEventType, NeuralNodeId, NeuralNodeState, NeuralSnapshot } from '@shared/types';
import {
  Activity, AlertTriangle, ArrowUpRight, AudioLines, Brain, Check, CircleDollarSign, Clock3,
  Coins, Cpu, Gauge, Image as ImageIcon, Info, Layers, MessagesSquare,
  Send, Sparkles, TerminalSquare, Wallet, Wrench, Zap,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHead, EmptyState, Progress, Ring } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import {
  NEURAL_STAGES, currentStageIndex, eventRoute, formatCost, formatCount,
  formatLatency, formatTokens, neuralEventLabel, neuralEventTone, neuralNodeLabel, stageStatus,
} from './neural-utils';

function eventIcon(type: NeuralEventType) {
  switch (type) {
    case 'message_in': return <MessagesSquare size={13} />;
    case 'thought': return <Sparkles size={13} />;
    case 'memory': return <Brain size={13} />;
    case 'context': return <Layers size={13} />;
    case 'llm_start': return <Zap size={13} />;
    case 'llm_delta': return <Activity size={13} />;
    case 'llm_end': return <Check size={13} />;
    case 'tool': return <Wrench size={13} />;
    case 'tts': return <AudioLines size={13} />;
    case 'media': return <ImageIcon size={13} />;
    case 'state': return <Gauge size={13} />;
    case 'reply': return <Send size={13} />;
    case 'cost': return <Coins size={13} />;
    case 'napcat': return <TerminalSquare size={13} />;
    case 'error': return <AlertTriangle size={13} />;
    default: return <Info size={13} />;
  }
}

export function ThinkProcessCard({ snapshot }: { snapshot: NeuralSnapshot }) {
  const stats = snapshot.stats;
  const progress = Math.max(0, Math.min(1, stats.progress ?? 0));
  const startedAt = stats.startedAt ? new Date(stats.startedAt).getTime() : 0;
  const elapsed = stats.thinking && startedAt ? Date.now() - startedAt : stats.latencyMs;
  return (
    <Card className="neural-card neural-think-card">
      <CardHead
        title="思考进程"
        desc="当前一轮真实对话的神经活动"
        icon={<Brain size={16} />}
        extra={<Badge tone={stats.thinking ? 'success' : 'default'} dot>{stats.thinking ? '思考中' : '待机'}</Badge>}
      />
      <CardBody>
        <div className="neural-think">
          <Ring value={progress * 100} label={stats.thinking ? Math.round(progress * 100) + '%' : '待机'} size={92} />
          <div className="neural-think__copy">
            <div className="neural-eyebrow">CURRENT PHASE</div>
            <div className="neural-think__phase">{stats.phase || '待机'}</div>
            <div className="neural-think__hint">
              {stats.thinking ? '意识正在沿真实事件推进，阶段来自后端快照。' : '等待下一条消息，神经网保持低功耗呼吸。'}
            </div>
          </div>
        </div>
        <div className="neural-think__metrics">
          <div className="neural-metric">
            <span>本轮 tokens</span>
            <strong>{formatCount(stats.tokensThisTurn)}</strong>
          </div>
          <div className="neural-metric">
            <span>延迟</span>
            <strong>{formatLatency(elapsed)}</strong>
          </div>
          <div className="neural-metric">
            <span>事件 / 分钟</span>
            <strong>{formatCount(stats.eventsPerMin)}</strong>
          </div>
        </div>
        {stats.thinking ? (
          <div className="neural-think__wave">
            {[10, 16, 8, 22, 13, 18, 9, 24, 15, 11, 20, 7].map((height, index) => (
              <i key={index} style={{ height, animationDelay: index * 55 + 'ms' }} />
            ))}
          </div>
        ) : (
          <div className="neural-think__idle"><Clock3 size={13} /> 神经网待机中</div>
        )}
      </CardBody>
    </Card>
  );
}

export function TodayCostCard({ snapshot, onOpenCosts }: { snapshot: NeuralSnapshot; onOpenCosts: () => void }) {
  return (
    <Card className="neural-card neural-cost-card">
      <CardHead title="今日费用" desc="真实 API 调用按设置单价估算" icon={<Wallet size={16} />} extra={<Badge tone={snapshot.costToday > 0 ? 'warning' : 'default'}>{snapshot.costToday > 0 ? '产生中' : '无消耗'}</Badge>} />
      <CardBody>
        <div className="neural-cost">
          <div className="neural-cost__amount">{formatCost(snapshot.costToday)}</div>
          <div className="neural-cost__sub">今日累计 · 截至 {relativeTime(snapshot.generatedAt)}</div>
        </div>
        <div className="neural-cost__note">
          <CircleDollarSign size={13} />
          费用来自真实 token 与媒体调用记录，单价可在费用账本中修改。
        </div>
        <Button variant="secondary" size="sm" block icon={<ArrowUpRight size={14} />} onClick={onOpenCosts}>打开费用账本</Button>
      </CardBody>
    </Card>
  );
}

export function EventStreamCard({ events, nodes, paused }: { events: NeuralEvent[]; nodes: NeuralNodeState[]; paused: boolean }) {
  const visible = events.slice(0, 40);
  return (
    <Card className="neural-card neural-stream-card">
      <CardHead
        title="数据流"
        desc="最近真实事件沿神经边流动"
        icon={<Activity size={16} />}
        extra={<Badge tone={paused ? 'warning' : 'brand'} dot>{paused ? '已冻结' : visible.length + ' 条'}</Badge>}
      />
      <CardBody className="neural-stream-card__body">
        {visible.length === 0 ? (
          <EmptyState icon={<Activity size={21} />} title="还没有实时事件" desc="在聊天页发送一条消息，神经网会随着真实调用逐节点亮起。" />
        ) : (
          <div className="neural-stream">
            {visible.map((event) => {
              return (
                <div className={'neural-event is-' + event.type} key={event.id}>
                  <span className="neural-event__icon">{eventIcon(event.type)}</span>
                  <div className="neural-event__body">
                    <div className="neural-event__top">
                      <span className="neural-event__label">{event.label}</span>
                      <Badge tone={neuralEventTone(event.type)}>{neuralEventLabel(event.type)}</Badge>
                      <span className="neural-event__time">{relativeTime(event.at)}</span>
                    </div>
                    <div className="neural-event__route">{eventRoute(event, nodes)}</div>
                    {event.detail && <div className="neural-event__detail">{event.detail}</div>}
                    <div className="neural-event__meta">
                      {event.tokens ? <span>{formatTokens(event.tokens)}</span> : null}
                      {event.durationMs ? <span>{formatLatency(event.durationMs)}</span> : null}
                      {event.progress !== undefined ? <span>进度 {Math.round(event.progress * 100)}%</span> : null}
                      {event.value !== undefined ? <span>值 {event.value}</span> : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function EdgeNetworkCard({
  edges, nodes, highlightEdge, onHoverEdge,
}: {
  edges: NeuralEdge[];
  nodes: NeuralNodeState[];
  highlightEdge: { from: NeuralNodeId; to: NeuralNodeId } | null;
  onHoverEdge: (edge: { from: NeuralNodeId; to: NeuralNodeId } | null) => void;
}) {
  const visible = edges.slice(0, 16);
  const maxWeight = Math.max(1, ...visible.map((edge) => edge.weight));
  return (
    <Card className="neural-card neural-edge-card">
      <CardHead
        title="发散网络"
        desc="连接由事件累积，悬停可高亮"
        icon={<Layers size={16} />}
        extra={<Badge tone={edges.length > 0 ? 'brand' : 'default'}>{edges.length} 条连接</Badge>}
      />
      <CardBody>
        {visible.length === 0 ? (
          <EmptyState icon={<Layers size={21} />} title="还没有形成连接" desc="当真实事件带目标节点时，神经网会在这里长出第一条连接。" />
        ) : (
          <div className="neural-edges">
            {visible.map((edge) => {
              const active = edge.active > 0;
              const highlighted = highlightEdge?.from === edge.from && highlightEdge?.to === edge.to;
              return (
                <div
                  className={'neural-edge' + (highlighted ? ' is-highlighted' : '') + (active ? ' is-active' : '')}
                  key={edge.from + '->' + edge.to}
                  tabIndex={0}
                  onMouseEnter={() => onHoverEdge({ from: edge.from, to: edge.to })}
                  onMouseLeave={() => onHoverEdge(null)}
                  onFocus={() => onHoverEdge({ from: edge.from, to: edge.to })}
                  onBlur={() => onHoverEdge(null)}
                >
                  <div className="neural-edge__route">
                    <span>{neuralNodeLabel(edge.from, nodes)}</span>
                    <span className="neural-edge__arrow">→</span>
                    <span>{neuralNodeLabel(edge.to, nodes)}</span>
                  </div>
                  <div className="neural-edge__stats">
                    <span className="neural-edge__weight">权重 {edge.weight}</span>
                    {active && <Badge tone="mint" dot>活跃</Badge>}
                  </div>
                  <div className="neural-edge__bar">
                    <span style={{ width: Math.max(6, (edge.weight / maxWeight) * 100) + '%' }} />
                    {active && <i style={{ width: Math.max(3, Math.min(100, (edge.active / Math.max(1, edge.weight)) * 100)) + '%' }} />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export function DialogueFlowCard({ snapshot }: { snapshot: NeuralSnapshot }) {
  const { thinking, progress, phase } = snapshot.stats;
  const activeIndex = thinking ? currentStageIndex(progress) : -1;
  return (
    <Card className="neural-card neural-flow-card">
      <CardHead
        title="对话进程"
        desc="phase / progress 驱动的阶段"
        icon={<MessagesSquare size={16} />}
        extra={<Badge tone={thinking ? 'brand' : 'default'}>{Math.round((progress ?? 0) * 100)}%</Badge>}
      />
      <CardBody>
        <div className="neural-flow__phase">
          <span className="neural-flow__dot" />
          <strong>{phase || '待机'}</strong>
          <span>{thinking ? '进行中' : '等待下一条消息'}</span>
        </div>
        <Progress value={(progress ?? 0) * 100} thin />
        <div className="neural-flow__stages">
          {NEURAL_STAGES.map((stage, index) => {
            const status = stageStatus(index, progress ?? 0, thinking);
            const isActive = index === activeIndex;
            return (
              <div className={'neural-stage is-' + status + (isActive ? ' is-current' : '')} key={stage.key}>
                <span className="neural-stage__dot">{status === 'done' ? <Check size={10} /> : index + 1}</span>
                <div className="neural-stage__copy">
                  <div className="neural-stage__label">{stage.label}</div>
                  <div className="neural-stage__detail">{stage.detail}</div>
                </div>
                <span className="neural-stage__state">
                  {status === 'done' ? '完成' : status === 'active' ? '进行中' : '待机'}
                </span>
              </div>
            );
          })}
        </div>
        <div className="neural-flow__foot">
          <span><Zap size={12} /> {formatTokens(snapshot.stats.tokensThisTurn)}</span>
          <span><Clock3 size={12} /> {formatLatency(snapshot.stats.latencyMs)}</span>
        </div>
      </CardBody>
    </Card>
  );
}

export function NodeStatusCard({
  nodes, onHoverNode, highlightNode,
}: {
  nodes: NeuralNodeState[];
  onHoverNode: (id: NeuralNodeId | null) => void;
  highlightNode: NeuralNodeId | null;
}) {
  const activeCount = nodes.filter((node) => node.status === 'active' || node.status === 'busy').length;
  const errorCount = nodes.filter((node) => node.status === 'error').length;
  const groups = ['core', 'memory', 'model', 'channel', 'tool', 'state'] as NeuralNodeState['kind'][];
  return (
    <Card className="neural-card neural-nodes-card">
      <CardHead
        title="组件状态"
        desc="来自神经快照的节点状态、延迟与最近事件"
        icon={<Cpu size={16} />}
        extra={<><Badge tone={activeCount ? 'success' : 'default'} dot>{activeCount} 活跃</Badge>{errorCount > 0 && <Badge tone="danger">{errorCount} 异常</Badge>}</>}
      />
      <CardBody>
        {nodes.length === 0 ? (
          <EmptyState icon={<Cpu size={21} />} title="暂无节点快照" desc="等待神经中枢返回节点状态。" />
        ) : (
          <div className="neural-node-groups">
            {groups.map((kind) => {
              const list = nodes.filter((node) => node.kind === kind);
              if (list.length === 0) return null;
              return (
                <section className="neural-node-group" key={kind}>
                  <div className="neural-node-group__head">
                    <span>{kind === 'core' ? '核心' : kind === 'memory' ? '记忆区' : kind === 'model' ? '模型区' : kind === 'channel' ? '通道区' : kind === 'tool' ? '工具区' : '状态区'}</span>
                    <span className="neural-node-group__count">{list.length}</span>
                  </div>
                  <div className="neural-node-grid">
                    {list.map((node) => (
                      <div
                        className={'neural-node-tile is-' + node.status + (highlightNode === node.id ? ' is-highlighted' : '')}
                        key={node.id}
                        tabIndex={0}
                        onMouseEnter={() => onHoverNode(node.id)}
                        onMouseLeave={() => onHoverNode(null)}
                        onFocus={() => onHoverNode(node.id)}
                        onBlur={() => onHoverNode(null)}
                      >
                        <div className="neural-node-tile__top">
                          <span className={'neural-status-dot is-' + node.status} />
                          <span className="neural-node-tile__label">{node.label}</span>
                          <span className="neural-node-tile__kind">{kind === 'core' ? '核心' : kind === 'memory' ? '记忆' : kind === 'model' ? '模型' : kind === 'channel' ? '通道' : kind === 'tool' ? '工具' : '状态'}</span>
                        </div>
                        <div className="neural-node-tile__bar"><span style={{ width: Math.max(0, Math.min(100, node.activity ?? 0)) + '%' }} /></div>
                        <div className="neural-node-tile__meta">
                          <span>{node.status === 'error' ? '异常' : node.status === 'busy' ? '忙碌' : node.status === 'active' ? '活跃' : node.status === 'offline' ? '离线' : '待机'}</span>
                          <span>{node.latencyMs ? formatLatency(node.latencyMs) : '—'}</span>
                          <span>{node.lastEventAt ? relativeTime(node.lastEventAt) : '无事件'}</span>
                        </div>
                        {node.detail && <div className="neural-node-tile__detail">{node.detail}</div>}
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

