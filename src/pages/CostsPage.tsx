import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, RefreshCw, Trash2, Wallet } from 'lucide-react';
import type { AppSettings, BillingSettings, ProviderBalance, UsageEntry, UsageSummary } from '@shared/types';
import { api, events as appEvents } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import {
  Badge, Button, Card, CardBody, EmptyState, Modal, PageHeader, SectionHead, Spinner, useToast,
} from '@/components/ui';
import { BillingSettingsCard } from '@/components/costs/BillingSettingsCard';
import { CostsHero, ProviderCards } from '@/components/costs/CostsHero';
import { ProviderBalances } from '@/components/costs/ProviderBalances';
import { UsageChart } from '@/components/costs/UsageChart';
import { UsageTable } from '@/components/costs/UsageTable';
import { billingFromSettings } from '@/components/costs/costs-utils';
import '@/styles/costs.css';

function mergeEntries(current: UsageEntry[], incoming: UsageEntry[]): UsageEntry[] {
  const map = new Map<string, UsageEntry>();
  for (const entry of [...incoming, ...current]) map.set(entry.id, entry);
  return Array.from(map.values())
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
    .slice(0, 500);
}

export default function CostsPage() {
  const toast = useToast();
  const { settings, setSettings } = useApp();
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [balances, setBalances] = useState<ProviderBalance[]>([]);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState<string | null>(null);
  const [billing, setBilling] = useState<BillingSettings>(() => billingFromSettings(settings));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [savingBilling, setSavingBilling] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const summaryRef = useRef<UsageSummary | null>(null);

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    try {
      const [nextSummary, nextEntries] = await Promise.all([api.usage.summary(), api.usage.list(200)]);
      summaryRef.current = nextSummary;
      setSummary(nextSummary);
      setEntries(nextEntries);
      setError(null);
      setSyncError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (initial || !summaryRef.current) setError(message);
      else setSyncError(message);
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const next = await api.usage.balances();
      setBalances(next);
      setBalancesError(null);
    } catch (cause) {
      setBalancesError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBalancesLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); void loadBalances(); }, [load, loadBalances]);

  useEffect(() => {
    setBilling(billingFromSettings(settings));
  }, [settings]);

  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      off = appEvents.on('usage:update', (next) => {
        summaryRef.current = next;
        setSummary(next);
        setEntries((previous) => mergeEntries(previous, next.recent));
      });
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : String(cause));
    }
    return () => off?.();
  }, []);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([load(false), loadBalances()]);
    } finally {
      setRefreshing(false);
    }
  };

  const saveBilling = async (patch: Partial<BillingSettings>): Promise<void> => {
    setSavingBilling(true);
    try {
      const result = await api.usage.saveBilling(patch);
      summaryRef.current = result.summary;
      setSummary(result.summary);
      setSettings(result.settings as AppSettings);
      setBilling(billingFromSettings(result.settings));
      setSyncError(null);
      toast.success('计费设置已保存', '之后产生的调用会按新的参考单价估算。');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      toast.error('保存计费设置失败', message);
      throw cause;
    } finally {
      setSavingBilling(false);
    }
  };

  const clearUsage = async () => {
    if (clearing) return;
    setClearing(true);
    try {
      await api.usage.clear();
      setConfirmClear(false);
      toast.success('用量记录已清空', '历史调用与费用统计已归零，新的调用会重新记账。');
      await load(false);
    } catch (cause) {
      toast.error('清空用量记录失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="costs-page">
      <PageHeader
        eyebrow="USAGE & COST LEDGER"
        icon={<Wallet size={12} />}
        title="费用账本"
        desc="真实 token 与调用量、按可配置参考单价估算的费用，以及每一笔供应商明细。"
        actions={(
          <>
            <Badge tone={summary ? 'success' : 'default'} dot>{summary ? '真实记账' : '读取中'}</Badge>
            <Button size="sm" variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void refresh()} loading={refreshing}>刷新</Button>
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmClear(true)} disabled={!summary || summary.all.calls === 0}>清空记录</Button>
          </>
        )}
      />

      {loading && !summary ? (
        <Card className="costs-loading-card">
          <CardBody>
            <div className="costs-loading__head"><Spinner label="正在读取真实调用记录…" /></div>
            <div className="costs-loading__hero skeleton" />
            <div className="costs-loading__grid">
              {[0, 1, 2, 3].map((item) => <span className="skeleton" key={item} style={{ height: 96 }} />)}
            </div>
          </CardBody>
        </Card>
      ) : error && !summary ? (
        <Card className="costs-error-card">
          <CardBody>
            <div className="costs-error__icon"><AlertTriangle size={24} /></div>
            <div className="costs-error__title">费用账本暂时无法读取</div>
            <div className="costs-error__desc">{error}</div>
            <Button variant="primary" icon={<RefreshCw size={15} />} onClick={() => void load(true)}>重新读取</Button>
            <div className="costs-error__hint">不会展示推测数据；请在桌面应用中确认用量服务已启动。</div>
          </CardBody>
        </Card>
      ) : summary ? (
        <>
          {syncError && (
            <div className="costs-alert">
              <AlertTriangle size={14} />
              <span>用量同步失败：{syncError}</span>
              <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void refresh()}>重试</Button>
            </div>
          )}

          <CostsHero summary={summary} />

          <ProviderBalances balances={balances} loading={balancesLoading} error={balancesError} onRefresh={() => void loadBalances()} />

          <section className="costs-section">
            <SectionHead
              title="供应商账单"
              desc="本月真实调用、用量与按参考单价估算的费用"
              extra={<Badge tone="brand">本月 · {summary.byProvider.length} 家供应商</Badge>}
            />
            <ProviderCards providers={summary.byProvider} monthCost={summary.month.costCny} />
          </section>

          <div className="costs-chart-row">
            <Card className="costs-card costs-chart-card">
              <div className="costs-card__head">
                <div>
                  <div className="costs-card__title"><BarChart3 size={16} /> 最近 30 天</div>
                  <div className="costs-card__desc">费用与调用量趋势 · 悬停查看每日明细</div>
                </div>
                <Badge tone="brand">按日汇总</Badge>
              </div>
              <CardBody>
                <UsageChart days={summary.byDay} />
              </CardBody>
            </Card>
            <BillingSettingsCard billing={billing} saving={savingBilling} onSave={saveBilling} />
          </div>

          <UsageTable entries={entries} refreshing={refreshing} onRefresh={() => void refresh()} />

          {summary.all.calls === 0 && (
            <EmptyState
              icon={<Wallet size={22} />}
              title="账本还是空的"
              desc="所有数字都来自真实调用。去聊天页发一条消息，或生成一次语音、图像，账本就会开始记录。"
            />
          )}
        </>
      ) : null}

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title="清空用量与费用记录？"
        desc="这会删除本地记录的全部调用明细，统计与预算进度都会归零。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>取消</Button>
            <Button variant="danger" icon={<Trash2 size={14} />} loading={clearing} onClick={() => void clearUsage()}>确认清空</Button>
          </>
        )}
      >
        <div className="callout callout--warning">
          <AlertTriangle size={15} className="callout__icon" />
          <div>清空后无法恢复历史记账。供应商侧的实际账单不会被修改；建议先导出或截图保留需要的数据。</div>
        </div>
      </Modal>
    </div>
  );
}
