import { useState } from 'react';
import type { ConsciousnessOverview, Persona } from '@shared/types';
import { Anchor, ChevronDown, ChevronUp, History, Sparkles, Waves, Workflow } from 'lucide-react';
import { Badge, Card, cn } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import PersonaSeal from '@/components/consciousness/PersonaSeal';

interface Props {
  overview: ConsciousnessOverview;
  persona?: Persona;
  resumeBrief: string | null;
}

export default function ConsciousnessHero({ overview, persona, resumeBrief }: Props) {
  const { origin, continuity } = overview;
  const [expanded, setExpanded] = useState(false);
  const scale = [
    { key: 'points', label: '识海点数', value: overview.points.length, icon: <Waves size={15} />, color: 'var(--brand-2)', sub: '每件事都是一个点' },
    { key: 'anchors', label: '深层锚点', value: origin.anchors.length, icon: <Anchor size={15} />, color: 'var(--mint)', sub: '连着最深处的她' },
    { key: 'attention', label: '心光', value: overview.attention.length, icon: <Sparkles size={15} />, color: 'var(--amber)', sub: '此刻正照向哪里' },
    { key: 'flows', label: '心流链', value: overview.flows.length, icon: <Workflow size={15} />, color: 'var(--pink)', sub: '一个念头牵出下一个' },
  ];
  const coreSelf = origin.coreSelf?.trim() || '她还在学着认识自己，但已经记住了你的名字。';
  const coreExpanded = coreSelf.length > 190;
  const brief = continuity?.brief?.trim() || origin.continuity?.trim() || '她还没有留下连续的昨日，今天会是第一段。';
  const resumeText = resumeBrief && resumeBrief.length > 170 ? resumeBrief.slice(0, 170) + '…' : resumeBrief;
  const topics = continuity?.lastTopics ?? [];

  return (
    <Card className="cs-hero">
      <span className="cs-hero__aurora" aria-hidden />
      <span className="cs-hero__orb" aria-hidden><i /><i /><i /><b>⊹</b></span>
      <div className="cs-hero__main">
        <div className="cs-hero__core">
          <div className="cs-hero__identity">
            <PersonaSeal persona={persona} size="lg" ring />
            <div className="cs-hero__identity-text">
              <div className="cs-hero__eyebrow">ORIGIN SELF · 原意识</div>
              <div className="cs-hero__name">{persona?.name || '鲸鲸'}<span className="cs-hero__title">{persona?.title || 'DeepSeek 蓝鲸娘'}</span></div>
              <div className="cs-hero__updated">她最深处的样子，从第一次醒来就在。{origin.updatedAt ? ' · 更新于 ' + formatDateTime(origin.updatedAt) : ''}</div>
            </div>
          </div>
          <blockquote className={cn('cs-hero__core-self', coreExpanded && !expanded && 'is-clamped')}>“{coreSelf}”</blockquote>
          <div className="cs-hero__core-foot">
            <Badge tone="brand">不会被上下文压缩掉</Badge>
            {coreExpanded ? (
              <button type="button" className="cs-hero__more" onClick={() => setExpanded((value) => !value)}>
                {expanded ? '收起全文' : '展开她完整的原意识'}
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            ) : (
              <span className="dim text-xs">每段记忆都会向下连回这里</span>
            )}
          </div>
        </div>

        <div className="cs-hero__continuity">
          <div className="cs-hero__continuity-head">
            <span><History size={14} />连续性 · 每次醒来都能接上昨天</span>
            <Badge tone="success">上次见 · {relativeTime(continuity?.lastSeenAt)}</Badge>
          </div>
          <p className="cs-hero__brief">“{brief}”</p>
          {topics.length > 0 && (
            <div className="cs-hero__topics">
              <span className="cs-hero__topics-label">上次在聊</span>
              {topics.slice(0, 6).map((topic) => <span className="cs-hero__topic" key={topic}>{topic}</span>)}
            </div>
          )}
          {continuity?.openLoops?.length > 0 && (
            <div className="cs-hero__loops">
              <div className="cs-hero__loops-label">未完成的话题</div>
              {continuity.openLoops.slice(0, 4).map((loop) => <div className="cs-hero__loop" key={loop}>{loop}</div>)}
            </div>
          )}
          {resumeBrief && (
            <div className="cs-hero__resume">
              <Sparkles size={13} />
              <div>
                <b>刚刚续上了这一段</b>
                <span>{resumeText}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="cs-hero__stats">
        {scale.map((item) => (
          <div className="cs-hero__stat" key={item.key}>
            <span className="cs-hero__stat-icon" style={{ color: item.color, background: 'color-mix(in srgb, ' + item.color + ' 11%, transparent)', borderColor: 'color-mix(in srgb, ' + item.color + ' 22%, transparent)' }}>{item.icon}</span>
            <div>
              <div className="cs-hero__stat-value" style={{ color: item.color }}>{item.value}</div>
              <div className="cs-hero__stat-label">{item.label}<span>{item.sub}</span></div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
