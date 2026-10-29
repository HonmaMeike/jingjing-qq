import { AlertTriangle, Loader2, Play, RefreshCw, Sparkles, Zap } from 'lucide-react';
import type { ActivityType, GrowthOverview } from '@shared/types';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import ActivityTypeIcon from '@/components/growth/ActivityTypeIcon';
import { ACTIVITY_META, ACTIVITY_STATUS, TRIGGER_ACTIONS, sortByTimeDesc } from '@/components/growth/meta';

interface Props {
  activities: GrowthOverview['activities'];
  loading: boolean;
  error: string | null;
  triggering: ActivityType | null;
  onTrigger: (kind: ActivityType) => void;
  onRetry: () => void;
  onOpen: (url: string) => void;
}

export default function ActivityTimeline({ activities, loading, error, triggering, onTrigger, onRetry, onOpen }: Props) {
  const sorted = sortByTimeDesc(activities ?? []);

  return (
    <div className="gro-activity">
      <Card className="gro-activity__triggers">
        <div className="gro-activity__trigger-head">
          <div>
            <div className="gro-list-title">让她现在生活一下</div>
            <div className="gro-list-sub">自主生活引擎会先检查频率和安静时段，跳过时会告诉你原因。</div>
          </div>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={13} className={loading ? 'spin' : ''} />} onClick={onRetry} disabled={loading}>
            刷新轨迹
          </Button>
        </div>
        <div className="gro-trigger-grid">
          {TRIGGER_ACTIONS.map((action) => (
            <button
              type="button"
              key={action.kind}
              className="gro-trigger"
              title={action.hint}
              disabled={triggering !== null}
              onClick={() => onTrigger(action.kind)}
            >
              <span className="gro-trigger__icon" style={{ color: ACTIVITY_META[action.kind].color, background: `color-mix(in srgb, ${ACTIVITY_META[action.kind].color} 12%, transparent)` }}>
                {triggering === action.kind ? <Loader2 size={15} className="spin" /> : <ActivityTypeIcon type={action.kind} size={15} />}
              </span>
              <span className="gro-trigger__label">{action.label}</span>
              <Zap size={11} className="gro-trigger__zap" />
            </button>
          ))}
        </div>
      </Card>

      {error && <div className="gro-inline-error">{error}</div>}

      {loading && sorted.length === 0 ? (
        <Card className="gro-section-card">
          <div className="gro-activity__skeleton">
            {[0, 1, 2, 3].map((index) => (
              <div className="gro-skeleton-row" key={index}>
                <div className="skeleton" style={{ width: 30, height: 30, borderRadius: 10 }} />
                <div className="flex-1">
                  <div className="skeleton" style={{ height: 12, width: '46%' }} />
                  <div className="skeleton" style={{ height: 10, width: '76%', marginTop: 8 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : sorted.length === 0 ? (
        <Card className="gro-section-card">
          <EmptyState
            icon={<Play size={23} />}
            title="还没有活动记录"
            desc="鲸鲸还没有独自做过什么。点上面的按钮，让她主动生活一次——写日记、逛 B 站、学点新东西，都会记录在这里。"
            action={<Button variant="primary" icon={<Sparkles size={15} />} onClick={() => onTrigger('proactive')}>让她主动一次</Button>}
          />
        </Card>
      ) : (
        <div className="gro-activity__timeline">
          {sorted.map((item) => (
            <div className="gro-activity-item" key={item.id}>
              <span className="gro-activity-item__node" style={{ color: ACTIVITY_META[item.type].color, background: `color-mix(in srgb, ${ACTIVITY_META[item.type].color} 12%, transparent)`, borderColor: `color-mix(in srgb, ${ACTIVITY_META[item.type].color} 30%, transparent)` }}>
                <ActivityTypeIcon type={item.type} size={13} />
              </span>
              <div className="gro-activity-item__body">
                <div className="gro-activity-item__top">
                  <span className="gro-activity-item__title">{item.title}</span>
                  <Badge tone={ACTIVITY_STATUS[item.status].tone}>{ACTIVITY_STATUS[item.status].label}</Badge>
                  <span className="gro-activity-item__type" style={{ color: ACTIVITY_META[item.type].color }}>{ACTIVITY_META[item.type].label}</span>
                  <span className="spacer" />
                  <span className="dim text-xs">{relativeTime(item.createdAt)}</span>
                </div>
                <p className="gro-activity-item__summary">{item.summary}</p>
                {item.detail && <p className="gro-activity-item__detail">{item.detail}</p>}
                <div className="gro-activity-item__foot">
                  <span className="dim text-xs mono">{formatDateTime(item.createdAt)}</span>
                  {item.link && (
                    <Button variant="ghost" size="sm" icon={<Play size={11} />} onClick={() => onOpen(item.link as string)}>查看</Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {error && sorted.length > 0 && (
        <div className="gro-activity__error">
          <AlertTriangle size={13} />{error}
          <Button variant="ghost" size="sm" onClick={onRetry}>重试</Button>
        </div>
      )}
    </div>
  );
}
