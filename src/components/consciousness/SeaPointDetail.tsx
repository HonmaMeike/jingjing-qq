import { BookOpen, Compass, Copy, Layers, Sparkles, X } from 'lucide-react';
import type { SeaPoint } from '@shared/types';
import { Button, Card, CardBody, CardHead, CopyButton, EmptyState, IconButton, Progress } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import { SEA_DEPTH_META, SEA_KIND_META, percentOf } from '@/components/consciousness/meta';

interface Props {
  point: SeaPoint | null;
  onClear: () => void;
  onSearchTag: (tag: string) => void;
}

export default function SeaPointDetail({ point, onClear, onSearchTag }: Props) {
  if (!point) {
    return (
      <Card className="cs-detail cs-detail--empty">
        <EmptyState
          icon={<Compass size={22} />}
          title="点开识海里的一颗星"
          desc="把鼠标悬停在点云上可以看到记忆摘要，点击任意一个点，这里会展开它的完整内容、深度和位置。"
        />
        <div className="cs-detail__hint">
          <Layers size={13} />
          <span>越靠下的点沉得越深，也往往越重要。</span>
        </div>
      </Card>
    );
  }

  const kind = SEA_KIND_META[point.kind] ?? SEA_KIND_META.episode;
  const depth = SEA_DEPTH_META[point.depth] ?? SEA_DEPTH_META.surface;
  const KindIcon = kind.icon;

  return (
    <Card className="cs-detail">
      <CardHead
        title={<><span className="cs-detail__kind" style={{ color: kind.color }}><KindIcon size={14} />{kind.label}</span>记忆点</>}
        desc={point.title || '一段没有标题的记忆'}
        extra={<IconButton label="收起记忆详情" onClick={onClear}><X size={15} /></IconButton>}
      />
      <CardBody>
        <div className="cs-detail__chips">
          <span className="cs-chip" style={{ color: depth.color, borderColor: `color-mix(in srgb, ${depth.color} 30%, transparent)`, background: `color-mix(in srgb, ${depth.color} 9%, transparent)` }}>
            <i style={{ background: depth.color }} />{depth.label}
          </span>
          <span className="cs-chip">{formatDateTime(point.at)}</span>
          <span className="cs-chip">{relativeTime(point.at)}</span>
        </div>

        <h3 className="cs-detail__title">{point.title || '一段没有标题的记忆'}</h3>
        <p className="cs-detail__text">{point.text || '这段记忆还没有留下正文，只留下了一个位置。'}</p>

        <div className="cs-detail__depth-note">
          <span style={{ color: depth.color }}>{depth.label}</span>
          <span>{depth.hint}。它来自识海的这一层，被想起时会重新浮上来一点。</span>
        </div>

        <div className="cs-detail__metrics">
          <div className="cs-detail__metric cs-detail__metric--wide">
            <div className="cs-detail__metric-head"><span>显著度</span><b>{percentOf(point.salience)}</b></div>
            <Progress value={percentOf(point.salience)} thin />
          </div>
          <div className="cs-detail__metric"><span>连接</span><b>{point.connections}</b></div>
          <div className="cs-detail__metric"><span>被想起</span><b>{point.accessCount} 次</b></div>
          <div className="cs-detail__metric"><span>最后想起</span><b>{point.lastRecalledAt ? relativeTime(point.lastRecalledAt) : '还没被想起'}</b></div>
        </div>

        {point.tags && point.tags.length > 0 && (
          <div className="cs-detail__tags">
            <div className="cs-detail__section-label"><Sparkles size={12} />相关线索</div>
            <div className="cs-detail__tag-row">
              {point.tags.map((tag) => (
                <button type="button" className="cs-tag" key={tag} onClick={() => onSearchTag(tag)} title={'在识海里搜索「' + tag + '」'}>#{tag}</button>
              ))}
            </div>
          </div>
        )}

        <div className="cs-detail__foot">
          {point.docId ? (
            <>
              <span className="cs-detail__doc mono" title={point.docId}><Copy size={11} />{point.docId}</span>
              <div className="row no-wrap">
                <CopyButton text={point.docId} label="复制 ID" />
                <Button variant="ghost" size="sm" icon={<BookOpen size={13} />} onClick={() => { window.location.hash = '/memory'; }}>去记忆库</Button>
              </div>
            </>
          ) : (
            <span className="dim text-xs">这个点还没有绑定到独立的记忆文档。</span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
