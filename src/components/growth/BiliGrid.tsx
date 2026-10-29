import { AlertTriangle, ExternalLink, Play, RefreshCw } from 'lucide-react';
import type { BiliDiscovery } from '@shared/types';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import { formatNumber, relativeTime } from '@/lib/format';
import MediaImage from '@/components/growth/MediaImage';

interface Props {
  items: BiliDiscovery[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  interests: string[];
  enabled: boolean;
  onRefresh: () => void;
  onOpen: (url: string) => void;
}

export default function BiliGrid({ items, loading, error, refreshing, interests, enabled, onRefresh, onOpen }: Props) {
  return (
    <div className="gro-bili-wrap">
      <div className="gro-toolbar">
        <div className="gro-toolbar__info">
          <div className="gro-list-title">B站发现<span className="dim">{items.length}</span></div>
          <div className="gro-list-sub">她按自己的兴趣逛 B 站，再挑出想跟你分享的东西</div>
        </div>
        <div className="gro-toolbar__right">
          <div className="gro-interest-chips">
            {interests.slice(0, 6).map((interest) => <span className="gro-interest" key={interest}>{interest}</span>)}
          </div>
          <Button variant="secondary" size="sm" icon={<RefreshCw size={13} className={refreshing ? 'spin' : ''} />} loading={refreshing} onClick={onRefresh} disabled={!enabled}>
            刷新雷达
          </Button>
        </div>
      </div>

      {!enabled && (
        <div className="callout callout--brand gro-callout">
          <AlertTriangle size={15} className="callout__icon" />
          <span>B 站发现已在「设置 · 自主生活」里关闭，开启后她才会自己去逛。</span>
        </div>
      )}

      {error && <div className="gro-inline-error">{error}</div>}

      {loading && items.length === 0 ? (
        <div className="gro-bili-grid">
          {[0, 1, 2, 3].map((index) => (
            <Card key={index} className="gro-bili">
              <div className="skeleton gro-bili__cover-skeleton" />
              <div style={{ padding: 14 }}>
                <div className="skeleton" style={{ height: 12, width: '84%' }} />
                <div className="skeleton" style={{ height: 10, width: '56%', marginTop: 9 }} />
                <div className="skeleton" style={{ height: 10, width: '92%', marginTop: 14 }} />
              </div>
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="gro-section-card">
          <EmptyState
            icon={<Play size={23} />}
            title="她还没逛到想分享的视频"
            desc="点一下「刷新雷达」，她就会按照自己的兴趣去 B 站转一圈，带回封面、UP 主和她的吐槽。"
            action={<Button variant="primary" icon={<RefreshCw size={15} />} loading={refreshing} onClick={onRefresh} disabled={!enabled}>去 B 站逛逛</Button>}
          />
        </Card>
      ) : (
        <div className="gro-bili-grid">
          {items.map((item) => (
            <Card key={item.id} className="gro-bili" hover onClick={() => onOpen(item.url)}>
              <div className="gro-bili__cover">
                <MediaImage src={item.cover} alt={item.title} className="gro-bili__image" />
                <span className="gro-bili__play"><Play size={10} />{item.play ? formatNumber(item.play) : '—'}</span>
                {item.duration && <span className="gro-bili__duration">{item.duration}</span>}
              </div>
              <div className="gro-bili__body">
                <div className="gro-bili__title">{item.title}</div>
                <div className="gro-bili__meta">
                  {item.upName && <span className="gro-bili__up">UP · {item.upName}</span>}
                  <span className="dim text-xs">{relativeTime(item.createdAt)}</span>
                </div>
                <div className="gro-bili__reason">
                  <span className="gro-bili__reason-label">她为什么点进去</span>
                  <p>{item.reason}</p>
                </div>
                {item.comment && (
                  <div className="gro-bili__comment">
                    <span>鲸鲸说</span>
                    <p>{item.comment}</p>
                  </div>
                )}
                <div className="gro-bili__foot">
                  <Badge tone="mint">B站</Badge>
                  <span className="gro-bili__open">打开视频<ExternalLink size={12} /></span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
