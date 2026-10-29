import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Pause } from 'lucide-react';
import type { NeuralEdge, NeuralEvent, NeuralNodeId, NeuralNodeState } from '@shared/types';
import { relativeTime } from '@/lib/format';
import {
  NEURAL_EVENT_META,
  NEURAL_INNER_RING,
  NEURAL_KIND_LABELS,
  NEURAL_NODE_KIND_CANVAS_VAR,
  NEURAL_OUTER_RING,
  NEURAL_STATUS_LABELS,
  formatLatency,
  neuralNodeLabel,
} from './neural-utils';

interface NeuralCanvasProps {
  nodes: NeuralNodeState[];
  edges: NeuralEdge[];
  events: NeuralEvent[];
  paused: boolean;
  highlightNode?: NeuralNodeId | null;
  highlightEdge?: { from: NeuralNodeId; to: NeuralNodeId } | null;
  clearSignal?: number;
  onHoverNode?: (id: NeuralNodeId | null) => void;
}

interface LayoutPoint {
  id: NeuralNodeId;
  x: number;
  y: number;
  r: number;
  ring: 'core' | 'inner' | 'outer';
}

interface Particle {
  from: NeuralNodeId;
  to: NeuralNodeId;
  age: number;
  duration: number;
  color: string;
  size: number;
}

interface ThemeColors {
  brand: string;
  brand2: string;
  brand3: string;
  aqua: string;
  mint: string;
  pink: string;
  amber: string;
  danger: string;
  success: string;
  text1: string;
  text2: string;
  text3: string;
  bg1: string;
  bg2: string;
}

function readTheme(): ThemeColors {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    brand: read('--brand', '#4d8dff'),
    brand2: read('--brand-2', '#64e6ff'),
    brand3: read('--brand-3', '#7c6cff'),
    aqua: read('--aqua', '#64e6ff'),
    mint: read('--mint', '#58e6b3'),
    pink: read('--pink', '#ff8fce'),
    amber: read('--amber', '#ffc56e'),
    danger: read('--danger', '#ff6b81'),
    success: read('--success', '#52dba8'),
    text1: read('--text-1', '#eef7ff'),
    text2: read('--text-2', '#a9c1d9'),
    text3: read('--text-3', '#6d88a3'),
    bg1: read('--bg-1', '#07111f'),
    bg2: read('--bg-2', '#0a1627'),
  };
}

function themeColor(name: string | undefined, theme: ThemeColors): string {
  if (!name) return theme.brand2;
  const map: Record<string, string> = {
    '--brand': theme.brand,
    '--brand-2': theme.brand2,
    '--brand-3': theme.brand3,
    '--aqua': theme.aqua,
    '--mint': theme.mint,
    '--pink': theme.pink,
    '--amber': theme.amber,
    '--danger': theme.danger,
    '--success': theme.success,
    '--text-1': theme.text1,
    '--text-2': theme.text2,
    '--text-3': theme.text3,
  };
  return map[name] ?? theme.brand2;
}

function withAlpha(color: string, alpha: number): string {
  const value = Math.max(0, Math.min(1, alpha));
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const raw = match[1];
  const red = parseInt(raw.slice(0, 2), 16);
  const green = parseInt(raw.slice(2, 4), 16);
  const blue = parseInt(raw.slice(4, 6), 16);
  return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + value + ')';
}

