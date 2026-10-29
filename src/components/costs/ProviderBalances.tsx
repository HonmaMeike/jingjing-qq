import { ExternalLink, RefreshCw, WalletCards } from 'lucide-react';
import type { ProviderBalance } from '@shared/types';
import { Badge, Button, Card, CardBody, CardHead, Spinner } from '@/components/ui';

interface Props {
  balances: ProviderBalance[];
  loading: boolean;
  error?: string | null;
  onRefresh: () => void;
}

export function ProviderBalances({ balances, loading, error, onRefresh }: Props) {
  return (
    <Card className="costs-balances">
      <CardHead
        title={<><span className="costs-balances__icon"><WalletCards size={15} /></span>供应商余额与额度</>}
        desc="DeepSeek 余额、BreezeBlue 积分、Suno 额度、Serper credits 来自各供应商实时接口；MiniMax 暂无公开余额 API。"
        extra={<><Badge tone="brand">真实余额</Badge><Button variant="ghost" size="sm" icon={<RefreshCw size={13} className={loading ? 'spin' : undefined} />} onClick={onRefresh} disabled={loading}>刷新</Button></>}
      />
      <CardBody>
        {loading && <Spinner label="正在查询各供应商余额" />}
        {error && <div className="costs-balances__error">{error}</div>}
        <div className="costs-balances__grid">
          {balances.map((item) => (
            <div className="costs-balance-card" key={item.provider}>
              <div className="costs-balance-card__head">
                <span className="costs-balance-card__name">{item.label}</span>
                <Badge tone={item.available ? 'success' : 'default'}>{item.available ? '已连接' : '未查询'}</Badge>
              </div>
              <div className="costs-balance-card__value">
                {item.available && item.balance !== undefined ? (
                  <><b>{item.balance.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</b><span>{item.unit || ''}</span></>
                ) : (
                  <span className="costs-balance-card__unknown">—</span>
                )}
              </div>
              <div className="costs-balance-card__meta">{item.available ? (item.detail || '余额有效') : (item.error || item.detail || '未配置或暂不可查')}</div>
              {item.sourceUrl && <button type="button" className="costs-balance-card__link" onClick={() => void import('@/lib/api').then(({ api }) => api.openExternal(item.sourceUrl!))}>去平台查看 <ExternalLink size={11} /></button>}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
