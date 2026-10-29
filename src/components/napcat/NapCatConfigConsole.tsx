import React from 'react';
import {
  AlertTriangle, CheckCircle2, Clock, Cpu, Download, Eye, EyeOff, FolderOpen, HardDrive, KeyRound,
  Loader2, Lock, Network, PlugZap, RefreshCw, RotateCcw, Save, Server, ShieldCheck, SlidersHorizontal,
  Terminal, Wrench, XCircle, Zap,
} from 'lucide-react';
import type { AppSettings, NapCatDiagnostics, NapCatInstallResult, NapCatLogLine, NapCatStatus } from '@shared/types';
import { useApp } from '@/app/AppProvider';
import { api } from '@/lib/api';
import {
  Badge, Button, Card, CardBody, CardHead, Field, IconButton, Input, Segmented, SettingRow, Tabs, Textarea, Toggle, cn, useToast,
} from '@/components/ui';
import { errMessage, splitWords } from './utils';

type ConfigTab = 'connection' | 'behavior' | 'diagnostics' | 'install';
type NapCatConfig = AppSettings['napcat'];

interface NapCatConfigProps {
  config: NapCatConfig;
  status: NapCatStatus;
  installing: boolean;
  installResult: NapCatInstallResult | null;
  appendLocal: (text: string, level?: NapCatLogLine['level']) => void;
  onSaved: (status: NapCatStatus, config: NapCatConfig) => void;
  onRefreshStatus: () => Promise<void>;
  onInstall: (method: 'onekey' | 'existing', installDir?: string) => Promise<void>;
}

const TABS: { value: ConfigTab; label: string }[] = [
  { value: 'connection', label: '连接' },
  { value: 'behavior', label: '行为' },
  { value: 'diagnostics', label: '诊断' },
  { value: 'install', label: '安装引导' },
];