function buildLayout(width: number, height: number): LayoutPoint[] {
  const cx = width / 2;
  const cy = height / 2;
  const outerX = Math.max(80, Math.min(width * 0.425, width / 2 - 72));
  const outerY = Math.max(56, Math.min(height * 0.35, height / 2 - 80));
  const innerX = outerX * 0.55;
  const innerY = outerY * 0.55;
  const points: LayoutPoint[] = [{ id: 'core', x: cx, y: cy, r: 30, ring: 'core' }];
  NEURAL_INNER_RING.forEach((id, index) => {
    const angle = -Math.PI / 2 + (index / NEURAL_INNER_RING.length) * Math.PI * 2 + Math.PI / 10;
    points.push({ id, x: cx + Math.cos(angle) * innerX, y: cy + Math.sin(angle) * innerY, r: 15.5, ring: 'inner' });
  });
  NEURAL_OUTER_RING.forEach((id, index) => {
    const angle = -Math.PI / 2 + (index / NEURAL_OUTER_RING.length) * Math.PI * 2;
    points.push({ id, x: cx + Math.cos(angle) * outerX, y: cy + Math.sin(angle) * outerY, r: 13, ring: 'outer' });
  });
  return points;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 3);
}

function drawLine(
  ctx: CanvasRenderingContext2D,
  from: LayoutPoint,
  to: LayoutPoint,
  color: string,
  width: number,
  alpha: number,
  dashOffset?: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.strokeStyle = withAlpha(color, alpha);
  ctx.lineWidth = width;
  if (dashOffset !== undefined) {
    ctx.setLineDash([4, 7]);
    ctx.lineDashOffset = dashOffset;
  }
  ctx.stroke();
  ctx.restore();
}

