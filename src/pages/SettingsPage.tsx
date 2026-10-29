import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, CheckCircle2, Cpu, Database, Download, ExternalLink, FolderOpen, Info,
  Layers, Loader2, Moon, RefreshCw, RotateCcw, Save, ShieldCheck, SlidersHorizontal,
  Search, Sparkles, Trash2, XCircle,
} from 'lucide-react';
import type { AppSettings, ServiceId } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import {
  Badge, Button, Card, CardBody, CardHead, Field, Input, Modal, PageHeader,
  Select, SettingRow, Spinner, Tabs, Toggle, cn, useToast,
} from '@/components/ui';
import TagListEditor from '@/components/settings/TagListEditor';
import ApiKeyCenter from '@/components/settings/ApiKeyCenter';
import VoiceCard from '@/components/settings/VoiceCard';
import {
  ACCENT_OPTIONS, API_SERVICES, DEEPSEEK_MODELS, DEEPSEEK_REASONING_EFFORTS, IMAGE_ASPECTS,
  MINIMAX_IMAGE_MODELS, MINIMAX_VIDEO_MODELS, PROACTIVE_TARGETS, QZONE_VISIBILITY, SERVICE_TEST_ORDER,
  SUNO_MODELS, VIDEO_ASPECTS, videoCapabilities, type PatchSection,
} from '@/components/settings/settingsMeta';
import '@/styles/settings.css';

type TabKey = 'basic' | 'keys' | 'models' | 'permissions' | 'life' | 'context' | 'about';
const TAB_KEYS: TabKey[] = ['basic', 'keys', 'models', 'permissions', 'life', 'context', 'about'];

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cloneSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings;
}

function tabFromHash(): TabKey {
  const query = window.location.hash.split('?')[1] ?? '';
  const tab = new URLSearchParams(query).get('tab') as TabKey | null;
  return tab && TAB_KEYS.includes(tab) ? tab : 'basic';
}

function ToggleRow({ title, desc, checked, onChange, disabled }: { title: ReactNode; desc?: ReactNode; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <SettingRow title={title} desc={desc}><Toggle checked={checked} onChange={onChange} disabled={disabled} label={typeof title === 'string' ? title : '切换'} /></SettingRow>;
}

function NumberField({ label, hint, value, onChange, min, max, step, suffix }: { label: string; hint?: ReactNode; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; suffix?: string }) {
  return (
    <Field label={label} hint={hint}>
      <div className="stg-number">
        <Input type="number" value={value} min={min} max={max} step={step ?? 1} onChange={(event) => onChange(Number(event.target.value))} />
        {suffix && <span className="stg-number__suffix">{suffix}</span>}
      </div>
    </Field>
  );
}

function RangeField({ label, value, onChange, min = 0, max = 100, step = 1, format }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; format?: (value: number) => string }) {
  return (
    <div className="stg-range">
      <div className="stg-range__head"><span>{label}</span><b>{format ? format(value) : value}</b></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <div className="stg-range__scale"><span>{min}</span><span>{max}</span></div>
    </div>
  );
}

interface TestResult { ok: boolean; message: string; latencyMs?: number }

