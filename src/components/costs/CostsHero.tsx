import type { UsageByProvider, UsageSummary } from '@shared/types';
import {
  AudioLines, Brain, CircleDollarSign, Image as ImageIcon, Info, Music, PlaySquare,
  Search, Sparkles, TerminalSquare, Wallet, Zap,
} from 'lucide-react';
import { EmptyState } from '@/components/ui';
import {
  USAGE_PROVIDER_META, formatCny, formatUnit,
} from './costs-utils';
import { formatNumber } from '@/lib/format';

function providerIcon(provider: UsageByProvider['provider']) {
  switch (provider) {
    case 'deepseek': return <Sparkles size={16} />;
    case 'breezeblue': return <AudioLines size={16} />;
    case 'minimax': return <ImageIcon size={16} />;
    case 'suno': return <Music size={16} />;
    case 'serper': return <Search size={16} />;
    case 'bilibili': return <PlaySquare size={16} />;
    case 'napcat': return <TerminalSquare size={16} />;
    case 'memory': return <Brain size={16} />;
    default: return <Zap size={16} />;
  }
}

export function ProviderCards({ providers, monthCost }: { providers: UsageByProvider[]; monthCost: number }) {
  if (providers.length === 0) {
    return (
      <div className="costs-provider-empty">
        <EmptyState
          icon={<Wallet size={22} />}
          title="本月还没有供应商费用"
          desc="DeepSeek、BreezeBlue、MiniMax、Suno、Serper 的真实调用会自动汇总到这里。"
        />
      </div>
    );
  }
  return (
    <div className="costs-provider-grid">
      {providers.map((provider) => {
        const meta = USAGE_PROVIDER_META[provider.provider];
        const share = monthCost > 0 ? Math.min(100, (provider.costCny / monthCost) * 100) : 0;
        return (
          <article className={'costs-provider costs-provider--' + provider.provider} key={provider.provider}>
            <div className="costs-provider__head">
              <span className="costs-provider__icon">{providerIcon(provider.provider)}</span>
              <div className="costs-provider__names">
                <div className="costs-provider__name">{provider.label || meta.label}</div>
                <div className="costs-provider__calls">{formatNumber(provider.calls)} 次调用</div>
              </div>
              <span className="costs-provider__share">{share.toFixed(share >= 10 ? 0 : 1)}%</span>
            </div>
            <div className="costs-provider__cost">{formatCny(provider.costCny)}</div>
            <div className="costs-provider__bar"><span style={{ width: Math.max(share > 0 ? 2 : 0, share) + '%' }} /></div>
            <div className="costs-provider__foot">
              <span><Zap size={11} /> {formatUnit(provider.units, provider.unit)}</span>
              <span>{provider.tokens > 0 ? formatNumber(provider.tokens) + ' tokens' : '无 token 计量'}</span>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function CostsHero({ summary }: { summary: UsageSummary }) {
  const budget = summary.budget;
  const percent = Math.max(0, Math.min(100, budget.percent ?? 0));
  const tone = percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : 'brand';
  return (
    <section className="costs-hero">
      <div className="costs-hero__main">
        <div className="costs-eyebrow">MONTHLY BUDGET</div>
        <div className="costs-hero__amount">
          <strong>{formatCny(summary.month.costCny)}</strong>
          <span>/ {budget.monthlyCny > 0 ? formatCny(budget.monthlyCny) : '未设预算'}</span>
        </div>
        <div className="costs-hero__budget-row">
          <span>本月已用 {percent}%</span>
          <span>剩余 {formatCny(budget.remainingCny)}</span>
        </div>
        <div className={'costs-budget-bar is-' + tone}><span style={{ width: percent + '%' }} /></div>
        <div className="costs-hero__note">
          <Info size={13} />
          <span>调用量与 tokens 来自真实 API 记录；费用按设置中的参考单价估算，实际账单以供应商为准。</span>
        </div>
      </div>
      <div className="costs-hero__stats">
        <div className="costs-stat costs-stat--today">
          <span className="costs-stat__icon"><CircleDollarSign size={16} /></span>
          <div><span>今日费用</span><strong>{formatCny(summary.today.costCny)}</strong><small>{formatNumber(summary.today.calls)} 次调用</small></div>
        </div>
        <div className="costs-stat">
          <span className="costs-stat__icon"><Zap size={16} /></span>
          <div><span>本月调用</span><strong>{formatNumber(summary.month.calls)}</strong><small>累计 {formatNumber(summary.all.calls)} 次</small></div>
        </div>
        <div className="costs-stat">
          <span className="costs-stat__icon"><Brain size={16} /></span>
          <div><span>总 Token</span><strong>{formatNumber(summary.all.totalTokens)}</strong><small>输入 {formatNumber(summary.all.inputTokens)} · 输出 {formatNumber(summary.all.outputTokens)}</small></div>
        </div>
        <div className="costs-stat">
          <span className="costs-stat__icon"><Wallet size={16} /></span>
          <div><span>剩余预算</span><strong>{formatCny(budget.remainingCny)}</strong><small>{budget.monthlyCny > 0 ? '月预算 ' + formatCny(budget.monthlyCny) : '可以在右下方设置预算'}</small></div>
        </div>
      </div>
    </section>
  );
}