export function NeuralCanvas({
  nodes, edges, events, paused, highlightNode, highlightEdge, clearSignal = 0, onHoverNode,
}: NeuralCanvasProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef({ w: 0, h: 0 });
  const layoutRef = useRef<LayoutPoint[]>([]);
  const themeRef = useRef<ThemeColors>(readTheme());
  const particlesRef = useRef<Particle[]>([]);
  const pulseRef = useRef<Map<NeuralNodeId, number>>(new Map());
  const seenRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const hoverIdRef = useRef<NeuralNodeId | null>(null);
  const [hover, setHover] = useState<{ id: NeuralNodeId; x: number; y: number } | null>(null);
  const dataRef = useRef({ nodes, edges, events, paused, highlightNode, highlightEdge });
  dataRef.current = { nodes, edges, events, paused, highlightNode, highlightEdge };

  useEffect(() => {
    const refresh = () => { themeRef.current = readTheme(); };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    let frame = 0;
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      if (sizeRef.current.w !== rect.width || sizeRef.current.h !== rect.height) {
        sizeRef.current = { w: rect.width, h: rect.height };
        layoutRef.current = buildLayout(rect.width, rect.height);
      }
      const context = canvas.getContext('2d');
      if (context) context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(wrap);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!initializedRef.current) {
      for (const event of events) seenRef.current.add(event.id);
      initializedRef.current = true;
      return;
    }
    const fresh: NeuralEvent[] = [];
    for (const event of events) {
      if (seenRef.current.has(event.id)) continue;
      seenRef.current.add(event.id);
      fresh.push(event);
    }
    if (seenRef.current.size > 1200) {
      seenRef.current = new Set(events.map((event) => event.id));
    }
    if (dataRef.current.paused || fresh.length === 0) return;
    const layout = layoutRef.current;
    if (layout.length === 0) return;
    const now = performance.now();
    for (const event of fresh.slice(0, 12)) {
      const from = layout.find((point) => point.id === event.node);
      const toId = event.target ?? (event.node === 'core' ? 'core' : 'core');
      const to = layout.find((point) => point.id === toId);
      if (!from || !to) continue;
      pulseRef.current.set(from.id, now);
      if (event.target) pulseRef.current.set(to.id, now);
      if (from.id === to.id) continue;
      const color = themeColor(NEURAL_EVENT_META[event.type]?.canvasVar, themeRef.current);
      for (let index = 0; index < 3; index += 1) {
        particlesRef.current.push({
          from: from.id,
          to: to.id,
          age: -index * 110,
          duration: 820 + index * 80,
          color,
          size: index === 0 ? 3.2 : 2.3,
        });
      }
    }
    if (particlesRef.current.length > 260) particlesRef.current.splice(0, particlesRef.current.length - 260);
  }, [events]);

  useEffect(() => {
    if (clearSignal <= 0) return;
    particlesRef.current = [];
    pulseRef.current.clear();
  }, [clearSignal]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    let frameId = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const data = dataRef.current;
      if (!data.paused) {
        for (const particle of particlesRef.current) particle.age += dt;
        particlesRef.current = particlesRef.current.filter((particle) => particle.age < particle.duration + 140);
        for (const [id, at] of pulseRef.current) {
          if (now - at > 900) pulseRef.current.delete(id);
        }
      }
      drawScene(context, now, data, themeRef.current, layoutRef.current, particlesRef.current, pulseRef.current, hoverIdRef.current);
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, []);

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let found: LayoutPoint | null = null;
    for (const point of layoutRef.current) {
      const dx = point.x - x;
      const dy = point.y - y;
      if (dx * dx + dy * dy <= (point.r + 13) * (point.r + 13)) { found = point; break; }
    }
    const nextId = found?.id ?? null;
    if (hoverIdRef.current === nextId) return;
    hoverIdRef.current = nextId;
    setHover(found ? { id: found.id, x: found.x, y: found.y } : null);
    onHoverNode?.(nextId);
  };

  const clearHover = () => {
    hoverIdRef.current = null;
    setHover(null);
    onHoverNode?.(null);
  };

  const hoverNode = hover ? dataRef.current.nodes.find((node) => node.id === hover.id) : null;
  const tooltipLeft = hover ? Math.min(Math.max(12, hover.x + 18), Math.max(12, sizeRef.current.w - 228)) : 0;
  const tooltipTop = hover ? Math.min(Math.max(12, hover.y - 10), Math.max(12, sizeRef.current.h - 148)) : 0;

  return (
    <div className="neural-canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="neural-canvas"
        role="img"
        aria-label="神经中枢实时拓扑图"
        onPointerMove={handlePointerMove}
        onPointerLeave={clearHover}
      />
      <div className="neural-canvas-hint">悬停节点查看状态 · 连线由真实事件形成</div>
      {paused && (
        <div className="neural-canvas-paused">
          <Pause size={12} />
          实时流已暂停
        </div>
      )}
      {hover && hoverNode && (
        <div className="neural-node-tip" style={{ left: tooltipLeft, top: tooltipTop }}>
          <div className="neural-node-tip__head">
            <span className="neural-node-tip__name">{hoverNode.label}</span>
            <span className={'neural-node-tip__status is-' + hoverNode.status}>{NEURAL_STATUS_LABELS[hoverNode.status]}</span>
          </div>
          <div className="neural-node-tip__meta">
            {NEURAL_KIND_LABELS[hoverNode.kind]} · 活跃度 {Math.round(hoverNode.activity ?? 0)}%
            {hoverNode.latencyMs ? ' · ' + formatLatency(hoverNode.latencyMs) : ''}
          </div>
          <div className="neural-node-tip__meta">最近事件：{hoverNode.lastEventAt ? relativeTime(hoverNode.lastEventAt) : '尚未发生'}</div>
          {hoverNode.detail && <div className="neural-node-tip__detail">{hoverNode.detail}</div>}
        </div>
      )}
      <div className="neural-canvas-legend">
        {(['core', 'memory', 'model', 'channel', 'tool', 'state'] as NeuralNodeState['kind'][]).map((kind) => (
          <span className="neural-legend-item" key={kind}>
            <i style={{ background: 'var(' + (kind === 'core' ? '--brand-2' : kind === 'memory' ? '--mint' : kind === 'model' ? '--brand' : kind === 'channel' ? '--aqua' : kind === 'tool' ? '--amber' : '--pink') + ')' }} />
            {NEURAL_KIND_LABELS[kind]}
          </span>
        ))}
        <span className="neural-legend-item neural-legend-item--events">{events.length} 条事件在网</span>
      </div>
    </div>
  );
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  now: number,
  data: { nodes: NeuralNodeState[]; edges: NeuralEdge[]; events: NeuralEvent[]; paused: boolean; highlightNode?: NeuralNodeId | null; highlightEdge?: { from: NeuralNodeId; to: NeuralNodeId } | null },
  theme: ThemeColors,
  layout: LayoutPoint[],
  particles: Particle[],
  pulses: Map<NeuralNodeId, number>,
  hoveredId: NeuralNodeId | null,
) {
  const { w, h } = { w: ctx.canvas.width / (window.devicePixelRatio || 1), h: ctx.canvas.height / (window.devicePixelRatio || 1) };
  if (w <= 0 || h <= 0 || layout.length === 0) return;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const pointMap = new Map(layout.map((point) => [point.id, point]));
  const nodeMap = new Map(data.nodes.map((node) => [node.id, node]));

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.56);
  glow.addColorStop(0, withAlpha(theme.brand, 0.13));
  glow.addColorStop(0.42, withAlpha(theme.brand3, 0.045));
  glow.addColorStop(1, withAlpha(theme.bg1, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.strokeStyle = withAlpha(theme.text3, 0.1);
  ctx.lineWidth = 1;
  for (const point of layout) {
    if (point.id === 'core') continue;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
  }
  ctx.restore();

  const drawn = new Set<string>();
  for (const edge of data.edges) {
    const from = pointMap.get(edge.from);
    const to = pointMap.get(edge.to);
    if (!from || !to) continue;
    drawn.add(edge.from + '->' + edge.to);
    const active = edge.active > 0;
    const strength = Math.max(0.16, Math.min(0.55, 0.12 + edge.weight / 16));
    drawLine(ctx, from, to, active ? theme.brand2 : theme.brand, active ? 1.35 : 0.9, strength, active ? -now / 90 : undefined);
  }

  for (const point of layout) {
    if (point.id === 'core') continue;
    const hasInbound = drawn.has('core->' + point.id) || drawn.has(point.id + '->core');
    if (!hasInbound) drawLine(ctx, pointMap.get('core')!, point, theme.brand, 0.65, 0.085);
  }

  if (data.highlightEdge) {
    const from = pointMap.get(data.highlightEdge.from);
    const to = pointMap.get(data.highlightEdge.to);
    if (from && to) {
      drawLine(ctx, from, to, theme.brand2, 2.4, 0.85);
      drawLine(ctx, from, to, theme.brand2, 5, 0.12);
    }
  }

  for (const particle of particles) {
    const from = pointMap.get(particle.from);
    const to = pointMap.get(particle.to);
    if (!from || !to) continue;
    const progress = particle.age < 0 ? 0 : Math.min(1, particle.age / particle.duration);
    const eased = easeOutCubic(progress);
    const x = from.x + (to.x - from.x) * eased;
    const y = from.y + (to.y - from.y) * eased;
    const trailX = from.x + (to.x - from.x) * Math.max(0, eased - 0.09);
    const trailY = from.y + (to.y - from.y) * Math.max(0, eased - 0.09);
    ctx.save();
    ctx.globalAlpha = progress >= 1 ? 0 : 0.9 * (1 - progress * 0.35);
    const trail = ctx.createLinearGradient(trailX, trailY, x, y);
    trail.addColorStop(0, withAlpha(particle.color, 0));
    trail.addColorStop(1, particle.color);
    ctx.strokeStyle = trail;
    ctx.lineWidth = particle.size * 0.8;
    ctx.beginPath();
    ctx.moveTo(trailX, trailY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(x, y, particle.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const point of layout) {
    const node = nodeMap.get(point.id);
    const kind = node?.kind ?? (point.ring === 'core' ? 'core' : 'state');
    const colorName = NEURAL_NODE_KIND_CANVAS_VAR[kind] ?? '--brand-2';
    const color = node?.status === 'error' ? theme.danger : themeColor(colorName, theme);
    const active = node?.status === 'active' || node?.status === 'busy';
    const offline = node?.status === 'offline';
    const activity = Math.max(0, Math.min(100, node?.activity ?? 0));
    const isHovered = hoveredId === point.id || data.highlightNode === point.id;
    const pulseAt = pulses.get(point.id);
    const pulse = pulseAt ? Math.max(0, 1 - (now - pulseAt) / 900) : 0;
    if (pulse > 0) {
      ctx.save();
      ctx.globalAlpha = pulse * 0.5;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.r + 8 + (1 - pulse) * 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (point.ring === 'core') {
      drawCore(ctx, point, theme, now, pulse);
    } else {
      ctx.save();
      ctx.globalAlpha = offline ? 0.36 : 1;
      ctx.shadowColor = color;
      ctx.shadowBlur = active ? 18 + pulse * 12 : 7;
      ctx.fillStyle = withAlpha(theme.bg2, 0.94);
      ctx.beginPath();
      ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(color, active ? 0.95 : 0.62);
      ctx.lineWidth = active ? 1.7 : 1.05;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (activity > 0) {
        ctx.beginPath();
        ctx.strokeStyle = withAlpha(color, active ? 0.95 : 0.6);
        ctx.lineWidth = 2.1;
        ctx.lineCap = 'round';
        ctx.arc(point.x, point.y, point.r + 4.2, -Math.PI / 2, -Math.PI / 2 + (activity / 100) * Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = withAlpha(color, active ? 1 : 0.66);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
      if (isHovered) {
        ctx.strokeStyle = withAlpha(theme.brand2, 0.9);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.r + 7, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    const label = node?.label ?? neuralNodeLabel(point.id);
    ctx.save();
    ctx.font = point.ring === 'inner' ? '500 10.5px "Microsoft YaHei UI", "PingFang SC", sans-serif' : '500 10px "Microsoft YaHei UI", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textWidth = ctx.measureText(label).width;
    const above = point.y < cy - 4;
    const rawY = above ? point.y - point.r - 11 : point.y + point.r + 14;
    const labelX = Math.max(textWidth / 2 + 6, Math.min(w - textWidth / 2 - 6, point.x));
    ctx.fillStyle = withAlpha(isHovered ? theme.text1 : active ? theme.text1 : theme.text2, offline ? 0.4 : 0.92);
    ctx.fillText(label, labelX, rawY);
    ctx.restore();
  }
}

function drawCore(ctx: CanvasRenderingContext2D, point: LayoutPoint, theme: ThemeColors, now: number, pulse: number) {
  ctx.save();
  const halo = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, 86 + pulse * 20);
  halo.addColorStop(0, withAlpha(theme.brand2, 0.26 + pulse * 0.18));
  halo.addColorStop(0.45, withAlpha(theme.brand, 0.12));
  halo.addColorStop(1, withAlpha(theme.brand, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 90 + pulse * 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(theme.brand2, 0.24);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 8]);
  ctx.lineDashOffset = -now / 60;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 40, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = withAlpha(theme.brand2, 0.52 + pulse * 0.3);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 31, 0, Math.PI * 2);
  ctx.stroke();
  const core = ctx.createRadialGradient(point.x - 8, point.y - 10, 2, point.x, point.y, 30);
  core.addColorStop(0, withAlpha(theme.text1, 0.98));
  core.addColorStop(0.35, theme.brand2);
  core.addColorStop(1, withAlpha(theme.brand, 0.72));
  ctx.fillStyle = core;
  ctx.shadowColor = theme.brand2;
  ctx.shadowBlur = 24 + pulse * 24;
  ctx.beginPath();
  ctx.arc(point.x, point.y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  for (let index = 0; index < 3; index += 1) {
    const angle = now / 1400 + (index / 3) * Math.PI * 2;
    const orbit = 44 + index * 4;
    ctx.fillStyle = withAlpha(index === 0 ? theme.aqua : index === 1 ? theme.brand3 : theme.mint, 0.8);
    ctx.beginPath();
    ctx.arc(point.x + Math.cos(angle) * orbit, point.y + Math.sin(angle) * orbit * 0.65, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
