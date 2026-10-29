import { ArrowUpRight, PenLine, Sparkles } from 'lucide-react';
import type { GrowthOverview } from '@shared/types';
import { ArrowLink, Badge, Card, CardBody, CardHead, cn } from '@/components/ui';
import { formatDate, formatNumber, relativeTime } from '@/lib/format';
import ActivityTypeIcon from '@/components/growth/ActivityTypeIcon';
import { ACTIVITY_META, ACTIVITY_STATUS, sortByTimeDesc, stripMarkdown } from '@/components/growth/meta';

interface Props {
  overview: GrowthOverview;
  onOpenDiary: (diaryId: string) => void;
  onOpenActivity: () => void;
}

export default function GrowthHighlights({ overview, onOpenDiary, onOpenActivity }: Props) {
  const activities = sortByTimeDesc(overview.activities ?? []);
  const diaries = sortByTimeDesc(overview.diaries ?? []);
  const latestActivity = activities[0];
  const latestDiary = diaries[0];
  const traits = Object.entries(overview.growth.traits ?? {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);

  return (
    <div className="gro-highlights">
      <Card className="gro-mini gro-mini--activity">
        <CardHead
          title={<><span className="gro-mini__icon is-mint"><Sparkles size={14} /></span>最近在做</>}
          desc="自主生活引擎的小记录"
          extra={<ArrowLink onClick={onOpenActivity}>全部轨迹</ArrowLink>}
        />
        <CardBody>
          {latestActivity ? (
            <button type="button" className="gro-mini__activity" onClick={onOpenActivity}>
              <span
                className="gro-mini__activity-icon"
                style={{ color: ACTIVITY_META[latestActivity.type].color, background: `color-mix(in srgb, ${ACTIVITY_META[latestActivity.type].color} 12%, transparent)` }}
              >
                <ActivityTypeIcon type={latestActivity.type} size={16} />
              </span>
              <span className="gro-mini__activity-body">
                <span className="gro-mini__activity-title">{latestActivity.title}</span>
                <span className="gro-mini__activity-summary">{latestActivity.summary}</span>
                <span className="gro-mini__activity-meta">
                  <Badge>{ACTIVITY_META[latestActivity.type].label}</Badge>
                  <Badge tone={ACTIVITY_STATUS[latestActivity.status].tone}>{ACTIVITY_STATUS[latestActivity.status].label}</Badge>
                  <span className="dim text-xs">{relativeTime(latestActivity.createdAt)}</span>
                </span>
              </span>
              <ArrowUpRight size={15} className="gro-mini__activity-arrow" />
            </button>
          ) : (
            <div className="gro-mini__empty">
              <Sparkles size={17} />
              <span>她还没有独自行动过。打开「活动轨迹」可以让她现在就去生活一下。</span>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="gro-mini gro-mini--diary">
        <CardHead
          title={<><span className="gro-mini__icon is-pink"><PenLine size={14} /></span>最近日记</>}
          desc={latestDiary ? formatDate(latestDiary.date || latestDiary.createdAt) : '睡前写给自己看的'}
          extra={latestDiary ? <ArrowLink onClick={() => onOpenDiary(latestDiary.id)}>去读</ArrowLink> : undefined}
        />
        <CardBody>
          {latestDiary ? (
            <button type="button" className="gro-mini__diary" onClick={() => onOpenDiary(latestDiary.id)}>
              <div className="gro-mini__diary-title">
                <span className="gro-mini__diary-emoji">{latestDiary.moodEmoji || '🐋'}</span>
                <span className="truncate">{latestDiary.title}</span>
              </div>
              <p className="gro-mini__diary-snippet">{stripMarkdown(latestDiary.content, 96)}</p>
              <div className="gro-mini__diary-meta">
                <Badge tone="pink">{latestDiary.mood}</Badge>
                {latestDiary.highlights.length > 0 && <span className="dim text-xs">高光 {latestDiary.highlights.length} 条</span>}
                <span className="dim text-xs">{relativeTime(latestDiary.createdAt)}</span>
              </div>
            </button>
          ) : (
            <div className="gro-mini__empty">
              <PenLine size={17} />
              <span>她还没写过日记。点右上角的「现在写日记」，让她记下今天。</span>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="gro-mini gro-mini--traits">
        <CardHead
          title={<><span className="gro-mini__icon is-amber"><Sparkles size={14} /></span>成长特质</>}
          desc="随着相处慢慢漂移的性格"
          extra={<Badge tone="brand">{formatNumber(overview.growth.level)} 级</Badge>}
        />
        <CardBody>
          {traits.length > 0 ? (
            <div className="gro-trait-list">
              {traits.map(([label, value]) => (
                <div className="gro-trait" key={label}>
                  <div className="gro-trait__head">
                    <span>{label}</span>
                    <span className="mono">{Math.round(value)}</span>
                  </div>
                  <div className="gro-trait__track">
                    <span
                      className={cn('gro-trait__fill')}
                      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="gro-mini__empty">
              <Sparkles size={17} />
              <span>特质还在形成中，多聊聊她就会有新的样子。</span>
            </div>
          )}
          {overview.growth.selfImage && (
            <div className="gro-mini__self">“{overview.growth.selfImage}”</div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