export function NapCatConfigConsole(props: NapCatConfigProps) {
  const { config, status, installing, installResult, appendLocal, onSaved, onRefreshStatus, onInstall } = props;
  const { setSettings } = useApp();
  const toast = useToast();
  const [tab, setTab] = React.useState<ConfigTab>('connection');
  const [draft, setDraft] = React.useState<NapCatConfig>(config);
  const [groupText, setGroupText] = React.useState((config.groupWakeWords ?? []).join('\n'));
  const [privateText, setPrivateText] = React.useState((config.privateWakeWords ?? []).join('\n'));
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [hiding, setHiding] = React.useState(false);
  const [showToken, setShowToken] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState<NapCatDiagnostics | null>(null);
  const [diagLoading, setDiagLoading] = React.useState(false);
  const [diagError, setDiagError] = React.useState<string | null>(null);

  const dirty = React.useMemo(() => JSON.stringify(draft) !== JSON.stringify(config), [draft, config]);

  React.useEffect(() => {
    if (dirty) return;
    setDraft(config);
    setGroupText((config.groupWakeWords ?? []).join('\n'));
    setPrivateText((config.privateWakeWords ?? []).join('\n'));
  }, [config, dirty]);

  function set<K extends keyof NapCatConfig>(key: K, value: NapCatConfig[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const formError = React.useMemo(() => {
    if (draft.replyDelayMinMs < 0 || draft.replyDelayMaxMs < 0) return '回复延迟不能为负数';
    if (draft.replyDelayMinMs > draft.replyDelayMaxMs) return '回复延迟最小值不能大于最大值';
    if (draft.autoHideDelayMs < 0 || draft.autoHideDelayMs > 10000) return '隐藏窗口延迟需在 0 ~ 10000 毫秒之间';
    if (draft.reverseWsPort < 1 || draft.reverseWsPort > 65535) return '反向 WebSocket 端口需在 1 ~ 65535 之间';
    if (draft.maxRepliesPerMinute < 1) return '每分钟回复上限至少为 1';
    return null;
  }, [draft]);

  const save = async () => {
    if (formError) { toast.error('配置有误', formError); return; }
    if (saving) return;
    setSaving(true);
    try {
      const next: NapCatConfig = {
        ...draft,
        groupWakeWords: splitWords(groupText),
        privateWakeWords: splitWords(privateText),
      };
      const nextStatus = await api.napcat.save(next);
      setSettings((prev) => ({ ...prev, napcat: next }));
      onSaved(nextStatus, next);
      appendLocal(`配置已保存：运行模式 ${next.mode === 'embedded' ? '完全内嵌' : '连接外部'}，OneBot HTTP ${next.oneBotHttpUrl}`, 'info');
      toast.success('NapCat 配置已保存', '已写入本地配置，部分参数将在重启后生效');
      try {
        const snapshot = await api.settings.get();
        setSettings(snapshot.settings);
      } catch {
        /* 上面的本地更新已保证界面与保存值一致 */
      }
    } catch (error) {
      appendLocal(`保存配置失败：${errMessage(error)}`, 'error');
      toast.error('保存失败', errMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setDraft(config);
    setGroupText((config.groupWakeWords ?? []).join('\n'));
    setPrivateText((config.privateWakeWords ?? []).join('\n'));
    toast.info('已撤销未保存的修改');
  };

  const testConnection = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const result = await api.integrations.test('napcat');
      if (result.ok) toast.success('NapCat 连接正常', result.latencyMs !== undefined ? `延迟 ${result.latencyMs} ms` : result.message);
      else toast.error('NapCat 连接失败', result.message);
    } catch (error) {
      toast.error('连接测试失败', errMessage(error));
    } finally {
      setTesting(false);
    }
  };

  const openInstallDir = async () => {
    const target = draft.installDir.trim() || status.installDir;
    if (!target) { toast.warning('尚未填写安装目录'); return; }
    try {
      await api.openPath(target);
    } catch (error) {
      toast.error('无法打开安装目录', errMessage(error));
    }
  };

  const loadDiagnostics = async () => {
    if (diagLoading) return;
    setDiagLoading(true);
    setDiagError(null);
    try {
      const result = await api.napcat.diagnostics();
      setDiagnostics(result);
    } catch (error) {
      setDiagError(errMessage(error));
    } finally {
      setDiagLoading(false);
    }
  };

  React.useEffect(() => {
    if (tab === 'diagnostics' && !diagnostics && !diagLoading) void loadDiagnostics();
  }, [tab]);

  const hideWindows = async () => {
    if (hiding) return;
    setHiding(true);
    try {
      const result = await api.napcat.hideWindows();
      toast.success('已隐藏 QQ 窗口', `共处理 ${result.hidden} 个窗口`);
      appendLocal(`已隐藏 ${result.hidden} 个 QQ 窗口`, 'info');
      await onRefreshStatus();
      if (diagnostics) void loadDiagnostics();
    } catch (error) {
      toast.error('隐藏窗口失败', errMessage(error));
    } finally {
      setHiding(false);
    }
  };

  return (
    <Card className="nc-card nc-config">
      <CardHead
        title="NapCat 配置"
        desc="连接参数、行为策略、诊断与安装引导"
        icon={<SlidersHorizontal size={16} />}
        extra={<Tabs value={tab} onChange={setTab} items={TABS} />}
      />
      <CardBody className="nc-config__body">
        {tab === 'connection' && (
          <div className="nc-form-section">
            <div className="nc-form-card">
              <div className="nc-form-card__title"><Server size={14} />运行方式</div>
              <div className="form-row">
                <Field label="运行模式" hint="完全内嵌由鲸鲸托管 NapCat；连接外部则复用已在运行的实例">
                  <Segmented
                    value={draft.mode}
                    onChange={(value) => set('mode', value)}
                    items={[{ value: 'embedded', label: '完全内嵌' }, { value: 'external', label: '连接外部' }]}
                  />
                </Field>
                <Field label="机器人 QQ 号" hint="用于展示与权限校验，不改变协议端登录账号">
                  <Input value={draft.botUin} onChange={(event) => set('botUin', event.target.value)} placeholder="例如 10001" />
                </Field>
                <Field label="NapCat 安装目录" hint="内核与配置所在目录，由鲸鲸统一托管">
                  <div className="input-group">
                    <Input value={draft.installDir} onChange={(event) => set('installDir', event.target.value)} placeholder="例如 D:\NapCat" />
                    <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => void openInstallDir()}>打开</Button>
                  </div>
                </Field>
                <Field label="QQ 安装路径" hint="NapCat 需要本机已安装的 QQ NT 客户端">
                  <Input value={draft.qqPath} onChange={(event) => set('qqPath', event.target.value)} placeholder="例如 C:\Program Files\Tencent\QQNT" />
                </Field>
              </div>
            </div>

            <div className="nc-form-card">
              <div className="nc-form-card__title"><Network size={14} />OneBot 与 WebUI</div>
              <div className="form-row">
                <Field label="OneBot HTTP" hint="鲸鲸通过此地址发送消息">
                  <Input value={draft.oneBotHttpUrl} onChange={(event) => set('oneBotHttpUrl', event.target.value)} placeholder="http://127.0.0.1:3000" />
                </Field>
                <Field label="OneBot WebSocket">
                  <Input value={draft.oneBotWsUrl} onChange={(event) => set('oneBotWsUrl', event.target.value)} placeholder="ws://127.0.0.1:3001" />
                </Field>
                <Field label="反向 WS 端口" hint="NapCat 向鲸鲸推送事件的本地端口">
                  <Input type="number" value={draft.reverseWsPort} onChange={(event) => set('reverseWsPort', Number(event.target.value))} />
                </Field>
                <Field label="WebUI 地址" hint="内置 WebUI 在本机提供的管理地址">
                  <Input value={draft.webuiUrl} onChange={(event) => set('webuiUrl', event.target.value)} placeholder="http://127.0.0.1:6099/webui" />
                </Field>
                <Field label="WebUI Token" hint="保存在本地，用于免登录打开内置 WebUI">
                  <div className="input-group">
                    <Input type={showToken ? 'text' : 'password'} value={draft.webuiToken} onChange={(event) => set('webuiToken', event.target.value)} placeholder="NapCat WebUI 访问令牌" autoComplete="off" />
                    <IconButton label={showToken ? '隐藏 Token' : '显示 Token'} onClick={() => setShowToken((value) => !value)}>
                      {showToken ? <EyeOff size={15} /> : <Eye size={15} />}
                    </IconButton>
                  </div>
                </Field>
              </div>
              <div className="nc-form-actions">
                <Button variant="ghost" size="sm" icon={<PlugZap size={13} />} loading={testing} onClick={() => void testConnection()}>测试 OneBot 连接</Button>
                <Button variant="ghost" size="sm" icon={<FolderOpen size={13} />} onClick={() => void openInstallDir()}>打开安装目录</Button>
              </div>
            </div>

            <SaveBar dirty={dirty} saving={saving} error={formError} onSave={save} onReset={reset} />
          </div>
        )}

        {tab === 'behavior' && (
          <div className="nc-form-section">
            <div className="nc-form-card">
              <div className="nc-form-card__title"><Zap size={14} />启动与登录</div>
              <SettingRow title="启用 NapCat 插件" desc="关闭后鲸鲸不会连接 QQ，但仍保留页面与配置">
                <Toggle checked={draft.enabled} onChange={(value) => set('enabled', value)} label="启用 NapCat 插件" />
              </SettingRow>
              <SettingRow title="随鲸鲸自动启动" desc="启动软件时自动拉起 NapCat 进程">
                <Toggle checked={draft.autoStart} onChange={(value) => set('autoStart', value)} label="自动启动" />
              </SettingRow>
              <SettingRow title="自动登录" desc="使用上一次的登录态，尽量免扫码进入">
                <Toggle checked={draft.autoLogin} onChange={(value) => set('autoLogin', value)} label="自动登录" />
              </SettingRow>
              <SettingRow title="允许桌面代发 QQ" desc="关闭时 QQ 会话只读，避免在软件里误把消息发给 QQ 联系人；本地演示会话不受影响">
                <Toggle checked={draft.allowDesktopSendToQq ?? false} onChange={(value) => set('allowDesktopSendToQq', value)} label="允许桌面代发 QQ" />
              </SettingRow>
              <SettingRow title="隐藏 QQ 窗口" desc="登录与运行期间自动隐藏 QQ 原生窗口，避免打扰">
                <Toggle checked={draft.hideQQWindows} onChange={(value) => set('hideQQWindows', value)} label="隐藏 QQ 窗口" />
              </SettingRow>
              <SettingRow title="异常自动重启" desc="NapCat 意外退出时自动拉起，保持 QQ 在线">
                <Toggle checked={draft.autoRestart} onChange={(value) => set('autoRestart', value)} label="自动重启" />
              </SettingRow>
              <SettingRow title="离线演示模式" desc="QQ 不可用时仅在前端模拟消息，不发送真实 QQ 消息">
                <Toggle checked={draft.emulateWhenOffline} onChange={(value) => set('emulateWhenOffline', value)} label="离线演示" />
              </SettingRow>
            </div>

            <div className="nc-form-card">
              <div className="nc-form-card__title"><Clock size={14} />消息行为</div>
              <div className="form-row">
                <Field label="消息前缀" hint="拼接在鲸鲸回复前的文本，可留空">
                  <Input value={draft.messagePrefix} onChange={(event) => set('messagePrefix', event.target.value)} placeholder="例如 (鲸鲸)" />
                </Field>
                <Field label="回复延迟下限 (ms)" hint="模拟真人打字节奏">
                  <Input type="number" value={draft.replyDelayMinMs} onChange={(event) => set('replyDelayMinMs', Number(event.target.value))} />
                </Field>
                <Field label="回复延迟上限 (ms)">
                  <Input type="number" value={draft.replyDelayMaxMs} onChange={(event) => set('replyDelayMaxMs', Number(event.target.value))} />
                </Field>
                <Field label="每分钟回复上限" hint="防止刷屏与风控">
                  <Input type="number" value={draft.maxRepliesPerMinute} onChange={(event) => set('maxRepliesPerMinute', Number(event.target.value))} />
                </Field>
                <Field label="隐藏窗口延迟 (ms)" hint="QQ 登录窗出现后多久自动隐藏">
                  <Input type="number" value={draft.autoHideDelayMs} onChange={(event) => set('autoHideDelayMs', Number(event.target.value))} />
                </Field>
              </div>
              <SettingRow title="拆分多条回复" desc="长回复按句拆成多条发送，更像真人聊天">
                <Toggle checked={draft.splitReplies} onChange={(value) => set('splitReplies', value)} label="拆分回复" />
              </SettingRow>
            </div>

            <div className="nc-form-card">
              <div className="nc-form-card__title"><KeyRound size={14} />唤醒词</div>
              <div className="form-row">
                <Field label="群聊唤醒词" hint="每行一个；群聊中被 @ 或包含唤醒词时才回复">
                  <Textarea
                    rows={4}
                    value={groupText}
                    onChange={(event) => { setGroupText(event.target.value); set('groupWakeWords', splitWords(event.target.value)); }}
                    placeholder={'鲸鲸\n鲸宝\n小鲸鱼'}
                  />
                </Field>
                <Field label="私聊唤醒词" hint="留空表示私聊消息全部触发回复">
                  <Textarea
                    rows={4}
                    value={privateText}
                    onChange={(event) => { setPrivateText(event.target.value); set('privateWakeWords', splitWords(event.target.value)); }}
                    placeholder={'鲸鲸\n在吗'}
                  />
                </Field>
              </div>
            </div>

            <SaveBar dirty={dirty} saving={saving} error={formError} onSave={save} onReset={reset} />
          </div>
        )}

        {tab === 'diagnostics' && (
          <div className="nc-diag">
            <div className="nc-diag__toolbar">
              <div className="nc-diag__summary">
                <span className="nc-diag__pill"><HardDrive size={12} />{diagnostics ? `${diagnostics.files.filter((file) => file.exists).length}/${diagnostics.files.length} 项文件` : '文件待检查'}</span>
                <span className="nc-diag__pill"><Server size={12} />{diagnostics ? `${diagnostics.ports.filter((port) => port.listening).length}/${diagnostics.ports.length} 个端口` : '端口待检查'}</span>
                <span className="nc-diag__pill"><Cpu size={12} />{diagnostics ? `${diagnostics.qqProcesses.length} 个 QQ 进程` : '进程待检查'}</span>
              </div>
              <div className="row no-wrap">
                <Button size="sm" variant="ghost" icon={<RefreshCw size={13} className={diagLoading ? 'spin' : undefined} />} onClick={() => void loadDiagnostics()} disabled={diagLoading}>刷新诊断</Button>
                <Button size="sm" variant="secondary" icon={<ShieldCheck size={13} />} loading={hiding} onClick={() => void hideWindows()}>隐藏 QQ 窗口</Button>
              </div>
            </div>

            {diagError && (
              <div className="nc-error-note">
                <span className="nc-error-note__title">诊断失败</span>
                <span className="nc-error-note__text">{diagError}</span>
                <Button size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => void loadDiagnostics()}>重试</Button>
              </div>
            )}

            {diagLoading && !diagnostics && (
              <div className="nc-diag__loading"><Loader2 size={16} className="spin" />正在检查关键文件、端口与 QQ 进程…</div>
            )}

            {diagnostics && (
              <div className="nc-diag__grid">
                <div className="nc-diag__box">
                  <h4><HardDrive size={13} />关键文件</h4>
                  {diagnostics.files.length ? diagnostics.files.map((file) => (
                    <div key={file.path} className={cn('nc-diag__file', file.exists && 'nc-diag__file--ok')}>
                      <span className="nc-diag__mark">{file.exists ? <CheckCircle2 size={14} /> : <XCircle size={14} />}</span>
                      <div className="nc-diag__file-text">
                        <div className="nc-diag__file-label">{file.label}</div>
                        <div className="nc-diag__file-path mono" title={file.path}>{file.path}</div>
                      </div>
                      <Badge tone={file.exists ? 'success' : 'danger'}>{file.exists ? '存在' : '缺失'}</Badge>
                    </div>
                  )) : <div className="nc-diag__empty">没有可检查的文件</div>}
                </div>

                <div className="nc-diag__box">
                  <h4><Server size={13} />端口占用</h4>
                  {diagnostics.ports.length ? diagnostics.ports.map((port) => (
                    <div key={`${port.name}-${port.port}`} className="nc-diag__row">
                      <span className="nc-diag__row-label">{port.name}</span>
                      <span className="mono nc-diag__row-value">{port.port}</span>
                      <Badge tone={port.listening ? 'success' : 'default'} dot={port.listening}>{port.listening ? '监听中' : '未监听'}</Badge>
                    </div>
                  )) : <div className="nc-diag__empty">没有需要检查的端口</div>}
                </div>

                <div className="nc-diag__box">
                  <h4><Cpu size={13} />QQ 进程</h4>
                  {diagnostics.qqProcesses.length ? diagnostics.qqProcesses.map((process) => (
                    <div key={process.pid} className="nc-diag__row">
                      <span className="nc-diag__row-label truncate" title={process.title || process.name}>{process.name}</span>
                      <span className="mono nc-diag__row-value">PID {process.pid}</span>
                      {process.hidden && <Badge tone="brand">已隐藏</Badge>}
                    </div>
                  )) : <div className="nc-diag__empty">未检测到 QQ 进程</div>}
                </div>
              </div>
            )}

            {diagnostics?.recommendations?.length ? (
              <div className="nc-diag__tips">
                <h4><AlertTriangle size={13} />诊断建议</h4>
                {diagnostics.recommendations.map((item, index) => (
                  <div key={index} className="nc-diag__tip"><Wrench size={13} /><span>{item}</span></div>
                ))}
              </div>
            ) : null}
          </div>
        )}

        {tab === 'install' && (
          <div className="nc-install">
            <div className={cn('nc-install__hero', status.installed && 'nc-install__hero--ok')}>
              <div className="nc-install__icon">{status.installed ? <CheckCircle2 size={24} /> : <Download size={24} />}</div>
              <div className="flex-1">
                <h3>{status.installed ? 'NapCat 已就绪' : '一键安装 NapCat 内核'}</h3>
                <p>
                  {status.installed
                    ? `当前版本 ${status.version ?? '未知'} · 安装目录 ${status.installDir || draft.installDir || '未记录'}`
                    : '自动下载官方内核、写入 OneBot 与 WebUI 配置，并托管到鲸鲸进程中。'}
                </p>
              </div>
              <Button variant="primary" size="lg" icon={<Download size={15} />} loading={installing} disabled={installing} onClick={() => void onInstall('onekey')}>
                {status.installed ? '重新安装 / 修复' : '一键安装'}
              </Button>
            </div>

            <div className="nc-install__steps">
              <div className="nc-step"><span className="nc-step__num">01</span><b>下载内核</b><p>下载 NapCat 官方发布包并解压到安装目录，不写入系统全局。</p></div>
              <div className="nc-step"><span className="nc-step__num">02</span><b>启动 QQ</b><p>以隐藏窗口方式拉起本机 QQ NT，登录窗口不会另外弹出到桌面。</p></div>
              <div className="nc-step"><span className="nc-step__num">03</span><b>扫码回传</b><p>二维码被截取并回传到本页登录卡片，扫码完成即建立 OneBot 连接。</p></div>
            </div>

            <div className="nc-install__existing">
              <div className="nc-install__existing-info">
                <div className="nc-install__existing-title"><FolderOpen size={14} />使用已有 NapCat 安装</div>
                <p>已经手动安装过 NapCat？填写目录后直接接入，不会重复下载。</p>
              </div>
              <div className="nc-install__existing-row">
                <Input value={draft.installDir} onChange={(event) => set('installDir', event.target.value)} placeholder="已有 NapCat 安装目录" />
                <Button variant="secondary" size="sm" icon={<PlugZap size={13} />} loading={installing} disabled={!draft.installDir.trim()} onClick={() => void onInstall('existing', draft.installDir.trim())}>接入已有安装</Button>
              </div>
            </div>

            {installResult && (
              <div className="nc-install__log">
                <div className="nc-install__log-head">
                  <Terminal size={13} />安装输出
                  <Badge tone={installResult.ok ? 'success' : 'danger'}>{installResult.ok ? '完成' : '失败'}</Badge>
                  <span className="spacer" />
                  <span className="dim text-xs">{installResult.message}</span>
                </div>
                <pre>{installResult.log?.length ? installResult.log.join('\n') : installResult.message}</pre>
              </div>
            )}

            <div className="callout callout--warning nc-install__compliance">
              <AlertTriangle size={16} className="callout__icon" />
              <div>
                <b>合规与风险说明</b>
                <p>NapCat 是第三方 QQ 协议端，不属于腾讯官方产品。使用协议端登录存在账号风控风险，建议使用专用小号；请遵守腾讯服务条款与当地法律法规，不要用于自动化骚扰、刷屏或任何违规用途。鲸鲸只在本机托管该进程，不收集、不上传你的 QQ 账号信息。</p>
              </div>
            </div>
            <div className="nc-install__note"><Lock size={13} />安装与登录全程在本窗口完成：不会打开外部控制台，也不会残留独立安装窗口。</div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function SaveBar({ dirty, saving, error, onSave, onReset }: { dirty: boolean; saving: boolean; error: string | null; onSave: () => Promise<void>; onReset: () => void }) {
  return (
    <div className="nc-savebar">
      <div className="nc-savebar__hint">
        {error ? (
          <span className="nc-danger-note"><AlertTriangle size={12} />{error}</span>
        ) : dirty ? (
          <><span className="nc-savebar__dot" /><span>有未保存的修改</span></>
        ) : (
          <><CheckCircle2 size={12} /><span>配置与已保存的值一致</span></>
        )}
      </div>
      <span className="spacer" />
      <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={onReset} disabled={!dirty || saving}>撤销修改</Button>
      <Button variant="primary" size="sm" icon={<Save size={13} />} loading={saving} disabled={!dirty || !!error} onClick={() => void onSave()}>保存配置</Button>
    </div>
  );
}
