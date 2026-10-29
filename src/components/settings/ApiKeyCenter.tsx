import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Eye, EyeOff, ExternalLink, KeyRound, Loader2, Save, ShieldCheck, XCircle } from 'lucide-react';
import type { ApiKeys } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import { Badge, Button, Card, CardBody, CardHead, IconButton, Input, Spinner, useToast } from '@/components/ui';
import { API_SERVICES, type ApiKeyId } from '@/components/settings/settingsMeta';

interface TestResult { ok: boolean; message: string; latencyMs?: number }

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ApiKeyCenter() {
  const { keyStatus, saveSettings } = useApp();
  const toast = useToast();
  const [values, setValues] = useState<Partial<Record<ApiKeyId, string>>>({});
  const [visible, setVisible] = useState<Partial<Record<ApiKeyId, boolean>>>({});
  const [masked, setMasked] = useState<Partial<Record<ApiKeyId, string>>>({});
  const [maskedLoading, setMaskedLoading] = useState(true);
  const [testing, setTesting] = useState<ApiKeyId | null>(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState<Partial<Record<ApiKeyId, TestResult>>>({});

  const loadMasked = useCallback(async () => {
    try {
      const res = await api.settings.get();
      setMasked(res.maskedKeys ?? {});
    } catch {
      setMasked({});
    } finally {
      setMaskedLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMasked();
  }, [loadMasked]);

  const configuredCount = API_SERVICES.filter((service) => keyStatus[service.id]).length;

  const updateValue = (id: ApiKeyId, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
    setResults((prev) => ({ ...prev, [id]: undefined }));
  };

  const draftEntries = () => {
    const entries: Partial<ApiKeys> = {};
    for (const service of API_SERVICES) {
      const value = values[service.id]?.trim();
      if (value) entries[service.id] = value;
    }
    return entries;
  };

  const saveKeys = async () => {
    const entries = draftEntries();
    if (!Object.keys(entries).length) {
      toast.warning('还没有填写新的密钥', '在下方输入框里粘贴至少一个 Key 再保存。');
      return;
    }
    setSaving(true);
    try {
      await saveSettings(undefined, entries);
      setValues({});
      await loadMasked();
      toast.success('密钥已加密保存', '新的密钥会立刻用于下一次对话与创作。');
    } catch (error) {
      toast.error('保存密钥失败', errText(error));
    } finally {
      setSaving(false);
    }
  };

  const test = async (service: ApiKeyId) => {
    if (testing) return;
    setTesting(service);
    setResults((prev) => ({ ...prev, [service]: undefined }));
    try {
      const draft = values[service]?.trim();
      if (draft) {
        await saveSettings(undefined, { [service]: draft } as Partial<ApiKeys>);
        setValues((prev) => ({ ...prev, [service]: '' }));
        await loadMasked();
      }
      const result = await api.settings.test(service);
      setResults((prev) => ({ ...prev, [service]: result }));
      if (result.ok) toast.success(API_SERVICES.find((item) => item.id === service)?.label + ' 连接正常', result.latencyMs !== undefined ? '耗时 ' + result.latencyMs + ' ms' : result.message);
      else toast.error(API_SERVICES.find((item) => item.id === service)?.label + ' 连接失败', result.message);
    } catch (error) {
      const message = errText(error);
      setResults((prev) => ({ ...prev, [service]: { ok: false, message } }));
      toast.error('连接测试失败', message);
    } finally {
      setTesting(null);
    }
  };

  return (
    <Card className="stg-keycard">
      <CardHead
        title={<><span className="stg-card-icon is-brand"><KeyRound size={15} /></span>API 密钥中心</>}
        desc="所有第三方密钥只在这一张卡片里填写；加密后只保存在本机，不会出现在日志或截图里。"
        extra={<Badge tone={configuredCount === API_SERVICES.length ? 'success' : configuredCount ? 'warning' : 'default'}>{configuredCount} / {API_SERVICES.length} 已配置</Badge>}
      />
      <CardBody>
        <div className="stg-keylist">
          {API_SERVICES.map((service) => {
            const Icon = service.icon;
            const configured = keyStatus[service.id];
            const result = results[service.id];
            const busy = testing === service.id;
            return (
              <div className="stg-keyrow" key={service.id}>
                <span className="stg-keyrow__icon" style={{ color: service.color, background: 'color-mix(in srgb, ' + service.color + ' 11%, transparent)', borderColor: 'color-mix(in srgb, ' + service.color + ' 24%, transparent)' }}>
                  <Icon size={17} />
                </span>
                <div className="stg-keyrow__head">
                  <div className="stg-keyrow__name">
                    {service.label}
                    <span className="stg-keyrow__role">{service.role}</span>
                    {configured ? <Badge tone="success"><CheckCircle2 size={10} />已配置</Badge> : <Badge><XCircle size={10} />未配置</Badge>}
                  </div>
                  <div className="stg-keyrow__purpose">{service.purpose}</div>
                </div>
                <div className="stg-keyrow__inputwrap">
                  {maskedLoading ? (
                    <Spinner label="读取密钥状态" />
                  ) : (
                    <Input
                      className="stg-keyrow__input"
                      type={visible[service.id] ? 'text' : 'password'}
                      autoComplete="off"
                      spellCheck={false}
                      value={values[service.id] ?? ''}
                      onChange={(event) => updateValue(service.id, event.target.value)}
                      placeholder={masked[service.id] ? '已保存 ' + masked[service.id] + '，输入新 Key 可替换' : service.placeholder}
                      aria-label={service.label + ' API Key'}
                    />
                  )}
                  <IconButton
                    label={visible[service.id] ? '隐藏密钥' : '显示密钥'}
                    className="stg-keyrow__eye"
                    onClick={() => setVisible((prev) => ({ ...prev, [service.id]: !prev[service.id] }))}
                  >
                    {visible[service.id] ? <EyeOff size={15} /> : <Eye size={15} />}
                  </IconButton>
                </div>
                <div className="stg-keyrow__actions">
                  <Button variant="ghost" size="sm" loading={busy} onClick={() => void test(service.id)} disabled={testing !== null}>
                    {busy ? '测试中…' : '测试'}
                  </Button>
                  <IconButton label={'打开 ' + service.label + ' 文档'} onClick={() => void api.openExternal(service.docs).catch((error) => toast.error('打开文档失败', errText(error)))}>
                    <ExternalLink size={15} />
                  </IconButton>
                </div>
                {result && (
                  <div className={result.ok ? 'stg-keyrow__result is-ok' : 'stg-keyrow__result is-bad'}>
                    {busy ? <Loader2 size={12} className="spin" /> : result.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                    {result.message}{result.latencyMs !== undefined ? ' · ' + result.latencyMs + ' ms' : ''}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="stg-keycard__foot">
          <div className="stg-keycard__note">
            <ShieldCheck size={14} />
            <span>密钥通过系统安全存储加密；页面只显示是否已配置。测试会先保存当前输入的新 Key，再发起真实请求。</span>
          </div>
          <Button variant="primary" icon={<Save size={15} />} loading={saving} onClick={() => void saveKeys()}>
            保存密钥
          </Button>
        </div>
        <div className="stg-keycard__docs">
          {API_SERVICES.map((service) => (
            <button type="button" key={service.id} className="stg-doclink" onClick={() => void api.openExternal(service.docs).catch(() => undefined)}>
              {service.docsLabel}<ExternalLink size={11} />
            </button>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}
