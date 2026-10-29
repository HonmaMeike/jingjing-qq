import { Archive, ArrowDown, History, Sparkles } from 'lucide-react';
import type { ForgettingStat } from '@shared/types';
import { Badge, Card, CardBody, CardHead, EmptyState, Progress } from '@/components/ui';
import { SEA_DEPTH_META, SEA_DEPTH_ORDER } from '@/components/consciousness/meta';

export default function ForgettingPanel({ stat }: { stat: ForgettingStat }) {
  const total = (stat.surface ?? 0) + (stat.shallow ?? 0) + (stat.deep ?? 0) + (stat.abyss ?? 0);
  const churn = (stat.fadedThisWeek ?? 0) + (stat.reinforced ?? 0);
  const reinforcedShare = churn > 0 ? Math.round(((stat.reinforced ?? 0) / churn) * 100) : 0;
  const percent = (value: number) => (total > 0 ? Math.round((value / total) * 100) : 0);

  return (
    <div className="cs-forget">
      <Card className="cs-forget__layers">
        <CardHead
          title={<><span className="cs-forget__icon"><Archive size={14} /></span>记忆的深度分布</>}
          desc="细节会淡，重要的反而沉得更深；原文从来没有被删除。"
          extra={<Badge>{total} 个记忆点</Badge>}
        />
        <CardBody>
          {total === 0 ? (
            <EmptyState icon={<History size={21} />} title="还没有可统计的沉降" desc="等她经历得更多一些，这里会显示每个深度层的记忆数量。" />
          ) : (
            <div className="cs-forget__diagram">
              <div className="cs-forget__surface-label"><ArrowDown size={12} />越来越深</div>
              {SEA_DEPTH_ORDER.map((depth) => {
                const meta = SEA_DEPTH_META[depth];
                const value = stat[depth] ?? 0;
                return (
                  <div className="cs-forget__layer" key={depth}>
                    <div className="cs-forget__layer-head">
                      <span className="cs-forget__layer-name" style={{ color: meta.color }}><i style={{ background: meta.color }} />{meta.label}</span>
                      <span className="cs-forget__layer-count">{value} 个 · {percent(value)}%</span>
                    </div>
                    <div className="cs-forget__layer-bar">
                      <span style={{ width: percent(value) + '%', background: 'linear-gradient(90deg, color-mix(in srgb, ' + meta.color + ' 55%, transparent), ' + meta.color + ')' }} />
                    </div>
                    <div className="cs-forget__layer-hint">{meta.hint}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="cs-forget__side">
        <Card>
          <CardHead title={<><span className="cs-forget__icon is-mint"><Sparkles size={14} /></span>这一周的变化</>} desc="淡化不是删除，强化是被重新想起。" />
          <CardBody>
            <div className="cs-forget__numbers">
              <div className="cs-forget__number">
                <span className="cs-forget__number-value">{stat.fadedThisWeek ?? 0}</span>
                <span className="cs-forget__number-label">本周淡化</span>
                <span className="cs-forget__number-hint">沉下去一点，但原文还在</span>
              </div>
              <div className="cs-forget__number is-strong">
                <span className="cs-forget__number-value">{stat.reinforced ?? 0}</span>
                <span className="cs-forget__number-label">被重新想起</span>
                <span className="cs-forget__number-hint">越想起，越清晰</span>
              </div>
            </div>
            <div className="cs-forget__bar">
              <div className="cs-forget__bar-head"><span>本周重新想起的占比</span><b>{reinforcedShare}%</b></div>
              <Progress value={reinforcedShare} thin />
            </div>
            <div className="cs-forget__note">
              <Archive size={13} />
              <span>遗忘只是让记忆沉入更深的层，不是抹掉。重要的会变成锚点，普通的会在需要时被重新打捞上来。</span>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
