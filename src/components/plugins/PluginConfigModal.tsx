import React from 'react';
import { Eye, EyeOff, RotateCcw, Save, SlidersHorizontal } from 'lucide-react';
import type { PluginConfigField, PluginInfo } from '@shared/types';
import { Badge, Button, EmptyState, Field, IconButton, Input, Modal, Select, SettingRow, Textarea, Toggle, useToast } from '@/components/ui';
import { api } from '@/lib/api';
import { PLUGIN_STATUS_META } from './meta';

type FormValue = string | number | boolean;

function initForm(fields: PluginConfigField[], config: Record<string, unknown>, useDefaults: boolean): Record<string, FormValue> {
  const out: Record<string, FormValue> = {};
  for (const field of fields) {
    const current = useDefaults ? undefined : config?.[field.key];
    if (field.type === 'boolean') {
      out[field.key] = typeof current === 'boolean' ? current : Boolean(field.default ?? false);
    } else if (field.type === 'number') {
      const raw = current ?? field.default ?? 0;
      const parsed = Number(raw);
      out[field.key] = Number.isFinite(parsed) ? parsed : 0;
    } else if (field.type === 'select') {
      out[field.key] = String(current ?? field.default ?? field.options?.[0]?.value ?? '');
    } else {
      out[field.key] = String(current ?? field.default ?? '');
    }
  }
  return out;
}

function normalize(fields: PluginConfigField[], form: Record<string, FormValue>, base: Record<string, unknown>): Record<string, unknown> {
  const config: Record<string, unknown> = { ...base };
  for (const field of fields) {
    const value = form[field.key];
    if (field.type === 'number') {
      const parsed = Number(value);
      config[field.key] = Number.isFinite(parsed) ? parsed : Number(field.default ?? 0);
    } else if (field.type === 'boolean') {
      config[field.key] = Boolean(value);
    } else {
      config[field.key] = value;
    }
  }
  return config;
}

export function PluginConfigModal({ plugin, onClose, onSaved }: { plugin: PluginInfo | null; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const toast = useToast();
  const [form, setForm] = React.useState<Record<string, FormValue>>({});
  const [baseline, setBaseline] = React.useState<Record<string, FormValue>>({});
  const [visible, setVisible] = React.useState<Record<string, boolean>>({});
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (!plugin) return;
    const initial = initForm(plugin.configFields, plugin.config, false);
    setForm(initial);
    setBaseline(initial);
    setVisible({});
  }, [plugin?.id]);

  const fields = plugin?.configFields ?? [];
  const regular = fields.filter((f) => f.type !== 'boolean');
  const switches = fields.filter((f) => f.type === 'boolean');
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  const setField = (key: string, value: FormValue) => setForm((prev) => ({ ...prev, [key]: value }));
  const resetDefaults = () => { if (!plugin) return; setForm(initForm(fields, {}, true)); };

  const save = async () => {
    if (!plugin || saving) return;
    setSaving(true);
    try {
      const config = normalize(fields, form, plugin.config);
      await api.plugins.configure(plugin.id, config);
      await onSaved();
      toast.success('插件配置已保存', plugin.name);
      onClose();
    } catch (error) {
      toast.error('保存失败', error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!plugin}
      onClose={onClose}
      title={plugin ? `配置 · ${plugin.name}` : '配置插件'}
      desc={plugin ? `${plugin.description || '该插件没有描述'} · 配置会立即写入本地数据目录` : undefined}
      footer={plugin ? (
        <>
          <span className="plg-config__dirty">{dirty ? '有未保存的修改' : ''}</span>
          <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={resetDefaults} disabled={!fields.length || !dirty}>恢复默认</Button>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={() => void save()}>保存配置</Button>
        </>
      ) : undefined}
    >
      {!plugin ? null : (
        <div className="plg-config">
          <div className="plg-config__banner">
            <div className="plg-config__banner-icon"><SlidersHorizontal size={18} /></div>
            <div className="flex-1">
              <div className="plg-config__banner-title">
                <span className="mono">v{plugin.version}</span>
                <Badge tone={PLUGIN_STATUS_META[plugin.status]?.tone ?? 'default'}>{PLUGIN_STATUS_META[plugin.status]?.label ?? plugin.status}</Badge>
                {plugin.builtin && <Badge tone="brand">内置模块</Badge>}
              </div>
              {plugin.usage && <div className="plg-config__usage">{plugin.usage}</div>}
            </div>
          </div>

          {!fields.length ? (
            <EmptyState title="该插件无需配置" desc="启用后即可直接使用，无需填写额外参数。" />
          ) : (
            <>
              {regular.length > 0 && (
                <div className="plg-config__grid">
                  {regular.map((field) => (
                    <Field key={field.key} label={field.label} hint={field.description}>
                      {field.type === 'textarea' ? (
                        <Textarea
                          rows={4}
                          placeholder={field.placeholder}
                          value={String(form[field.key] ?? '')}
                          onChange={(e) => setField(field.key, e.target.value)}
                        />
                      ) : field.type === 'select' ? (
                        <Select value={String(form[field.key] ?? '')} onChange={(e) => setField(field.key, e.target.value)}>
                          {(field.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </Select>
                      ) : field.type === 'password' ? (
                        <div className="input-group">
                          <Input
                            type={visible[field.key] ? 'text' : 'password'}
                            placeholder={field.placeholder}
                            autoComplete="off"
                            value={String(form[field.key] ?? '')}
                            onChange={(e) => setField(field.key, e.target.value)}
                          />
                          <IconButton label={visible[field.key] ? '隐藏内容' : '显示内容'} onClick={() => setVisible((prev) => ({ ...prev, [field.key]: !prev[field.key] }))}>
                            {visible[field.key] ? <EyeOff size={15} /> : <Eye size={15} />}
                          </IconButton>
                        </div>
                      ) : field.type === 'number' ? (
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder={field.placeholder}
                          value={form[field.key] === '' ? '' : Number(form[field.key])}
                          onChange={(e) => setField(field.key, e.target.value === '' ? '' : Number(e.target.value))}
                        />
                      ) : (
                        <Input
                          type="text"
                          placeholder={field.placeholder}
                          value={String(form[field.key] ?? '')}
                          onChange={(e) => setField(field.key, e.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              )}

              {switches.length > 0 && (
                <div className="plg-config__switches">
                  {switches.map((field) => (
                    <SettingRow key={field.key} title={field.label} desc={field.description}>
                      <Toggle checked={Boolean(form[field.key])} onChange={(value) => setField(field.key, value)} label={field.label} />
                    </SettingRow>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
