import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Compass } from 'lucide-react';
import type { SeaDepth, SeaPoint } from '@shared/types';
import { EmptyState, cn } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import {
  SEA_DEPTH_META, SEA_DEPTH_ORDER, SEA_KIND_META, SEA_KIND_ORDER,
  hashFraction, normalize01,
} from '@/components/consciousness/meta';

interface PlacedPoint {
  point: SeaPoint;
  x: number;
  y: number;
  r: number;
  salience: number;
}

interface Props {
  points: SeaPoint[];
  selectedId: string | null;
  highlightIds?: string[];
  onSelect: (point: SeaPoint) => void;
}

const MIN_WIDTH = 320;
const MIN_HEIGHT = 330;

export default function SeaCloud({ points, selectedId, highlightIds = [], onSelect }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 980, height: 520 });
  const [depth, setDepth] = useState<SeaDepth | 'all'>('all');
  const [hover, setHover] = useState<PlacedPoint | null>(null);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setSize({ width: Math.max(MIN_WIDTH, Math.round(rect.width)), height: Math.max(MIN_HEIGHT, Math.round(rect.height)) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const highlightKey = highlightIds.join('|');
  useEffect(() => {
    if (highlightKey) setDepth('all');
  }, [highlightKey]);

  const counts = useMemo(() => {
    const byDepth: Record<SeaDepth, number> = { surface: 0, shallow: 0, deep: 0, abyss: 0 };
    const byKind: Partial<Record<SeaPoint['kind'], number>> = {};
    for (const point of points) {
      byDepth[point.depth] = (byDepth[point.depth] ?? 0) + 1;
      byKind[point.kind] = (byKind[point.kind] ?? 0) + 1;
    }
    return { byDepth, byKind };
  }, [points]);

  const visible = useMemo(() => {
    if (depth === 'all') return points;
    const filtered = points.filter((point) => point.depth === depth);
    const selected = points.find((point) => point.id === selectedId);
    if (selected && !filtered.some((point) => point.id === selected.id)) return [...filtered, selected];
    return filtered;
  }, [points, depth, selectedId]);

  const placed = useMemo(() => {
    const padX = Math.max(56, size.width * 0.065);
    const width = Math.max(120, size.width - padX * 2);
    return visible.map((point): PlacedPoint => {
      const salience = normalize01(point.salience);
      const band = SEA_DEPTH_META[point.depth] ?? SEA_DEPTH_META.surface;
      const x = padX + hashFraction(point.id, 1) * width;
      const y = size.height * (band.top + hashFraction(point.id, 2) * band.height);
      const r = 2.1 + salience * 6.4;
      return { point, x, y, r, salience };
    });
  }, [visible, size]);

  const stars = useMemo(() => Array.from({ length: 52 }, (_, index) => ({
    x: hashFraction('star-x', index) * size.width,
    y: hashFraction('star-y', index) * size.height,
    r: 0.5 + hashFraction('star-r', index) * 1.1,
    opacity: 0.12 + hashFraction('star-o', index) * 0.28,
  })), [size]);

  const selectedPoint = placed.find((item) => item.point.id === selectedId) ?? null;
  const tooltipAbove = hover ? hover.y > size.height * 0.56 : false;
  const highlighted = useMemo(() => new Set(highlightIds), [highlightKey]);

  if (points.length === 0) {
    return (
      <EmptyState
        icon={<Compass size={23} />}
        title="识海还是一片安静的水面"
        desc="等她开始聊天、写日记、学习，经历就会在这里一颗一颗亮起来。每一件事都会成为一个点，按重要程度沉入不同的深度。"
      />
    );
  }

  return (
    <div className="cs-sea">
      <div className="cs-sea__toolbar">
        <div className="cs-sea__depths" role="group" aria-label="按深度筛选识海">
          <button type="button" className={cn('cs-sea__depth', depth === 'all' && 'is-active')} onClick={() => setDepth('all')}>
            全部<span>{points.length}</span>
          </button>
          {SEA_DEPTH_ORDER.map((item) => (
            <button
              type="button"
              key={item}
              className={cn('cs-sea__depth', depth === item && 'is-active')}
              onClick={() => setDepth(item)}
              style={{ ['--d-c' as string]: SEA_DEPTH_META[item].color } as CSSProperties}
            >
              <i className="cs-sea__depth-dot" />
              {SEA_DEPTH_META[item].label}<span>{counts.byDepth[item] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="cs-sea__legend" aria-label="记忆点类型">
          {SEA_KIND_ORDER.filter((kind) => (counts.byKind[kind] ?? 0) > 0).map((kind) => (
            <span className="cs-sea__legend-item" key={kind} title={SEA_KIND_META[kind].hint}>
              <i style={{ background: SEA_KIND_META[kind].color }} />
              {SEA_KIND_META[kind].label}
            </span>
          ))}
        </div>
      </div>

      <div className="cs-sea__canvas" ref={wrapRef}>
        <div className="cs-sea__bands" aria-hidden>
          {SEA_DEPTH_ORDER.map((item) => {
            const meta = SEA_DEPTH_META[item];
            return (
              <div
                key={item}
                className="cs-sea__band"
                style={{ top: `${meta.top * 100}%`, height: `${meta.height * 100}%`, ['--d-c' as string]: meta.color } as CSSProperties}
              >
                <span className="cs-sea__band-label">{meta.label}</span>
                <span className="cs-sea__band-hint">{meta.hint}</span>
              </div>
            );
          })}
        </div>

        <svg
          className="cs-sea__svg"
          viewBox={`0 0 ${size.width} ${size.height}`}
          width="100%"
          height="100%"
          role="img"
          aria-label={`意识识海点云，共显示 ${placed.length} 个记忆点`}
        >
          {stars.map((star, index) => (
            <circle key={index} cx={star.x} cy={star.y} r={star.r} fill="var(--text-3)" opacity={star.opacity} />
          ))}

          {placed.map(({ point, x, y, r, salience }) => {
            const meta = SEA_KIND_META[point.kind] ?? SEA_KIND_META.episode;
            const selected = point.id === selectedId;
            const hit = highlighted.has(point.id);
            const isHover = hover?.point.id === point.id;
            const opacity = point.depth === 'surface' ? 0.95 : point.depth === 'shallow' ? 0.85 : point.depth === 'deep' ? 0.72 : 0.82;
            return (
              <g
                key={point.id}
                className={cn('cs-sea__point', selected && 'is-selected', hit && 'is-hit', isHover && 'is-hovered')}
                onMouseEnter={() => setHover({ point, x, y, r, salience })}
                onMouseLeave={() => setHover((current) => (current?.point.id === point.id ? null : current))}
                onFocus={() => setHover({ point, x, y, r, salience })}
                onBlur={() => setHover((current) => (current?.point.id === point.id ? null : current))}
                onClick={() => onSelect(point)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(point);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`${meta.label} · ${point.title || point.text.slice(0, 30)} · ${SEA_DEPTH_META[point.depth]?.label ?? point.depth}`}
              >
                {salience > 0.5 && <circle cx={x} cy={y} r={r * 2.4} fill={meta.color} opacity={0.12} className="cs-sea__halo" />}
                {hit && <circle cx={x} cy={y} r={r + 6.5} className="cs-sea__hit-ring" />}
                {selected && <circle cx={x} cy={y} r={r + 5} className="cs-sea__select-ring" />}
                <circle cx={x} cy={y} r={r} fill={meta.color} opacity={opacity} className="cs-sea__dot" />
                {salience > 0.78 && <circle cx={x} cy={y} r={Math.max(1.2, r * 0.28)} fill="#fff" opacity={0.75} />}
              </g>
            );
          })}

          {selectedPoint && (
            <g className="cs-sea__target" aria-hidden>
              <circle cx={selectedPoint.x} cy={selectedPoint.y} r={selectedPoint.r + 13} />
            </g>
          )}
        </svg>

        {hover && (
          <div
            className={cn('cs-sea__tip', tooltipAbove && 'is-above')}
            style={{ left: `clamp(150px, ${(hover.x / size.width) * 100}%, calc(100% - 150px))`, top: `${(hover.y / size.height) * 100}%` }}
          >
            <div className="cs-sea__tip-head">
              <span className="cs-sea__tip-kind" style={{ color: (SEA_KIND_META[hover.point.kind] ?? SEA_KIND_META.episode).color }}>
                {(SEA_KIND_META[hover.point.kind] ?? SEA_KIND_META.episode).label}
              </span>
              <span className="cs-sea__tip-depth" style={{ color: SEA_DEPTH_META[hover.point.depth]?.color }}>
                {SEA_DEPTH_META[hover.point.depth]?.label ?? hover.point.depth}
              </span>
              <span className="cs-sea__tip-salience">显著度 {Math.round(hover.salience * 100)}</span>
            </div>
            <div className="cs-sea__tip-title">{hover.point.title || '一段没有标题的记忆'}</div>
            <p className="cs-sea__tip-text">{hover.point.text}</p>
            <div className="cs-sea__tip-meta">
              {formatDateTime(hover.point.at)} · 被想起 {hover.point.accessCount} 次 · 连接 {hover.point.connections}
            </div>
          </div>
        )}

        {visible.length === 0 && (
          <div className="cs-sea__empty-layer">这一层还没有记忆点，换一层看看。</div>
        )}
      </div>

      <div className="cs-sea__foot">
        <span><Compass size={12} />圆点大小 = 显著度 · 颜色 = 类型 · 纵向位置 = 沉入识海的深度</span>
        <span className="dim">显示 {placed.length} / {points.length} 个点{highlightIds.length > 0 ? ` · 高亮 ${highlightIds.length} 个搜索命中` : ''}</span>
      </div>
    </div>
  );
}
