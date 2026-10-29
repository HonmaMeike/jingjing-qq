import { useMemo, useState } from 'react';
import { Eraser, Loader2, Lock, Sparkles } from 'lucide-react';
import type { MemoryFact } from '@shared/types';
import { Badge, EmptyState, IconButton } from '@/components/ui';
import { clamp, relativeTime } from '@/lib/format';
import { cn } from '@/components/ui';
import { FACT_CATEGORY_META, FACT_CATEGORY_ORDER, type FactCategory } from '@/components/memory/meta';

interface Props {
  facts: MemoryFact[];
  onForget: (factId: string) => void;
  forgettingId: string | null;
}

export default function MemoryFacts({ facts, onForget, forgettingId }: Props) {
  const [filter, setFilter] = useState<FactCategory | 'all'>('all');
  const counts = useMemo(() => {
    const map = new Map<FactCategory, number>();
    for (const fact of facts) map.set(fact.category, (map.get(fact.category) ?? 0) + 1);
    return map;
  }, [facts]);
  const categories = useMemo(
    () => FACT_CATEGORY_ORDER.filter((category) => (counts.get(category) ?? 0) > 0),
    [counts],
  );
  const visible = useMemo(
    () => (filter === 'all' ? [...facts] : facts.filter((fact) => fact.category === filter))
      .slice()
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [facts, filter],
  );

  if (!facts.length) {
    return (
      <EmptyState
        icon={<Sparkles size={22} />}
        title="还没有记下任何事实"
        desc="多聊几次，重要的身份、偏好、约定和共同经历会被抽成事实卡片，慢慢沉淀在这里。"
      />
    );
  }

  return (
    <div className="mem-facts">
      <div className="mem-facts__toolbar">
        <div className="mem-facts__filter" role="group" aria-label="按类别筛选事实">
          <button type="button" className={cn('mem-chip', filter === 'all' && 'is-active')} onClick={() => setFilter('all')}>
            全部<span className="dim">{facts.length}</span>
          </button>
          {categories.map((category) => (
            <button
              type="button"
              key={category}
              className={cn('mem-chip', filter === category && 'is-active')}
              onClick={() => setFilter(category)}
              title={FACT_CATEGORY_META[category].hint}
            >
              {FACT_CATEGORY_META[category].label}<span className="dim">{counts.get(category)}</span>
            </button>
          ))}
        </div>
        <span className="mem-facts__note">权重越高，越容易被想起</span>
      </div>

      <div className="mem-fact-list">
        {visible.map((fact) => {
          const meta = FACT_CATEGORY_META[fact.category];
          const busy = forgettingId === fact.id;
          return (
            <div className="mem-fact" key={fact.id}>
              <span className="mem-fact__cat" style={{ color: meta.color, borderColor: `color-mix(in srgb, ${meta.color} 28%, transparent)` }}>
                <span className="mem-fact__dot" style={{ background: meta.color }} />
                {meta.label}
              </span>
              <div className="mem-fact__body">
                <div className="mem-fact__text">{fact.text}</div>
                <div className="mem-fact__meta">
                  <span>{relativeTime(fact.createdAt)}</span>
                  {fact.source === 'manual' && <Badge tone="warning"><Lock size={10} />手动锁定</Badge>}
                  <span className="mem-fact__weightnum">权重 {Math.round(clamp(fact.weight) * 100)}</span>
                </div>
                <div className="mem-fact__weight" aria-hidden>
                  <span style={{ width: `${clamp(fact.weight) * 100}%`, background: meta.color }} />
                </div>
              </div>
              <IconButton label="忘记这条事实" title="忘记这条事实" disabled={busy} onClick={() => onForget(fact.id)}>
                {busy ? <Loader2 size={14} className="spin" /> : <Eraser size={14} />}
              </IconButton>
            </div>
          );
        })}
        {visible.length === 0 && (
          <EmptyState icon={<Sparkles size={20} />} title="这个分类还没有事实" desc="换一个分类看看，或者回到全部。" />
        )}
      </div>
    </div>
  );
}
