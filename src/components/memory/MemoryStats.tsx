import type { ReactNode } from 'react';
import { HardDrive, Sparkles, Users, UsersRound } from 'lucide-react';
import type { MemorySummary } from '@shared/types';
import { Card } from '@/components/ui';
import { formatBytes, formatNumber } from '@/lib/format';

interface Tile {
  key: string;
  label: string;
  value: string;
  sub: string;
  color: string;
  icon: ReactNode;
}

export default function MemoryStats({ summary, loading }: { summary: MemorySummary | null; loading: boolean }) {
  const stats = summary?.stats;
  const tiles: Tile[] = [
    { key: 'users', label: '联系人档案', value: formatNumber(stats?.users ?? 0), sub: '每个 QQ 号独立成册', color: 'var(--brand-2)', icon: <Users size={18} /> },
    { key: 'groups', label: '群聊档案', value: formatNumber(stats?.groups ?? 0), sub: '群记忆与私聊彻底隔离', color: 'var(--mint)', icon: <UsersRound size={18} /> },
    { key: 'facts', label: '记忆事实', value: formatNumber(stats?.facts ?? 0), sub: '从对话里慢慢沉淀', color: 'var(--pink)', icon: <Sparkles size={18} /> },
    { key: 'storage', label: '本地存储', value: formatBytes(stats?.storageBytes ?? 0), sub: `${formatNumber(stats?.docs ?? 0)} 份 Markdown 文档`, color: 'var(--amber)', icon: <HardDrive size={18} /> },
  ];
  return (
    <div className="mem-stats">
      {tiles.map((tile, index) => (
        <Card key={tile.key} className="mem-stat" hover>
          <span className="mem-stat__glow" style={{ background: tile.color }} />
          <span className="mem-stat__icon" style={{ color: tile.color }}>{tile.icon}</span>
          <div className="mem-stat__body">
            <div className="mem-stat__label">{tile.label}</div>
            {loading ? (
              <>
                <div className="skeleton mem-stat__value-skeleton" />
                <div className="skeleton mem-stat__sub-skeleton" />
              </>
            ) : (
              <>
                <div className="mem-stat__value" style={{ animationDelay: `${index * 60}ms` }}>{tile.value}</div>
                <div className="mem-stat__sub">{tile.sub}</div>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
