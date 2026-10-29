import { useEffect, useState } from 'react';
import { Calculator, Info, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import type { BillingSettings } from '@shared/types';
import { Badge, Button, Card, CardBody, CardHead, Field, Input } from '@/components/ui';
import {
  BILLING_FIELDS, billingFormFrom, billingPatchFromForm, formatCny,
} from './costs-utils';

interface BillingSettingsCardProps {
  billing: BillingSettings;
  saving: boolean;
  onSave: (patch: Partial<BillingSettings>) => Promise<void>;
}

export function BillingSettingsCard({ billing, saving, onSave }: BillingSettingsCardProps) {
  const [form, setForm] = useState<Record<string, string>>(() => billingFormFrom(billing));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setForm(billingFormFrom(billing));
  }, [billing]);

  const update = (key: string, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    if (error) setError(null);
  };

  const save = async () => {
    for (const field of BILLING_FIELDS) {
      const value = Number(form[field.key]);
      if (!Number.isFinite(value) || value < 0) {
        setError(field.label + ' 需要是大于等于 0 的数字');
        return;
      }
    }
    setError(null);
    try {
      await onSave(billingPatchFromForm(form));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <Card className="costs-card costs-billing-card">
      <CardHead
        title="预算与单价"
        desc="费用估算所用的参考单价，可随时调整"
        icon={<Calculator size={16} />}
        extra={<Badge tone="brand">可配置</Badge>}
      />
      <CardBody>
        <div className="costs-billing">
          <Field label="月预算（CNY）" hint="用于本月进度、剩余预算，不会限制真实调用">
            <div className="costs-billing__budget-input">
              <span>¥</span>
              <Input
                type="number"
                min={0}
                step={1}
                value={form.monthlyBudgetCny ?? ''}
                onChange={(event) => update('monthlyBudgetCny', event.target.value)}
              />
            </div>
          </Field>
          <div className="costs-billing__current">当前预算 {formatCny(billing.monthlyBudgetCny)} / 月</div>

          <details className="costs-billing__advanced">
            <summary>
              <span><SlidersHorizontal size={13} /> 高级单价设置</span>
              <span className="costs-billing__summary-hint">DeepSeek / BreezeBlue / MiniMax / Suno / Serper</span>
            </summary>
            <div className="costs-billing__grid">
              {BILLING_FIELDS.filter((field) => field.group !== 'budget').map((field) => (
                <Field key={field.key} label={field.label} hint={field.hint}>
                  <div className="costs-billing__price-input">
                    <span>¥</span>
                    <Input
                      type="number"
                      min={0}
                      step={field.step}
                      value={form[field.key] ?? ''}
                      onChange={(event) => update(field.key, event.target.value)}
                    />
                  </div>
                </Field>
              ))}
            </div>
          </details>

          <div className="costs-billing__note">
            <Info size={13} />
            <span>修改单价只影响之后的费用估算，不会改写已产生的调用记录；实际扣费以供应商账单为准。</span>
          </div>

          {error && <div className="costs-billing__error">{error}</div>}

          <div className="costs-billing__actions">
            <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => { setForm(billingFormFrom(billing)); setError(null); }}>还原修改</Button>
            <Button size="sm" variant="primary" icon={<Save size={14} />} loading={saving} onClick={() => void save()}>保存计费设置</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
