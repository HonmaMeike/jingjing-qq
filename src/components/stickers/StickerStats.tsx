import { Clock, Heart, Images, Sparkles } from 'lucide-react';
import type { StickerOverview } from '@shared/types';
import { Card } from '@/components/ui';
import { relativeTime } from '@/lib/format';

export default function StickerStats({ overview, loading }: { overview: StickerOverview | null; loading: boolean }) {
  const tiles = [
    { key: 'total', label: '总收藏', value: overview?.total ?? 0, sub: '库里的全部表情', icon: <Images size={17} />, color: 'var(--brand-2)' },
    { key: 'favorites', label: '最爱', value: overview?.favorites ?? 0, sub: '点过心的那些', icon: <Heart size={17} />, color: 'var(--pink)' },
    { key: 'generated', label: '她自主生成', value: overview?.generated ?? 0, sub: '自己画或收进来的', icon: <Sparkles size={17} />, color: 'var(--mint)' },
    {
      key: 'today',
      label: '今日收集',
      value: overview?.todayGenerated ?? 0,
      sub: overview?.lastCollectedAt ? '最近 ' + relativeTime(overview.lastCollectedAt) : '今天还没有新表情',
      icon: <Clock size={17} />,
      color: 'var(--amber)',
    },
  ];

  return (
    <div className="stk-stats">
      {tiles.map((tile) => (
        <Card key={tile.key} className="stk-stat" hover>
          <span className="stk-stat__icon" style={{ color: tile.color, background: 'color-mix(in srgb, ' + tile.color + ' 11%, transparent)', borderColor: 'color-mix(in srgb, ' + tile.color + ' 22%, transparent)' }}>{tile.icon}</span>
          <div className="stk-stat__body">
            <div className="stk-stat__label">{tile.label}</div>
            {loading ? <div className="skeleton stk-stat__value-skeleton" /> : <div className="stk-stat__value" style={{ color: tile.color }}>{tile.value}</div>}
            <div className="stk-stat__sub">{loading ? '正在翻表情册…' : tile.sub}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}
