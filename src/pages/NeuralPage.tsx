import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Bug, Eraser, Pause, Play, Radio, RefreshCw, Trash2,
} from 'lucide-react';
import type { NeuralEvent, NeuralNodeId, NeuralSnapshot } from '@shared/types';
import { api, events as appEvents } from '@/lib/api';
import {
  Badge, Button, Card, CardBody, CardHead, IconButton, Modal, PageHeader, Spinner, useToast,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { NeuralCanvas } from '@/components/neural/NeuralCanvas';
import {
  DialogueFlowCard, EdgeNetworkCard, EventStreamCard, NodeStatusCard, ThinkProcessCard, TodayCostCard,
} from '@/components/neural/NeuralCards';
import { NeuralDebugPanel } from '@/components/neural/NeuralDebugPanel';
import { formatCost, formatCount } from '@/components/neural/neural-utils';
import '@/styles/neural.css';

const POLL_MS = 1500;

function parseTime(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}

function mergeEvents(current: NeuralEvent[], incoming: NeuralEvent[], clearedAt: number): NeuralEvent[] {
  const map = new Map<string, NeuralEvent>();
  for (const event of [...incoming, ...current]) {
    if (clearedAt && parseTime(event.at) <= clearedAt) continue;
    map.set(event.id, event);
  }
  return Array.from(map.values())
    .sort((left, right) => parseTime(right.at) - parseTime(left.at))
    .slice(0, 160);
}

function applyEventToSnapshot(previous: NeuralSnapshot, event: NeuralEvent): NeuralSnapshot {
  const nodes = previous.nodes.map((node) => {
    if (node.id === event.node) {
      return {
        ...node,
        status: event.type === 'error' ? 'error' as const : 'active' as const,
        activity: Math.min(100, (node.activity ?? 0) + 9),
        lastEventAt: event.at,
        latencyMs: event.durationMs ?? node.latencyMs,
        detail: event.detail ? event.detail.slice(0, 160) : node.detail,
      };
    }
    if (event.target && node.id === event.target) {
      return {
        ...node,
        status: 'active' as const,
        activity: Math.min(100, (node.activity ?? 0) + 5),
        lastEventAt: event.at,
      };
    }
    return node;
  });
  let edges = previous.edges;
  if (event.target && event.target !== event.node) {
    const index = edges.findIndex((edge) => edge.from === event.node && edge.to === event.target);
    if (index >= 0) {
      edges = edges.map((edge, edgeIndex) => edgeIndex === index ? { ...edge, weight: edge.weight + 1, active: edge.active + 1 } : edge);
    } else {
      edges = [{ from: event.node, to: event.target, weight: 1, active: 1 }, ...edges].slice(0, 40);
    }
  }
  const stats = { ...previous.stats };
  if (event.progress !== undefined) {
    stats.progress = Math.max(stats.progress ?? 0, Math.min(1, event.progress));
    stats.phase = event.label || stats.phase;
    stats.thinking = event.progress < 1 && !/完成|中断/.test(event.label);
  }
  if (event.type === 'error') stats.thinking = false;
  if (event.tokens !== undefined) stats.tokensThisTurn = Math.max(stats.tokensThisTurn ?? 0, event.tokens);
  if (event.durationMs !== undefined) stats.latencyMs = event.durationMs;
  stats.eventsPerMin = (stats.eventsPerMin ?? 0) + 1;
  return { ...previous, nodes, edges, stats };
}

export default function NeuralPage() {
  const toast = useToast();
  const [snapshot, setSnapshot] = useState<NeuralSnapshot | null>(null);
  const [eventLog, setEventLog] = useState<NeuralEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [debug, setDebug] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<{ from: NeuralNodeId; to: NeuralNodeId } | null>(null);
  const [hoverNode, setHoverNode] = useState<NeuralNodeId | null>(null);
  const [clearSignal, setClearSignal] = useState(0);
  const [confirmBackendClear, setConfirmBackendClear] = useState(false);
  const [clearingBackend, setClearingBackend] = useState(false);

  const pausedRef = useRef(false);
  const snapshotRef = useRef<NeuralSnapshot | null>(null);
  const clearedAtRef = useRef(0);
  const loadSeqRef = useRef(0);
  const pollingRef = useRef(false);

  const loadSnapshot = useCallback(async (initial = false) => {
    const seq = ++loadSeqRef.current;
    if (initial) setLoading(true);
    try {
      const next = await api.neural.snapshot();
      if (seq !== loadSeqRef.current) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setLastSync(next.generatedAt);
      setSyncError(null);
      if (initial) setError(null);
      setEventLog((previous) => mergeEvents(previous, next.events, clearedAtRef.current));
    } catch (cause) {
      if (seq !== loadSeqRef.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setSyncError(message);
      if (!snapshotRef.current) setError(message);
    } finally {
      if (initial) setLoading(false);
      pollingRef.current = false;
    }
  }, []);

  useEffect(() => { void loadSnapshot(true); }, [loadSnapshot]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pausedRef.current || pollingRef.current) return;
      pollingRef.current = true;
      void loadSnapshot(false);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadSnapshot]);

  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = appEvents.on('neural:event', (event) => {
        if (pausedRef.current) return;
        setEventLog((previous) => mergeEvents(previous, [event], clearedAtRef.current));
        setSnapshot((previous) => (previous ? applyEventToSnapshot(previous, event) : previous));
      });
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => off?.();
  }, []);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadSnapshot(false);
    } finally {
      setRefreshing(false);
    }
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    pausedRef.current = next;
    if (!next) void loadSnapshot(false);
  };

  const clearView = () => {
    clearedAtRef.current = Date.now();
    setEventLog([]);
    setSnapshot((previous) => (previous ? { ...previous, events: [] } : previous));
    setClearSignal((value) => value + 1);
    toast.info('本地视图已清空', '服务端事件记录不受影响，新的真实事件仍会流入。');
  };

  const resetBackend = async () => {
    if (clearingBackend) return;
    setClearingBackend(true);
    try {
      await api.neural.clear();
      const next = await api.neural.snapshot();
      snapshotRef.current = next;
      setSnapshot(next);
      setEventLog(next.events);
      setLastSync(next.generatedAt);
      clearedAtRef.current = 0;
      setClearSignal((value) => value + 1);
      setConfirmBackendClear(false);
      toast.success('服务端神经事件已清空', '节点状态已回到待机，实时流会重新开始累积。');
    } catch (cause) {
      toast.error('清空服务端事件失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClearingBackend(false);
    }
  };

  const nodes = snapshot?.nodes ?? [];
  const activeNodes = nodes.filter((node) => node.status === 'active' || node.status === 'busy').length;
  const errorNodes = nodes.filter((node) => node.status === 'error').length;
  const stats = snapshot?.stats;
  const liveTone = !snapshot ? 'default' : paused ? 'warning' : syncError ? 'danger' : 'success';
  const liveLabel = !snapshot ? '连接中' : paused ? '已暂停' : syncError ? '快照异常' : '实时在线';

  return (
    <div className="neural-page">
      <PageHeader
        eyebrow="NEURAL CORE · LIVE"
        icon={<Activity size={12} />}
        title="神经中枢"
        desc="深海神经网由真实事件驱动：原意识、识海、模型与 QQ 通道的每一次真实活动，都会沿连接线亮起。"
        actions={(
          <>
            <Badge tone={liveTone} dot>{liveLabel}</Badge>
            <Button size="sm" variant={paused ? 'primary' : 'secondary'} icon={paused ? <Play size={14} /> : <Pause size={14} />} onClick={togglePause} disabled={!snapshot}>{paused ? '继续实时流' : '暂停实时流'}</Button>
            <Button size="sm" variant="ghost" icon={<Eraser size={14} />} onClick={clearView} disabled={!snapshot || eventLog.length === 0}>清空视图</Button>
            <IconButton label="刷新神经快照" active={refreshing} onClick={() => void refresh()}><RefreshCw size={16} className={refreshing ? 'spin' : undefined} /></IconButton>
            <Button size="sm" variant={debug ? 'secondary' : 'ghost'} icon={<Bug size={14} />} onClick={() => setDebug((value) => !value)}>调试</Button>
          </>
        )}
      />

      {loading && !snapshot ? (
        <Card className="neural-loading-card">
          <CardBody>
            <div className="neural-loading__head"><Spinner label="正在接入神经快照…" /></div>
            <div className="neural-loading__canvas skeleton" />
            <div className="neural-loading__row">
              <span className="skeleton" style={{ height: 44 }} />
              <span className="skeleton" style={{ height: 44 }} />
              <span className="skeleton" style={{ height: 44 }} />
            </div>
          </CardBody>
        </Card>
      ) : error && !snapshot ? (
        <Card className="neural-error-card">
          <CardBody>
            <div className="neural-error__icon"><AlertTriangle size={24} /></div>
            <div className="neural-error__title">神经中枢暂时无法连接</div>
            <div className="neural-error__desc">{error}</div>
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => void loadSnapshot(true)}>重新连接</Button>
            <div className="neural-error__hint">连接失败时不会展示伪造的神经活动；请检查桌面主进程与神经快照服务。</div>
          </CardBody>
        </Card>
      ) : snapshot ? (
        <>
          <div className="neural-livebar">
            <span className={'neural-livebar__status ' + (paused ? 'is-paused' : syncError ? 'is-error' : '')}>
              <span className="neural-livebar__pulse" />
              {paused ? '实时流已暂停' : syncError ? '快照同步异常' : '实时流在线'}
            </span>
            <span className="neural-livebar__chip"><Radio size={12} /> 事件/分 <b>{formatCount(stats?.eventsPerMin)}</b></span>
            <span className="neural-livebar__chip"><Activity size={12} /> 活跃节点 <b>{activeNodes}</b> / {nodes.length}</span>
            <span className="neural-livebar__chip"><Activity size={12} /> 阶段 <b>{stats?.phase || '待机'}</b></span>
            <span className="neural-livebar__chip"><span className="neural-livebar__cost">¥</span> 今日 <b>{formatCost(snapshot.costToday).replace('¥', '')}</b></span>
            {errorNodes > 0 && <Badge tone="danger">{errorNodes} 个节点异常</Badge>}
            <span className="spacer" />
            <span className="neural-livebar__time">{lastSync ? '快照 ' + relativeTime(lastSync) : '等待快照'} · 1.5s 兜底轮询</span>
          </div>

          {syncError && (
            <div className="neural-alert">
              <AlertTriangle size={14} />
              <span>实时快照同步失败：{syncError}</span>
              <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void refresh()}>重试</Button>
            </div>
          )}

          <div className="neural-main">
            <Card className="neural-card neural-canvas-card">
              <CardHead
                title="神经网 · 实时拓扑"
                desc="节点为真实组件状态，粒子只沿真实事件流动"
                icon={<Radio size={16} />}
                extra={(
                  <>
                    <Badge tone={paused ? 'warning' : 'brand'} dot>{paused ? '冻结中' : 'LIVE'}</Badge>
                    <Badge>{activeNodes} 活跃 / {nodes.length} 节点</Badge>
                    <Badge tone="mint">{formatCount(stats?.eventsPerMin)} 事件/分</Badge>
                  </>
                )}
              />
              <CardBody className="neural-canvas-card__body">
                <NeuralCanvas
                  nodes={nodes}
                  edges={snapshot.edges}
                  events={eventLog}
                  paused={paused}
                  highlightNode={hoverNode}
                  highlightEdge={hoverEdge}
                  clearSignal={clearSignal}
                  onHoverNode={setHoverNode}
                />
              </CardBody>
            </Card>
            <div className="neural-side">
              <ThinkProcessCard snapshot={snapshot} />
              <TodayCostCard snapshot={snapshot} onOpenCosts={() => { window.location.hash = '/costs'; }} />
            </div>
          </div>

          <div className="neural-lower">
            <EventStreamCard events={eventLog} nodes={nodes} paused={paused} />
            <EdgeNetworkCard edges={snapshot.edges} nodes={nodes} highlightEdge={hoverEdge} onHoverEdge={setHoverEdge} />
            <DialogueFlowCard snapshot={snapshot} />
          </div>

          <NodeStatusCard nodes={nodes} onHoverNode={setHoverNode} highlightNode={hoverNode} />

          {debug && <NeuralDebugPanel events={eventLog} paused={paused} onRequestBackendClear={() => setConfirmBackendClear(true)} />}
        </>
      ) : null}

      <Modal
        open={confirmBackendClear}
        onClose={() => setConfirmBackendClear(false)}
        title="清空服务端神经事件？"
        desc="这会清除后端缓存的最近事件与节点状态，不只是本地视图。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirmBackendClear(false)}>取消</Button>
            <Button variant="danger" icon={<Trash2 size={14} />} loading={clearingBackend} onClick={() => void resetBackend()}>确认清空</Button>
          </>
        )}
      >
        <div className="callout callout--warning">
          <AlertTriangle size={15} className="callout__icon" />
          <div>清空后无法恢复历史神经事件。聊天、记忆和人设数据不会受影响；正在进行的思考会继续产生新事件。</div>
        </div>
      </Modal>
    </div>
  );
}