export default function SettingsPage() {
  const { data, settings, keyStatus, saveSettings, reload, refreshConversations, setOnboardingOpen } = useApp();
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>(() => tabFromHash());
  const [draft, setDraft] = useState<AppSettings>(() => cloneSettings(settings));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingService, setTestingService] = useState<ServiceId | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<string, TestResult>>>({});
  const [info, setInfo] = useState<{ version: string; electron: string; platform: string; dataDir: string; logFile: string } | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [clearingDemo, setClearingDemo] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetDataOpen, setResetDataOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resettingData, setResettingData] = useState(false);
  const [clearDemoOpen, setClearDemoOpen] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setDraft(cloneSettings(settings));
  }, [settings, dirty]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const scroll = document.querySelector('.main-scroll');
    if (scroll) scroll.scrollTo({ top: 0, behavior: 'smooth' });
  }, [tab]);

  const loadInfo = useCallback(async () => {
    setInfoLoading(true);
    setInfoError(null);
    try {
      setInfo(await api.info());
    } catch (caught) {
      setInfoError(errText(caught));
    } finally {
      setInfoLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const patchSection: PatchSection = (section, patch) => {
    setDraft((prev) => ({ ...prev, [section]: { ...(prev[section] as unknown as Record<string, unknown>), ...(patch as unknown as Record<string, unknown>) } } as AppSettings));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const mainQQ = draft.general.ownerQQ.trim();
      const owners = mainQQ && !draft.permissions.owners.includes(mainQQ)
        ? [...draft.permissions.owners, mainQQ]
        : draft.permissions.owners;
      await saveSettings({ ...draft, permissions: { ...draft.permissions, owners } });
      setDirty(false);
      toast.success('设置已保存', '大部分设置即时生效，密钥请到「API 密钥」卡片单独保存。');
    } catch (caught) {
      toast.error('保存设置失败', errText(caught));
    } finally {
      setSaving(false);
    }
  };

  const discard = () => {
    setDraft(cloneSettings(settings));
    setDirty(false);
    toast.info('已放弃修改', '所有改动已还原为上次保存的版本。');
  };

  const testService = async (service: ServiceId) => {
    if (testingService) return;
    setTestingService(service);
    try {
      const result = await api.settings.test(service);
      setTestResults((prev) => ({ ...prev, [service]: result }));
      if (result.ok) toast.success('连接正常', result.latencyMs !== undefined ? '耗时 ' + result.latencyMs + ' ms' : result.message);
      else toast.error('连接失败', result.message);
    } catch (caught) {
      const message = errText(caught);
      setTestResults((prev) => ({ ...prev, [service]: { ok: false, message } }));
      toast.error('连接测试失败', message);
    } finally {
      setTestingService(null);
    }
  };

  const pickAssets = async () => {
    try {
      const result = await api.settings.pickAssets();
      setDraft((prev) => ({ ...prev, general: { ...prev.general, assetsPath: result.path } }));
      void reload().catch(() => undefined);
      toast.success('素材目录已更新', result.path);
    } catch (caught) {
      const message = errText(caught);
      if (message.includes('未选择')) toast.info('没有选择目录', '素材目录保持不变。');
      else toast.error('选择素材目录失败', message);
    }
  };

  const exportBackup = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await api.settings.export();
      if (result.ok && result.path) toast.success('备份已导出', result.path);
      else toast.error('备份失败', result.error || '未知错误');
    } catch (caught) {
      toast.error('备份失败', errText(caught));
    } finally {
      setExporting(false);
    }
  };

  const clearDemo = async () => {
    if (clearingDemo) return;
    setClearingDemo(true);
    try {
      const result = await api.settings.clearDemo();
      await refreshConversations();
      setClearDemoOpen(false);
      toast.success('演示会话已清除', result.removed ? '移除了 ' + result.removed + ' 个演示会话' : '没有找到演示会话');
    } catch (caught) {
      toast.error('清除演示会话失败', errText(caught));
    } finally {
      setClearingDemo(false);
    }
  };

  const resetUserData = async () => {
    if (resettingData) return;
    setResettingData(true);
    try {
      await api.resetData();
      toast.success('数据已清空', '应用会自动重启；设置、密钥、人设与音色绑定会保留。');
    } catch (caught) {
      toast.error('重置失败', errText(caught));
      setResettingData(false);
    }
  };

  const resetSettings = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await api.settings.reset();
      setResetOpen(false);
      setDirty(false);
      await reload();
      toast.success('设置已重置', '所有设置与密钥都回到了默认值，数据目录里的记忆与聊天仍然保留。');
    } catch (caught) {
      toast.error('重置失败', errText(caught));
    } finally {
      setResetting(false);
    }
  };

  const tabs = useMemo<{ value: TabKey; label: ReactNode }[]>(() => ([
    { value: 'basic', label: <><SlidersHorizontal size={14} />基础外观</> },
    { value: 'keys', label: <><ShieldCheck size={14} />API 密钥</> },
    { value: 'models', label: <><Cpu size={14} />模型与语音</> },
    { value: 'permissions', label: <><ShieldCheck size={14} />权限</> },
    { value: 'life', label: <><Sparkles size={14} />自主生活</> },
    { value: 'context', label: <><Database size={14} />上下文与数据</> },
    { value: 'about', label: <><Info size={14} />关于</> },
  ]), []);

  const configProgress = API_SERVICES.filter((service) => keyStatus[service.id]).length;
  const mergedOwners = draft.permissions.owners;

  return (
    <>
      <PageHeader
        eyebrow="PREFERENCES"
        icon={<SlidersHorizontal size={13} />}
        title="设置"
        desc="鲸鲸的全部偏好都保存在本机：模型、声音、权限、自主生活的节奏，以及加密的第三方密钥。"
        actions={(
          <>
            <Badge tone="brand" dot>{configProgress} / {API_SERVICES.length} 密钥已配置</Badge>
            <Button variant="secondary" icon={<Sparkles size={14} />} onClick={() => setOnboardingOpen(true)}>重新观看引导</Button>
          </>
        )}
      />

      <div className={cn('stg-savebar', dirty && 'is-dirty')}>
        <span className="stg-savebar__state"><span className="dot" />{dirty ? '有未保存的修改' : '所有设置已同步'}</span>
        <span className="stg-savebar__hint">API 密钥在「API 密钥」卡片单独保存；其余修改点「保存全部」后生效。</span>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={discard} disabled={!dirty || saving}>放弃修改</Button>
        <Button variant="primary" size="sm" icon={<Save size={14} />} loading={saving} onClick={() => void handleSave()} disabled={!dirty}>保存全部</Button>
      </div>

      <Tabs value={tab} onChange={setTab} items={tabs} className="stg-tabs" />

      <div className="stg-panel" key={tab}>
        {tab === 'basic' && (
          <div className="stg-grid">
            <Card>
              <CardHead title={<><span className="stg-card-icon is-brand"><Sparkles size={14} /></span>身份与称呼</>} desc="她怎么称呼你，以及你在 QQ 里的主人身份。" />
              <CardBody>
                <div className="stg-form stg-form--2">
                  <Field label="她的默认名字" hint="保存为鲸鲸的通用名字；展示时优先使用当前人设的昵称。">
                    <Input value={draft.general.botName} onChange={(event) => patchSection('general', { botName: event.target.value })} maxLength={20} />
                  </Field>
                  <Field label="主人 QQ" hint="用于识别你本人、主动找你；保存时会同步加入「权限」里的主人名单。">
                    <Input value={draft.general.ownerQQ} onChange={(event) => patchSection('general', { ownerQQ: event.target.value.replace(/[^0-9]/g, '') })} placeholder="例如 10001" inputMode="numeric" maxLength={20} />
                  </Field>
                </div>
                <div className="stg-assets">
                  <Field label="素材目录" hint="dsh-pet 动画、表情与贴纸所在目录；更换后会自动重新载入素材。">
                    <div className="stg-assets__row">
                      <Input value={draft.general.assetsPath} readOnly placeholder="使用内置素材目录" />
                      <Button variant="secondary" size="sm" icon={<FolderOpen size={13} />} onClick={() => void pickAssets()}>选择目录</Button>
                    </div>
                  </Field>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHead title={<><span className="stg-card-icon is-violet"><Moon size={14} /></span>外观</>} desc="深色是鲸落海的默认颜色，浅色适合白天。" />
              <CardBody>
                <Field label="主题">
                  <div className="stg-theme-row">
                    {([['dark', '深色'], ['light', '浅色'], ['system', '跟随系统']] as const).map(([value, label]) => (
                      <button type="button" key={value} className={cn('stg-theme', draft.general.theme === value && 'is-active')} onClick={() => patchSection('general', { theme: value })}>{label}</button>
                    ))}
                  </div>
                </Field>
                <Field label="强调色" hint="影响按钮、光晕、进度与高亮。">
                  <div className="stg-accents">
                    {ACCENT_OPTIONS.map((accent) => (
                      <button
                        type="button"
                        key={accent.value}
                        className={cn('stg-accent', draft.general.accent === accent.value && 'is-active')}
                        onClick={() => patchSection('general', { accent: accent.value })}
                        title={accent.label}
                      >
                        <span className="stg-accent__dot" style={{ background: accent.color }} />
                        {accent.label}
                      </button>
                    ))}
                  </div>
                </Field>
                <div className="stg-theme-preview">
                  <div className="stg-theme-preview__card">
                    <span className="stg-theme-preview__eyebrow">PREVIEW</span>
                    <span className="stg-theme-preview__title">鲸鲸在海底等你</span>
                    <span className="stg-theme-preview__line" />
                    <span className="stg-theme-preview__line is-short" />
                  </div>
                  <span className="dim text-xs">保存后整个应用会立刻切换。</span>
                </div>
              </CardBody>
            </Card>

            <Card className="stg-span2">
              <CardHead title={<><span className="stg-card-icon is-mint"><Cpu size={14} /></span>启动与托盘</>} desc="决定鲸鲸在系统里的存在方式。" />
              <CardBody>
                <ToggleRow title="开机自启" desc="登录 Windows 时自动启动鲸鲸。" checked={draft.general.autoLaunch} onChange={(value) => patchSection('general', { autoLaunch: value })} />
                <ToggleRow title="关闭窗口时最小化到托盘" desc="点关闭不退出，鲸鲸继续在后台陪伴。" checked={draft.general.closeToTray} onChange={(value) => patchSection('general', { closeToTray: value })} />
                <ToggleRow title="最小化到托盘" desc="最小化按钮也会收进系统托盘。" checked={draft.general.minimizeToTray} onChange={(value) => patchSection('general', { minimizeToTray: value })} />
                <ToggleRow title="启动时隐藏窗口" desc="随系统启动时先待在托盘里。" checked={draft.general.startMinimized} onChange={(value) => patchSection('general', { startMinimized: value })} />
                <ToggleRow title="检查更新" desc="启动时检查新版本，不发送任何使用数据。" checked={draft.general.checkUpdates} onChange={(value) => patchSection('general', { checkUpdates: value })} />
              </CardBody>
            </Card>
          </div>
        )}

        {tab === 'keys' && (
          <div className="stg-stack">
            <ApiKeyCenter />
            <div className="callout callout--brand">
              <ShieldCheck size={15} className="callout__icon" />
              <span>这是全应用唯一的密钥填写入口。DeepSeek 缺省时聊天会退回演示模式；MiniMax / Suno / BreezeBlue 缺省时对应创作与语音会提示先去配置。</span>
            </div>
          </div>
        )}

        {tab === 'models' && (
          <div className="stg-stack">
            <Card>
              <CardHead
                title={<><span className="stg-card-icon is-brand"><Layers size={14} /></span>服务端点</>}
                desc="所有请求都从本机直接发往这些地址；代理或中转可在这里替换。"
                extra={<Badge>{SERVICE_TEST_ORDER.length} 个服务</Badge>}
              />
              <CardBody>
                <div className="stg-form stg-form--2">
                  <Field label="DeepSeek Base URL"><Input value={draft.endpoints.deepseekBaseUrl} onChange={(event) => patchSection('endpoints', { deepseekBaseUrl: event.target.value })} /></Field>
                  <Field label="BreezeBlue Base URL"><Input value={draft.endpoints.breezeblueBaseUrl} onChange={(event) => patchSection('endpoints', { breezeblueBaseUrl: event.target.value })} /></Field>
                  <Field label="MiniMax Base URL"><Input value={draft.endpoints.minimaxBaseUrl} onChange={(event) => patchSection('endpoints', { minimaxBaseUrl: event.target.value })} /></Field>
                  <Field label="Suno Base URL"><Input value={draft.endpoints.sunoBaseUrl} onChange={(event) => patchSection('endpoints', { sunoBaseUrl: event.target.value })} /></Field>
                  <Field label="Serper Base URL"><Input value={draft.endpoints.serperBaseUrl} onChange={(event) => patchSection('endpoints', { serperBaseUrl: event.target.value })} /></Field>
                </div>
                <div className="stg-tests">
                  {SERVICE_TEST_ORDER.map((service) => {
                    const meta = API_SERVICES.find((item) => item.id === service);
                    const result = testResults[service];
                    const busy = testingService === service;
                    return (
                      <button type="button" key={service} className={cn('stg-test', result?.ok && 'is-ok', result && !result.ok && 'is-bad')} onClick={() => void testService(service)} disabled={testingService !== null}>
                        {busy ? <Loader2 size={13} className="spin" /> : result?.ok ? <CheckCircle2 size={13} /> : result ? <XCircle size={13} /> : <span className="stg-test__dot" />}
                        <span className="stg-test__label">{meta?.label ?? service}</span>
                        <span className="stg-test__detail">{busy ? '测试中' : result ? result.message : '测试连接'}</span>
                      </button>
                    );
                  })}
                </div>
              </CardBody>
            </Card>

            <div className="stg-grid">
              <Card>
                <CardHead title={<><span className="stg-card-icon is-brand"><Cpu size={14} /></span>DeepSeek 对话模型</>} desc="聊天与日记的默认大脑。" />
                <CardBody>
                  <div className="stg-form stg-form--2">
                    <Field label="对话模型">
                      <Select value={draft.models.deepseekChat} onChange={(event) => patchSection('models', { deepseekChat: event.target.value })}>
                        {DEEPSEEK_MODELS.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="思考强度" hint="V4 两个模型都支持思考模式；max 更深但更慢更贵。">
                      <Select value={draft.deepseek.reasoningEffort ?? 'high'} onChange={(event) => patchSection('deepseek', { reasoningEffort: event.target.value as 'low' | 'high' | 'max' })}>
                        {DEEPSEEK_REASONING_EFFORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                      </Select>
                    </Field>
                    <NumberField label="温度" hint="越高越发散；V4 思考模式下该参数不生效。" value={draft.deepseek.temperature} step={0.05} min={0} max={2} onChange={(value) => patchSection('deepseek', { temperature: value })} />
                    <NumberField label="单次最大 Tokens" hint="官方最大 384K；聊天建议 1200–4000。" value={draft.deepseek.maxTokens} step={100} min={200} max={131072} onChange={(value) => patchSection('deepseek', { maxTokens: value })} />
                    <NumberField label="超时（毫秒）" value={draft.deepseek.timeoutMs} step={5000} min={10000} max={300000} onChange={(value) => patchSection('deepseek', { timeoutMs: value })} />
                    <NumberField label="每日 Token 预算" value={draft.deepseek.dailyTokenBudget} step={10000} min={10000} onChange={(value) => patchSection('deepseek', { dailyTokenBudget: value })} />
                  </div>
                  <ToggleRow title="流式回复" desc="边生成边显示；关闭后等完整回复再一次性出现。" checked={draft.deepseek.stream} onChange={(value) => patchSection('deepseek', { stream: value })} />
                  <ToggleRow title="V4 思考模式" desc="默认开启；关闭后回复更快、更省 Token。" checked={draft.deepseek.useReasoningForChat} onChange={(value) => patchSection('deepseek', { useReasoningForChat: value })} />
                </CardBody>
              </Card>

              <Card>
                <CardHead title={<><span className="stg-card-icon is-pink"><Sparkles size={14} /></span>影像与音乐</>} desc="创作工坊、空间配图与自动插画的默认参数。" />
                <CardBody>
                  <div className="stg-form stg-form--2">
                    <Field label="图像模型">
                      <Select value={draft.models.minimaxImage} onChange={(event) => patchSection('models', { minimaxImage: event.target.value })}>
                        {MINIMAX_IMAGE_MODELS.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="默认画幅">
                      <Select value={draft.media.imageAspectRatio} onChange={(event) => patchSection('media', { imageAspectRatio: event.target.value })}>
                        {IMAGE_ASPECTS.map((aspect) => <option key={aspect} value={aspect}>{aspect}</option>)}
                      </Select>
                    </Field>
                    <Field label="视频画幅" hint="MiniMax-H3 文生视频必填，常用 16:9 / 9:16。">
                      <Select value={draft.media.videoAspectRatio || '16:9'} onChange={(event) => patchSection('media', { videoAspectRatio: event.target.value })}>
                        {VIDEO_ASPECTS.map((aspect) => <option key={aspect} value={aspect}>{aspect}</option>)}
                      </Select>
                    </Field>
                    <Field label="视频模型">
                      <Select value={draft.models.minimaxVideo} onChange={(event) => {
                        const next = event.target.value;
                        const caps = videoCapabilities(next);
                        patchSection('models', {
                          minimaxVideo: next,
                          minimaxVideoResolution: caps.resolutions.includes(draft.models.minimaxVideoResolution) ? draft.models.minimaxVideoResolution : caps.resolutions[0],
                          minimaxVideoDuration: caps.durations.includes(draft.models.minimaxVideoDuration) ? draft.models.minimaxVideoDuration : caps.durations[0],
                        });
                      }}>
                        {MINIMAX_VIDEO_MODELS.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="视频分辨率">
                      <Select value={draft.models.minimaxVideoResolution} onChange={(event) => patchSection('models', { minimaxVideoResolution: event.target.value })}>
                        {videoCapabilities(draft.models.minimaxVideo).resolutions.map((resolution) => <option key={resolution} value={resolution}>{resolution}</option>)}
                      </Select>
                    </Field>
                    <Field label="视频时长">
                      <Select value={String(draft.models.minimaxVideoDuration)} onChange={(event) => patchSection('models', { minimaxVideoDuration: Number(event.target.value) })}>
                        {videoCapabilities(draft.models.minimaxVideo).durations.map((duration) => <option key={duration} value={String(duration)}>{duration} 秒</option>)}
                      </Select>
                    </Field>
                    <Field label="Suno 模型">
                      <Select value={draft.models.suno} onChange={(event) => patchSection('models', { suno: event.target.value })}>
                        {SUNO_MODELS.map((model) => <option key={model} value={model}>{model}</option>)}
                      </Select>
                    </Field>
                    <NumberField label="每次出图数量" value={draft.media.imageCount} min={1} max={4} onChange={(value) => patchSection('media', { imageCount: value })} suffix="张" />
                    <NumberField label="B站兴趣抓取上限" value={draft.bilibili.fetchLimit} min={4} max={30} onChange={(value) => patchSection('bilibili', { fetchLimit: value })} suffix="条" />
                  </div>
                  <ToggleRow title="图片生成" desc="允许鲸鲸画图与自动配图。" checked={draft.media.imageEnabled} onChange={(value) => patchSection('media', { imageEnabled: value })} />
                  <ToggleRow title="视频生成" desc="文生视频通常需要数分钟。" checked={draft.media.videoEnabled} onChange={(value) => patchSection('media', { videoEnabled: value })} />
                  <ToggleRow title="音乐生成" desc="允许鲸鲸用 Suno 写歌。" checked={draft.media.musicEnabled} onChange={(value) => patchSection('media', { musicEnabled: value })} />
                  <ToggleRow title="自动优化提示词" desc="生成前先让模型把描述补全成更完整的画面提示。" checked={draft.media.promptOptimizer} onChange={(value) => patchSection('media', { promptOptimizer: value })} />
                </CardBody>
              </Card>
            </div>

            <VoiceCard settings={draft} patch={patchSection} />
          </div>
        )}

        {tab === 'permissions' && (
          <div className="stg-stack">
            <Card>
              <CardHead title={<><span className="stg-card-icon is-amber"><ShieldCheck size={14} /></span>权限等级</>} desc="鲸鲸先确认你是谁，再决定要不要回、能做什么。" />
              <CardBody>
                <div className="stg-ranks">
                  {[
                    { rank: '主人', desc: '最高权限：随时回复、可切换人设、可让她忘记记忆。', tone: 'brand' },
                    { rank: '管理员', desc: '可触发自主活动与部分设置，但不能改密钥。', tone: 'mint' },
                    { rank: '白名单', desc: '允许私聊互动；群里需要 @ 她或说唤醒词。', tone: 'default' },
                    { rank: '陌生人', desc: '默认礼貌但克制；可在下方完全关闭。', tone: 'default' },
                  ].map((item) => (
                    <div className="stg-rank" key={item.rank}>
                      <Badge tone={item.tone as 'brand' | 'mint' | 'default'}>{item.rank}</Badge>
                      <span>{item.desc}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>

            <div className="stg-grid">
              <Card>
                <CardHead title="名单" desc="支持逗号、空格或回车分隔，粘贴 QQ 号即可。" />
                <CardBody>
                  <div className="stg-form">
                    <Field label="主人 QQ" hint={mergedOwners.length ? '主人永远拥有最高权限。' : '还没有主人，建议先填写一个。'}>
                      <TagListEditor value={draft.permissions.owners} onChange={(value) => patchSection('permissions', { owners: value })} placeholder="输入主人 QQ 后回车" />
                    </Field>
                    <Field label="管理员">
                      <TagListEditor value={draft.permissions.admins} onChange={(value) => patchSection('permissions', { admins: value })} placeholder="输入管理员 QQ 后回车" />
                    </Field>
                    <Field label="私聊白名单">
                      <TagListEditor value={draft.permissions.whitelist} onChange={(value) => patchSection('permissions', { whitelist: value })} placeholder="允许私聊的 QQ" />
                    </Field>
                    <Field label="群聊模式" hint="whitelist：只有下面列出的群能聊天；off：全部群聊关闭；all：所有群都可聊天。">
                      <Select value={draft.permissions.groupChatMode ?? 'whitelist'} onChange={(event) => patchSection('permissions', { groupChatMode: event.target.value as 'off' | 'whitelist' | 'all' })}>
                        <option value="whitelist">仅白名单群</option>
                        <option value="off">关闭全部群聊</option>
                        <option value="all">全部群聊</option>
                      </Select>
                    </Field>
                    <Field label="群白名单" hint="仅群聊模式为“仅白名单群”时生效。">

                      <TagListEditor value={draft.permissions.groupWhitelist} onChange={(value) => patchSection('permissions', { groupWhitelist: value })} placeholder="允许互动的群号" />
                    </Field>
                    <Field label="黑名单" hint="黑名单里的 QQ 或群会被完全忽略。">
                      <TagListEditor value={draft.permissions.blacklist} onChange={(value) => patchSection('permissions', { blacklist: value })} placeholder="拉黑的 QQ / 群号" tone="danger" />
                    </Field>
                    <Field label="敏感词" hint="命中后不回复并记录日志。">
                      <TagListEditor value={draft.permissions.sensitiveWords} onChange={(value) => patchSection('permissions', { sensitiveWords: value })} placeholder="需要拦截的词" tone="danger" />
                    </Field>
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHead title="回复规则" desc="控制她在 QQ 里的边界感。" />
                <CardBody>
                  <ToggleRow title="允许陌生人互动" desc="关闭后只有名单里的人能收到回复。" checked={draft.permissions.allowStrangers} onChange={(value) => patchSection('permissions', { allowStrangers: value })} />
                  <ToggleRow title="群里必须 @ 她" desc="群聊需要 @ 或命中唤醒词才回复。" checked={draft.permissions.requireAtInGroup} onChange={(value) => patchSection('permissions', { requireAtInGroup: value })} />
                  <ToggleRow title="主人私聊总是回复" desc="即使群里很忙，也优先回应主人。" checked={draft.permissions.replyToOwnerAlways} onChange={(value) => patchSection('permissions', { replyToOwnerAlways: value })} />
                  <ToggleRow title="管理员可切换人设" desc="允许管理员在群里让她换人格。" checked={draft.permissions.adminCanSwitchPersona} onChange={(value) => patchSection('permissions', { adminCanSwitchPersona: value })} />
                  <ToggleRow title="管理员可让她忘记记忆" desc="允许管理员删除某条记忆事实。" checked={draft.permissions.adminCanForgetMemory} onChange={(value) => patchSection('permissions', { adminCanForgetMemory: value })} />
                </CardBody>
              </Card>
            </div>
          </div>
        )}

        {tab === 'life' && (
          <div className="stg-stack">
            <div className="callout callout--brand">
              <Sparkles size={15} className="callout__icon" />
              <span>自主生活让她不是只在被叫到时才存在：她会主动发消息、写日记、发说说、逛 B 站、学习和反思。频率越高越像活人，也越容易刷屏。</span>
            </div>
            <div className="stg-grid">
              <Card>
                <CardHead title={<><span className="stg-card-icon is-mint"><Sparkles size={14} /></span>总开关</>} desc="关闭后所有自主活动都会停下，聊天与记忆不受影响。" />
                <CardBody>
                  <ToggleRow title="开启自主生活" desc="允许鲸鲸在没有消息时自己安排时间。" checked={draft.autonomy.enabled} onChange={(value) => patchSection('autonomy', { enabled: value })} />
                  <div className="stg-form stg-form--2">
                    <NumberField label="心跳间隔" hint="自主引擎检查任务的间隔。" value={draft.autonomy.tickSeconds} min={30} max={600} step={10} onChange={(value) => patchSection('autonomy', { tickSeconds: value })} suffix="秒" />
                    <NumberField label="每日最多行动" value={draft.autonomy.maxActionsPerDay} min={0} max={60} onChange={(value) => patchSection('autonomy', { maxActionsPerDay: value })} suffix="次" />
                    <NumberField label="闲置多久后活跃" value={draft.autonomy.idleTriggerMinutes} min={15} max={1440} step={15} onChange={(value) => patchSection('autonomy', { idleTriggerMinutes: value })} suffix="分钟" />
                  </div>
                </CardBody>
              </Card>

              <Card>
                <CardHead title={<><span className="stg-card-icon is-brand"><Sparkles size={14} /></span>主动联系</>} desc="她会先开口，但会挑时间和对象。" />
                <CardBody>
                  <ToggleRow title="允许主动发消息" checked={draft.autonomy.proactiveEnabled} onChange={(value) => patchSection('autonomy', { proactiveEnabled: value })} />
                  <div className="stg-form stg-form--2">
                    <Field label="主动对象">
                      <Select value={draft.autonomy.proactiveTargets} onChange={(event) => patchSection('autonomy', { proactiveTargets: event.target.value as AppSettings['autonomy']['proactiveTargets'] })}>
                        {PROACTIVE_TARGETS.map((target) => <option key={target.value} value={target.value}>{target.label}</option>)}
                      </Select>
                    </Field>
                    <NumberField label="最小间隔" value={draft.autonomy.proactiveMinGapMinutes} min={30} max={1440} step={30} onChange={(value) => patchSection('autonomy', { proactiveMinGapMinutes: value })} suffix="分钟" />
                    <NumberField label="每日上限" value={draft.autonomy.proactiveMaxPerDay} min={0} max={12} onChange={(value) => patchSection('autonomy', { proactiveMaxPerDay: value })} suffix="次" />
                  </div>
                  <ToggleRow title="安静时段" desc="这段时间她不会主动出现。" checked={draft.autonomy.quietHoursEnabled} onChange={(value) => patchSection('autonomy', { quietHoursEnabled: value })} />
                  <div className="stg-form stg-form--2">
                    <Field label="安静开始"><Input type="time" value={draft.autonomy.quietStart} onChange={(event) => patchSection('autonomy', { quietStart: event.target.value })} /></Field>
                    <Field label="安静结束"><Input type="time" value={draft.autonomy.quietEnd} onChange={(event) => patchSection('autonomy', { quietEnd: event.target.value })} /></Field>
                  </div>
                </CardBody>
              </Card>

              <Card className="stg-span2">
                <CardHead title={<><span className="stg-card-icon is-violet"><Layers size={14} /></span>内容节奏</>} desc="每类内容各有开关与时间窗口，避免同一天重复打扰。" />
                <CardBody>
                  <div className="stg-life-grid">
                    <div className="stg-life-item">
                      <ToggleRow title="写日记" desc="睡前回顾今天。" checked={draft.autonomy.diaryEnabled} onChange={(value) => patchSection('autonomy', { diaryEnabled: value })} />
                      <NumberField label="日记时间" value={draft.autonomy.diaryHour} min={0} max={23} onChange={(value) => patchSection('autonomy', { diaryHour: value })} suffix="点" />
                    </div>
                    <div className="stg-life-item">
                      <ToggleRow title="发 QQ 空间" desc="分享心情和配图。" checked={draft.autonomy.qzoneEnabled} onChange={(value) => patchSection('autonomy', { qzoneEnabled: value })} />
                      <div className="stg-form stg-form--2">
                        <NumberField label="发布时间" value={draft.autonomy.qzoneHour} min={0} max={23} onChange={(value) => patchSection('autonomy', { qzoneHour: value })} suffix="点" />
                        <NumberField label="最小间隔" value={draft.autonomy.qzoneMinGapHours} min={1} max={72} onChange={(value) => patchSection('autonomy', { qzoneMinGapHours: value })} suffix="小时" />
                      </div>
                      <Field label="可见范围">
                        <Select value={String(draft.autonomy.qzoneVisibility)} onChange={(event) => patchSection('autonomy', { qzoneVisibility: Number(event.target.value) as 1 | 4 | 64 })}>
                          {QZONE_VISIBILITY.map((item) => <option key={item.value} value={String(item.value)}>{item.label}</option>)}
                        </Select>
                      </Field>
                    </div>
                    <div className="stg-life-item">
                      <ToggleRow title="逛 B 站" desc="按兴趣找视频并吐槽。" checked={draft.autonomy.biliEnabled} onChange={(value) => patchSection('autonomy', { biliEnabled: value })} />
                      <NumberField label="最小间隔" value={draft.autonomy.biliMinGapHours} min={1} max={72} onChange={(value) => patchSection('autonomy', { biliMinGapHours: value })} suffix="小时" />
                    </div>
                    <div className="stg-life-item">
                      <ToggleRow title="学习新东西" desc="查资料、做笔记。" checked={draft.autonomy.learnEnabled} onChange={(value) => patchSection('autonomy', { learnEnabled: value })} />
                      <NumberField label="最小间隔" value={draft.autonomy.learnMinGapHours} min={1} max={72} onChange={(value) => patchSection('autonomy', { learnMinGapHours: value })} suffix="小时" />
                    </div>
                    <div className="stg-life-item">
                      <ToggleRow title="睡前反思" desc="回看最近的表现。" checked={draft.autonomy.reflectEnabled} onChange={(value) => patchSection('autonomy', { reflectEnabled: value })} />
                      <NumberField label="反思时间" value={draft.autonomy.reflectHour} min={0} max={23} onChange={(value) => patchSection('autonomy', { reflectHour: value })} suffix="点" />
                    </div>
                  </div>
                  <div className="stg-life-note">
                    <Info size={13} />
                    <span>安静时段与每日上限会优先于各类开关；被跳过的活动会记录在「成长日记 · 活动轨迹」里。</span>
                  </div>
                </CardBody>
              </Card>
            </div>
          </div>
        )}

        {tab === 'context' && (
          <div className="stg-stack">
            <div className="stg-grid">
              <Card>
                <CardHead title={<><span className="stg-card-icon is-brand"><Database size={14} /></span>上下文与记忆</>} desc="决定她一次能记住多少、什么时候压缩记忆。" />
                <CardBody>
                  <div className="stg-form stg-form--2">
                    <NumberField label="上下文 Token 上限" value={draft.context.maxContextTokens} min={4000} max={128000} step={1000} onChange={(value) => patchSection('context', { maxContextTokens: value })} />
                    <NumberField label="保留最近消息" value={draft.context.keepRecentMessages} min={4} max={80} onChange={(value) => patchSection('context', { keepRecentMessages: value })} suffix="条" />
                    <NumberField label="记忆检索条数" value={draft.context.memoryTopK} min={1} max={30} onChange={(value) => patchSection('context', { memoryTopK: value })} suffix="条" />
                    <NumberField label="记忆 Token 上限" value={draft.context.maxMemoryTokens} min={500} max={12000} step={100} onChange={(value) => patchSection('context', { maxMemoryTokens: value })} />
                  </div>
                  <RangeField label="触发压缩的上下文占比" value={draft.context.compactAtPercent} min={40} max={95} onChange={(value) => patchSection('context', { compactAtPercent: value })} format={(value) => value + '%'} />
                  <ToggleRow title="自动抽取记忆" desc="从对话中提炼事实、偏好与承诺。" checked={draft.context.autoMemoryExtraction} onChange={(value) => patchSection('context', { autoMemoryExtraction: value })} />
                  <ToggleRow title="保留细节的压缩" desc="压缩后仍保留具体细节与原话锚点。" checked={draft.context.detailPreservingCompression} onChange={(value) => patchSection('context', { detailPreservingCompression: value })} />
                  <ToggleRow title="跨会话回忆" desc="允许她在私聊里想起你们之前的共同经历。" checked={draft.context.crossSessionRecall} onChange={(value) => patchSection('context', { crossSessionRecall: value })} />
                </CardBody>
              </Card>

              <Card>
                <CardHead title={<><span className="stg-card-icon is-amber"><ShieldCheck size={14} /></span>数据与备份</>} desc="所有数据都在本机，随时可以打包带走。" />
                <CardBody>
                  <div className="stg-datapath">
                    <div className="stg-datapath__label">数据目录</div>
                    <div className="stg-datapath__value mono" title={data?.dataDir}>{data?.dataDir || '读取中…'}</div>
                    <div className="row" style={{ marginTop: 9 }}>
                      <Button variant="secondary" size="sm" icon={<FolderOpen size={13} />} onClick={() => void api.openPath(data?.dataDir || '').catch((error) => toast.error('打开目录失败', errText(error)))}>打开目录</Button>
                      <Button variant="ghost" size="sm" icon={<Download size={13} />} loading={exporting} onClick={() => void exportBackup()}>导出备份</Button>
                    </div>
                  </div>
                  <div className="stg-data-actions">
                    <div className="stg-data-action">
                      <div><b>清除演示会话</b><span>删除内置的示例聊天，不动你自己的对话。</span></div>
                      <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} onClick={() => setClearDemoOpen(true)}>清除</Button>
                    </div>
                    <div className="stg-data-action">
                      <div><b>重新观看引导</b><span>重新走一遍首次使用流程，不会清空数据。</span></div>
                      <Button variant="ghost" size="sm" icon={<Sparkles size={13} />} onClick={() => setOnboardingOpen(true)}>开始</Button>
                    </div>
                    <div className="stg-data-action is-danger">
                      <div><b>清空所有非设置数据</b><span>删除记忆、会话、日记、说说、成长、意识、表情包、媒体与费用记录；保留密钥与全部设置、人设和音色绑定。</span></div>
                      <Button variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={() => setResetDataOpen(true)}>一键清空</Button>
                    </div>
                    <div className="stg-data-action is-danger">
                      <div><b>重置全部设置</b><span>设置与密钥回到默认值，记忆与聊天记录保留。</span></div>
                      <Button variant="danger" size="sm" icon={<RotateCcw size={13} />} onClick={() => setResetOpen(true)}>重置</Button>
                    </div>
                  </div>
                  <div className="stg-data-note">
                    <ShieldCheck size={13} />
                    <span>导出会打包整个数据目录（含记忆、日记、媒体与设置），请妥善保管。</span>
                  </div>
                </CardBody>
              </Card>
            </div>

            <Card>
              <CardHead title={<><span className="stg-card-icon is-brand"><Search size={14} /></span>联网搜索来源</>} desc="DeepSeek 官方搜索/抓取使用自研搜索引擎；Serper 作为兼容备选。" />
              <CardBody>
                <div className="stg-form stg-form--2">
                  <Field label="搜索提供方">
                    <Select value={draft.search.provider ?? 'auto'} onChange={(event) => patchSection('search', { provider: event.target.value as 'auto' | 'deepseek' | 'serper' })}>
                      <option value="auto">自动（优先 DeepSeek）</option>
                      <option value="deepseek">DeepSeek 官方搜索</option>
                      <option value="serper">Serper</option>
                    </Select>
                  </Field>
                  <NumberField label="单次结果数" value={draft.search.maxResults} min={1} max={10} onChange={(value) => patchSection('search', { maxResults: value })} suffix="条" />
                </div>
                <div className="stg-data-note"><Info size={13} /><span>DeepSeek 搜索/抓取接口：POST /v1/tools/search 与 /v1/tools/fetch；按次计费，当前参考 5 元/1000 次。</span></div>
              </CardBody>
            </Card>

            <Card>
              <CardHead title={<><span className="stg-card-icon is-pink"><ShieldCheck size={14} /></span>聊天中的高成本工具</>} desc="只限制私聊/群聊里的主动命令；鲸鲸自主写日记、刷 B 站、生成配图不受这里的限制。" />
              <CardBody>
                <ToggleRow title="启用聊天创作工具" desc="关闭后聊天里不能画图、生成视频或唱歌。" checked={draft.chatTools.enabled} onChange={(value) => patchSection('chatTools', { enabled: value })} />
                <div className="stg-form stg-form--3">
                  <NumberField label="每日画图上限" hint="0 表示不限制" value={draft.chatTools.imageDailyLimit} min={0} max={100} onChange={(value) => patchSection('chatTools', { imageDailyLimit: value })} suffix="次" />
                  <NumberField label="每日视频上限" value={draft.chatTools.videoDailyLimit} min={0} max={50} onChange={(value) => patchSection('chatTools', { videoDailyLimit: value })} suffix="次" />
                  <NumberField label="每日唱歌上限" value={draft.chatTools.musicDailyLimit} min={0} max={100} onChange={(value) => patchSection('chatTools', { musicDailyLimit: value })} suffix="次" />
                  <NumberField label="冷却时间" value={draft.chatTools.cooldownSeconds} min={0} max={600} onChange={(value) => patchSection('chatTools', { cooldownSeconds: value })} suffix="秒" />
                </div>
                <div className="stg-form stg-form--2">
                  <ToggleRow title="聊天画图" checked={draft.chatTools.imageEnabled} onChange={(value) => patchSection('chatTools', { imageEnabled: value })} />
                  <ToggleRow title="聊天视频" checked={draft.chatTools.videoEnabled} onChange={(value) => patchSection('chatTools', { videoEnabled: value })} />
                  <ToggleRow title="聊天唱歌" checked={draft.chatTools.musicEnabled} onChange={(value) => patchSection('chatTools', { musicEnabled: value })} />
                </div>
                <div className="stg-form stg-form--2">
                  {(['owner', 'admin', 'whitelist', 'guest'] as const).map((role) => (
                    <label className="stg-switch" key={role}>
                      <Toggle
                        checked={draft.chatTools.allowedRoles.includes(role)}
                        onChange={(checked) => patchSection('chatTools', { allowedRoles: checked ? [...draft.chatTools.allowedRoles, role] : draft.chatTools.allowedRoles.filter((item) => item !== role) })}
                        label={'允许' + ({ owner: '主人', admin: '管理员', whitelist: '白名单', guest: '普通群友' }[role])}
                      />
                      <span>允许 {({ owner: '主人', admin: '管理员', whitelist: '白名单', guest: '普通群友' }[role])}</span>
                    </label>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>
        )}

        {tab === 'about' && (
          <div className="stg-stack">
            <Card className="stg-about-hero">
              <div className="stg-about-hero__glow" />
              <div className="stg-about-hero__main">
                <div className="stg-about-hero__logo">🐋</div>
                <div>
                  <div className="stg-about-hero__eyebrow">JINGJING · QQ COMPANION</div>
                  <h2>鲸鲸 · QQ 智能伙伴</h2>
                  <p>一个会记得、会成长、会自己生活的 DeepSeek 桌面伙伴，把长期记忆、QQ 通道与多模态创作放进同一片深海。</p>
                  <div className="stg-about-hero__meta">
                    <Badge tone="brand">v{data?.version ?? '1.0.0'}</Badge>
                    {info && <Badge>Electron {info.electron}</Badge>}
                    {info && <Badge>{info.platform === 'win32' ? 'Windows' : info.platform === 'darwin' ? 'macOS' : info.platform}</Badge>}
                    <Badge tone="mint">本地优先</Badge>
                  </div>
                </div>
              </div>
            </Card>

            <div className="stg-grid">
              <Card>
                <CardHead title={<><span className="stg-card-icon is-brand"><Info size={14} /></span>运行环境</>} desc="来自主进程的真实版本信息。" extra={<Button variant="ghost" size="sm" icon={<RefreshCw size={12} />} loading={infoLoading} onClick={() => void loadInfo()}>刷新</Button>} />
                <CardBody>
                  {infoError ? (
                    <div className="stg-inline-error">{infoError}<Button variant="ghost" size="sm" onClick={() => void loadInfo()}>重试</Button></div>
                  ) : infoLoading || !info ? (
                    <Spinner label="读取运行环境" />
                  ) : (
                    <div className="stg-kv">
                      <div><span>应用版本</span><b>{info.version}</b></div>
                      <div><span>Electron</span><b>{info.electron}</b></div>
                      <div><span>平台</span><b>{info.platform}</b></div>
                      <div><span>数据目录</span><b className="mono" title={info.dataDir}>{info.dataDir}</b></div>
                      <div><span>日志文件</span><b className="mono" title={info.logFile}>{info.logFile}</b></div>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHead title={<><span className="stg-card-icon is-violet"><Layers size={14} /></span>技术栈</>} desc="为桌面陪伴场景挑选的一套轻量组合。" />
                <CardBody>
                  <div className="stg-stack-chips">
                    {['Electron 38', 'React 19', 'TypeScript', 'Vite 6', 'DeepSeek', 'NapCat / OneBot', 'BreezeBlue TTS', 'MiniMax', 'Suno'].map((item) => <span className="stg-chip" key={item}>{item}</span>)}
                  </div>
                  <div className="stg-links">
                    {[
                      { label: 'DeepSeek 平台', url: 'https://platform.deepseek.com/' },
                      { label: 'NapCat 文档', url: 'https://napneko.github.io/' },
                      { label: 'BreezeBlue 文档', url: 'https://docs.breezeblue.ai/' },
                      { label: 'Suno API 文档', url: 'https://docs.sunoapi.org/' },
                    ].map((link) => (
                      <button type="button" key={link.url} className="stg-link" onClick={() => void api.openExternal(link.url).catch((error) => toast.error('打开链接失败', errText(error)))}>
                        {link.label}<ExternalLink size={12} />
                      </button>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </div>

            <div className="stg-grid">
              <Card>
                <CardHead title={<><span className="stg-card-icon is-mint"><ShieldCheck size={14} /></span>隐私</>} desc="你的对话、记忆和密钥都不会离开这台电脑。" />
                <CardBody>
                  <ul className="stg-list">
                    <li>记忆以 Markdown 存放在本机数据目录，每个联系人与群聊独立成册。</li>
                    <li>第三方密钥经系统安全存储加密；界面只显示「是否已配置」。</li>
                    <li>仅在你触发的对话、创作、搜索与 B 站发现时访问对应 API。</li>
                    <li>没有遥测，不上传聊天记录、不训练模型、不向第三方转发记忆。</li>
                  </ul>
                </CardBody>
              </Card>

              <Card>
                <CardHead title={<><span className="stg-card-icon is-amber"><AlertTriangle size={14} /></span>合规提示</>} desc="使用 QQ 自动化与第三方服务前请知悉。" />
                <CardBody>
                  <ul className="stg-list">
                    <li>NapCat / OneBot 属于非官方 QQ 协议端，存在账号风控与封禁风险，请使用小号或自行评估。</li>
                    <li>请遵守 DeepSeek、BreezeBlue、MiniMax、Suno、Serper 的服务条款与配额限制。</li>
                    <li>生成的图片、视频、音乐与文本由对应模型产生，发布前请自行审核内容。</li>
                    <li>鲸鲸是角色化陪伴产品，不冒充真人，也不应被用于违法、伤害或欺骗性用途。</li>
                  </ul>
                </CardBody>
              </Card>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={clearDemoOpen}
        onClose={() => { if (!clearingDemo) setClearDemoOpen(false); }}
        title="清除演示会话？"
        desc="只会删除内置的示例聊天，你自己的对话、记忆与日记不会被动。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setClearDemoOpen(false)} disabled={clearingDemo}>取消</Button>
            <Button variant="primary" loading={clearingDemo} onClick={() => void clearDemo()}>确认清除</Button>
          </>
        )}
      >
        <div className="callout callout--brand"><Info size={15} className="callout__icon" /><span>适合理清界面后再开始和鲸鲸真正聊天。</span></div>
      </Modal>

      <Modal
        open={resetDataOpen}
        onClose={() => { if (!resettingData) setResetDataOpen(false); }}
        title="清空所有非设置数据？"
        desc="会删除全部记忆、会话、日记、说说、成长、意识、表情包、媒体与费用记录，把鲸鲸恢复成全新状态。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setResetDataOpen(false)} disabled={resettingData}>取消</Button>
            <Button variant="danger" loading={resettingData} icon={<Trash2 size={14} />} onClick={() => void resetUserData()}>确认清空并重启</Button>
          </>
        )}
      >
        <div className="callout callout--warning">
          <AlertTriangle size={15} className="callout__icon" />
          <span>会保留：API 密钥、模型/参数设置、人设定义、每个人设绑定的音色、NapCat 安装与登录配置。此操作不可撤销，应用会自动重启。</span>
        </div>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={() => { if (!resetting) setResetOpen(false); }}
        title="重置全部设置？"
        desc="设置与密钥会恢复为出厂默认值，记忆、日记与聊天记录保留。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={resetting}>取消</Button>
            <Button variant="danger" loading={resetting} icon={<RotateCcw size={14} />} onClick={() => void resetSettings()}>确认重置</Button>
          </>
        )}
      >
        <div className="callout callout--warning">
          <AlertTriangle size={15} className="callout__icon" />
          <span>重置后需要重新填写 API 密钥，并重新选择人设与声音。此操作不可撤销。</span>
        </div>
      </Modal>
    </>
  );
}
