import { useMemo, useState } from 'react';
import { Receipt, RotateCcw } from 'lucide-react';
import type { UsageEntry, UsageKind, UsageProvider } from '@shared/types';
import { Badge, Button, Card, CardBody, CardHead, EmptyState, IconButton, Select } from '@/components/ui';
import { formatDateTime, formatNumber } from '@/lib/format';
import {
  USAGE_KIND_LABELS, USAGE_PROVIDER_META, formatCny, formatUnit,
} from './costs-utils';

const PROVIDERS: UsageProvider[] = ['deepseek', 'breezeblue', 'minimax', 'suno', 'serper', 'bilibili', 'napcat', 'memory', 'other'];
const KINDS: UsageKind[] = ['llm', 'tts', 'image', 'video', 'music', 'search', 'message', 'other'];

function kindTone(kind: UsageKind) {
  switch (kind) {
    case 'llm': return 'brand' as const;
    case 'tts': return 'pink' as const;
    case 'image': return 'mint' as const;
    case 'video': return 'warning' as const;
    case 'music': return 'pink' as const;
    case 'search': return 'warning' as const;
    case 'message': return 'mint' as const;
    default: return 'default' as const;
  }
}

interface UsageTableProps {
  entries: UsageEntry[];
  refreshing: boolean;
  onRefresh: () => void;
}

export function UsageTable({ entries, refreshing, onRefresh }: UsageTableProps) {
  const [provider, setProvider] = useState<'all' | UsageProvider>('all');
  const [kind, setKind] = useState<'all' | UsageKind>('all');

  const filtered = useMemo(() => entries.filter((entry) => {
    if (provider !== 'all' && entry.provider !== provider) return false;
    if (kind !== 'all' && entry.kind !== kind) return false;
    return true;
  }), [entries, provider, kind]);

  const reset = () => { setProvider('all'); setKind('all'); };

  return (
    <Card className="costs-card costs-table-card">
      <CardHead
        title="最近调用"
        desc="真实 API 调用记录 · 最新在前的明细账"
        icon={<Receipt size={16} />}
        extra={<><Badge tone="brand">{formatNumber(entries.length)} 条</Badge><IconButton label="刷新调用记录" active={refreshing} onClick={onRefresh}><RotateCcw size={15} className={refreshing ? 'spin' : undefined} /></IconButton></>}
      />
      <CardBody>
        <div className="costs-filters">
          <label className="costs-filter">
            <span>供应商</span>
            <Select value={provider} onChange={(event) => setProvider(event.target.value as 'all' | UsageProvider)}>
              <option value="all">全部供应商</option>
              {PROVIDERS.map((item) => <option key={item} value={item}>{USAGE_PROVIDER_META[item].label}</option>)}
            </Select>
          </label>
          <label className="costs-filter">
            <span>调用类型</span>
            <Select value={kind} onChange={(event) => setKind(event.target.value as 'all' | UsageKind)}>
              <option value="all">全部类型</option>
              {KINDS.map((item) => <option key={item} value={item}>{USAGE_KIND_LABELS[item]}</option>)}
            </Select>
          </label>
          <span className="costs-filters__count">显示 {formatNumber(filtered.length)} / {formatNumber(entries.length)} 条</span>
          {(provider !== 'all' || kind !== 'all') && <Button size="sm" variant="ghost" onClick={reset}>清除筛选</Button>}
        </div>
        {entries.length === 0 ? (
          <EmptyState
            icon={<Receipt size={22} />}
            title="还没有调用记录"
            desc="DeepSeek 对话、BreezeBlue 语音、MiniMax 图像或 Suno 音乐产生真实调用后，会在这里逐条记账。"
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Receipt size={21} />}
            title="没有符合筛选的调用"
            desc="换一个供应商或调用类型看看。"
            action={<Button size="sm" variant="ghost" onClick={reset}>清除筛选</Button>}
          />
        ) : (
          <div className="costs-table-wrap">
            <table className="costs-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>供应商</th>
                  <th>服务 / 模型</th>
                  <th>类型</th>
                  <th className="costs-col-tokens">Token</th>
                  <th>计量</th>
                  <th className="costs-col-cost">费用</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td className="costs-table__time" title={formatDateTime(entry.at)}>{formatDateTime(entry.at)}</td>
                    <td>
                      <span className="costs-provider-chip">
                        <i style={{ background: USAGE_PROVIDER_META[entry.provider].color }} />
                        {USAGE_PROVIDER_META[entry.provider].label}
                      </span>
                    </td>
                    <td>
                      <div className="costs-table__service">{entry.service}</div>
                      {entry.model && <div className="costs-table__model">{entry.model}</div>}
                    </td>
                    <td><Badge tone={kindTone(entry.kind)}>{USAGE_KIND_LABELS[entry.kind]}</Badge></td>
                    <td className="costs-col-tokens costs-table__num" title={entry.totalTokens ? '输入 ' + formatNumber(entry.inputTokens) + ' · 输出 ' + formatNumber(entry.outputTokens) : undefined}>{entry.totalTokens ? formatNumber(entry.totalTokens) : '—'}</td>
                    <td className="costs-table__num">{formatUnit(entry.units, entry.unit)}</td>
                    <td className="costs-col-cost costs-table__cost">{formatCny(entry.costCny, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
