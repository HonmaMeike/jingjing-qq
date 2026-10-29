import { useId } from 'react';
import { CalendarDays, Flame, Heart, MessageSquare, Quote, Users } from 'lucide-react';
import type { RelationshipState } from '@shared/types';
import { EmptyState } from '@/components/ui';
import { clamp, formatDate, formatNumber, relativeTime } from '@/lib/format';

type AxisKey = 'affinity' | 'trust' | 'familiarity' | 'intimacy' | 'respect' | 'tension';

const AXES: { key: AxisKey; label: string; color: string }[] = [
  { key: 'affinity', label: '好感度', color: 'var(--brand-2)' },
  { key: 'trust', label: '信任', color: 'var(--mint)' },
  { key: 'familiarity', label: '熟悉度', color: 'var(--brand-3)' },
  { key: 'intimacy', label: '亲密度', color: 'var(--pink)' },
  { key: 'respect', label: '尊重', color: 'var(--amber)' },
  { key: 'tension', label: '紧张度', color: 'var(--danger)' },
];

const SIZE = 240;
const CENTER = SIZE / 2;
const RADIUS = 80;

function polar(index: number, radius: number): { x: number; y: number } {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / AXES.length;
  return { x: CENTER + Math.cos(angle) * radius, y: CENTER + Math.sin(angle) * radius };
}

function polygon(radiusFor: (index: number) => number): string {
  return AXES.map((_, index) => {
    const point = polar(index, radiusFor(index));
    return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }).join(' ');
}

export default function RelationshipPanel({ relationship }: { relationship: RelationshipState }) {
  const gradientId = `rel-grad-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const hasData = relationship.interactions > 0 || AXES.some((axis) => relationship[axis.key] > 0);

  if (!hasData) {
    return (
      <EmptyState
        icon={<Heart size={22} />}
        title="关系还在初始状态"
        desc="当你们多聊几次，好感、信任和默契会在这里一点点长出来。关系值是独立的，不会因为换了会话就重置。"
      />
    );
  }

  return (
    <div className="rel-wrap">
      <div className="rel-radar">
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="关系六维雷达图">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--brand-2)" stopOpacity="0.55" />
              <stop offset="100%" stopColor="var(--brand-3)" stopOpacity="0.18" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75, 1].map((ratio) => (
            <polygon
              key={ratio}
              points={polygon(() => RADIUS * ratio)}
              fill="none"
              stroke="var(--border)"
              strokeWidth={ratio === 1 ? 1.2 : 0.8}
            />
          ))}
          {AXES.map((_, index) => {
            const point = polar(index, RADIUS);
            return <line key={index} x1={CENTER} y1={CENTER} x2={point.x} y2={point.y} stroke="var(--border)" strokeWidth="0.8" />;
          })}
          <polygon
            points={polygon((index) => RADIUS * clamp(relationship[AXES[index]!.key] / 100))}
            fill={`url(#${gradientId})`}
            stroke="var(--brand-2)"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          {AXES.map((axis, index) => {
            const point = polar(index, RADIUS * clamp(relationship[axis.key] / 100));
            return <circle key={axis.key} cx={point.x} cy={point.y} r="3" fill="var(--brand-2)" stroke="var(--bg-2)" strokeWidth="1.2" />;
          })}
          {AXES.map((axis, index) => {
            const point = polar(index, RADIUS + 24);
            return (
              <text key={axis.key} x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle" fill="var(--text-3)" fontSize="10.5">
                {axis.label}
              </text>
            );
          })}
        </svg>
        <div className="rel-radar__caption">
          <Quote size={12} />
          {relationship.lastMood ? `最近一次的情绪：${relationship.lastMood}` : '关系六维 · 实时累积'}
        </div>
      </div>

      <div className="rel-detail">
        <div className="rel-axis-list">
          {AXES.map((axis) => {
            const value = Math.round(clamp(relationship[axis.key], 0, 100));
            return (
              <div className="rel-axis" key={axis.key}>
                <div className="rel-axis__head">
                  <span>{axis.label}</span>
                  <span className="mono" style={{ color: axis.color }}>{value}</span>
                </div>
                <div className="rel-axis__track">
                  <div className="rel-axis__fill" style={{ width: `${value}%`, background: axis.color }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="rel-stats">
          <div className="rel-stat"><Users size={14} /><b>{formatNumber(relationship.interactions)}</b><span>互动次数</span></div>
          <div className="rel-stat"><Flame size={14} /><b>{Math.max(0, relationship.streakDays)} 天</b><span>连续陪伴</span></div>
          <div className="rel-stat"><CalendarDays size={14} /><b>{formatDate(relationship.firstMetAt) || '刚刚'}</b><span>初识</span></div>
          <div className="rel-stat"><MessageSquare size={14} /><b>{relativeTime(relationship.lastInteractionAt) || '刚刚'}</b><span>最近互动</span></div>
        </div>

        {relationship.notes.length > 0 && (
          <div className="rel-notes">
            <div className="rel-notes__title"><Quote size={13} />关系手记</div>
            {relationship.notes.slice(-6).reverse().map((note, index) => (
              <div className="rel-note" key={`${index}-${note.slice(0, 8)}`}>{note}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
