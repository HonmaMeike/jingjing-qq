import React from 'react';
import { Lock, RefreshCw, ShieldCheck, TerminalSquare } from 'lucide-react';
import type { NapCatInstallResult, NapCatLogLine, NapCatStatus } from '@shared/types';
import { useApp } from '@/app/AppProvider';
import { api, events } from '@/lib/api';
import { Badge, Button, PageHeader, useToast } from '@/components/ui';
import { StatusHero } from '@/components/napcat/StatusHero';
import { LoginPanel } from '@/components/napcat/LoginPanel';
import { WebUiCard } from '@/components/napcat/WebUiCard';
import { ConsolePanel } from '@/components/napcat/ConsolePanel';
import { NapCatConfigConsole } from '@/components/napcat/NapCatConfigConsole';
import { type NapCatAction, errMessage, napcatMeta } from '@/components/napcat/utils';
import '../styles/napcat.css';

export default function NapCatPage() {
  const { napcat: status, settings, setNapcat } = useApp();
  const toast = useToast();

  const [logs, setLogs] = React.useState<NapCatLogLine[]>([]);
  const [logConnected, setLogConnected] = React.useState(false);
  const [action, setAction] = React.useState<NapCatAction | null>(null);
  const [sending, setSending] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [qr, setQr] = React.useState<string | undefined>(status.qrCodeDataUrl);
  const [qrPath, setQrPath] = React.useState<string | undefined>(status.loginQrPath);
  const [installResult, setInstallResult] = React.useState<NapCatInstallResult | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  const lastServerId = React.useRef(0);
  const clearedUpTo = React.useRef(-1);
  const localSeq = React.useRef(-1);

  const appendLocal = React.useCallback((text: string, level: NapCatLogLine['level'] = 'info') => {
    const line: NapCatLogLine = {
      id: localSeq.current--,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level,
      text,
    };
    setLogs((prev) => [...prev, line]);
  }, []);

  const mergeServerLogs = React.useCallback((incoming: NapCatLogLine[]) => {
    for (const line of incoming) lastServerId.current = Math.max(lastServerId.current, line.id);
    setLogs((prev) => {
      const seen = new Set(prev.map((line) => line.id));
      const fresh = incoming
        .filter((line) => !seen.has(line.id) && line.id > clearedUpTo.current)
        .sort((a, b) => a.id - b.id);
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  const appendServerLine = React.useCallback((line: NapCatLogLine) => {
    lastServerId.current = Math.max(lastServerId.current, line.id);
    setLogConnected(true);
    if (line.id <= clearedUpTo.current) return;
    setLogs((prev) => (prev.some((item) => item.id === line.id) ? prev : [...prev, line]));
  }, []);

  const clearLogs = React.useCallback(() => {
    clearedUpTo.current = lastServerId.current;
    setLogs([{
      id: localSeq.current--,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
      level: 'debug',
      text: '控制台已清屏',
    }]);
    void api.napcat.command('clear').catch(() => undefined);
  }, []);

  const pullStatus = React.useCallback(async (): Promise<void> => {
    try {
      const next = await api.napcat.status();
      setNapcat(next);
    } catch {
      /* 状态拉取失败时保持旧值，避免闪烁 */
    }
  }, [setNapcat]);

  /* 日志轮询：每 3 秒补齐一次，事件流负责实时追加 */
  React.useEffect(() => {
    let cancelled = false;
    const fetchLogs = async () => {
      try {
        const list = await api.napcat.logs(400);
        if (cancelled) return;
        mergeServerLogs(list);
        setLogConnected(true);
      } catch {
        if (!cancelled) setLogConnected(false);
      }
    };
    void fetchLogs();
    const timer = setInterval(() => { void fetchLogs(); }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [mergeServerLogs]);

  /* 状态轮询：每 5 秒兜底；napcat:status 事件到达时立即更新 */
  React.useEffect(() => {
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const next = await api.napcat.status();
        if (!cancelled) setNapcat(next);
      } catch {
        /* 保底轮询失败不打扰用户 */
      }
    }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [setNapcat]);

  /* 运行时长每秒刷新 */
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* NapCat 事件：日志、状态、二维码 */
  React.useEffect(() => {
    const unsubscribe = [
      events.on('napcat:log', appendServerLine),
      events.on('napcat:status', (next) => {
        setNapcat(next);
        if (next.qqOnline) { setQr(undefined); setQrPath(undefined); }
      }),
      events.on('napcat:qr', (payload) => {
        setQr(payload.dataUrl);
        setQrPath(payload.path);
      }),
    ];
    return () => unsubscribe.forEach((off) => off());
  }, [appendServerLine, setNapcat]);

  /* 二维码实时刷新：等待扫码/运行未登录时每 4 秒拉取一次 */
  React.useEffect(() => {
    const shouldPoll = status.kind === 'waiting-login' || (status.kind === 'running' && !status.qqOnline);
    if (!shouldPoll) return;
    let cancelled = false;
    const fetchQr = async () => {
      try {
        const result = await api.napcat.qr();
        if (cancelled) return;
        if (result.dataUrl) setQr(result.dataUrl);
        if (result.path) setQrPath(result.path);
      } catch {
        /* 二维码尚未生成时静默重试 */
      }
    };
    void fetchQr();
    const timer = setInterval(() => { void fetchQr(); }, 4000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [status.kind, status.qqOnline]);

  /* 状态变化时同步二维码 */
  React.useEffect(() => {
    if (status.qqOnline || status.kind === 'online') {
      setQr(undefined);
      setQrPath(undefined);
      return;
    }
    if (status.qrCodeDataUrl) setQr(status.qrCodeDataUrl);
    if (status.loginQrPath) setQrPath(status.loginQrPath);
  }, [status.qrCodeDataUrl, status.loginQrPath, status.qqOnline, status.kind]);

  const refreshQr = React.useCallback(async () => {
    try {
      const result = await api.napcat.qr();
      if (result.dataUrl) {
        setQr(result.dataUrl);
        setQrPath(result.path);
        toast.success('二维码已刷新');
      } else {
        toast.info('二维码暂未生成', 'NapCat 初始化完成后会自动显示');
      }
    } catch (error) {
      toast.error('获取二维码失败', errMessage(error));
    }
  }, [toast]);

  const runStatusAction = React.useCallback(async (kind: 'start' | 'stop' | 'restart', label: string, run: () => Promise<NapCatStatus>) => {
    setAction(kind);
    appendLocal(`执行操作：${label}`, 'info');
    try {
      const next = await run();
      setNapcat(next);
      if (next.kind === 'error') {
        appendLocal(`${label}失败：${next.lastError ?? '请查看日志'}`, 'error');
        toast.error(`${label}失败`, next.lastError ?? '请查看控制台日志');
      } else {
        appendLocal(`${label}完成 · 当前状态：${napcatMeta(next.kind).label}`, 'info');
        toast.success(`${label}完成`);
      }
      if (kind === 'stop') { setQr(undefined); setQrPath(undefined); }
    } catch (error) {
      appendLocal(`${label}失败：${errMessage(error)}`, 'error');
      toast.error(`${label}失败`, errMessage(error));
    } finally {
      setAction(null);
    }
  }, [appendLocal, setNapcat, toast]);

  const start = React.useCallback(() => { void runStatusAction('start', '启动 NapCat', () => api.napcat.start()); }, [runStatusAction]);
  const stop = React.useCallback(() => { void runStatusAction('stop', '停止 NapCat', () => api.napcat.stop()); }, [runStatusAction]);
  const restart = React.useCallback(() => { void runStatusAction('restart', '重启 NapCat', () => api.napcat.restart()); }, [runStatusAction]);

  const handleInstall = React.useCallback(async (method: 'onekey' | 'existing', installDir?: string) => {
    setAction('install');
    appendLocal(`开始${method === 'onekey' ? '一键安装 NapCat' : '接入已有 NapCat 安装'}…`, 'info');
    try {
      if (method === 'existing' && installDir) {
        const saved = await api.napcat.save({ installDir });
        setNapcat(saved);
        appendLocal(`安装目录已保存：${installDir}`, 'info');
      }
      const result = await api.napcat.install(method);
      setInstallResult(result);
      result.log?.forEach((line) => appendLocal(line, 'info'));
      appendLocal(result.message, result.ok ? 'info' : 'error');
      if (result.ok) toast.success('NapCat 安装完成', result.message);
      else toast.error('NapCat 安装失败', result.message);
      try {
        const next = await api.napcat.status();
        setNapcat(next);
      } catch {
        /* 安装结果已由返回消息体现 */
      }
    } catch (error) {
      appendLocal(`安装失败：${errMessage(error)}`, 'error');
      toast.error('NapCat 安装失败', errMessage(error));
    } finally {
      setAction(null);
    }
  }, [appendLocal, setNapcat, toast]);

  const openWebui = React.useCallback(async () => {
    try {
      const base = settings.napcat.webuiUrl || status.webuiUrl;
      const token = settings.napcat.webuiToken;
      const url = token ? base + (base.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token) : base;
      const ok = await api.napcat.openWebui(url);
      if (ok) toast.success('已打开内置 WebUI', '管理界面作为鲸鲸的窗口运行');
      else toast.warning('WebUI 暂不可用', '请确认 NapCat 已启动，且 WebUI 地址正确');
    } catch (error) {
      toast.error('打开内置 WebUI 失败', errMessage(error));
    }
  }, [toast]);

  const sendCommand = React.useCallback(async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setSending(true);
    appendLocal(`❯ ${trimmed}`, 'info');
    try {
      const result = await api.napcat.command(trimmed);
      appendLocal(result.message || (result.ok ? '命令已执行' : '命令执行失败'), result.ok ? 'info' : 'error');
      if (!result.ok) toast.warning('命令未成功', result.message || trimmed);
    } catch (error) {
      appendLocal(`命令失败：${errMessage(error)}`, 'error');
      toast.error('命令执行失败', errMessage(error));
    } finally {
      setSending(false);
    }
  }, [appendLocal, toast]);

  const refreshAll = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const next = await api.napcat.status();
      setNapcat(next);
      const list = await api.napcat.logs(400);
      mergeServerLogs(list);
      setLogConnected(true);
      toast.success('NapCat 状态已刷新');
    } catch (error) {
      toast.error('刷新失败', errMessage(error));
    } finally {
      setRefreshing(false);
    }
  };

  /* 状态里的 uptimeSec 每 5 秒才更新，这里用本地时钟在两次轮询之间平滑递增 */
  const uptimeAnchor = React.useRef({ base: status.uptimeSec, at: Date.now() });
  React.useEffect(() => {
    uptimeAnchor.current = { base: status.uptimeSec, at: Date.now() };
  }, [status.uptimeSec, status.kind]);
  const uptimeSec = React.useMemo(() => {
    const live = status.kind === 'running' || status.kind === 'online' || status.kind === 'waiting-login' || status.kind === 'starting';
    if (!live) return status.uptimeSec;
    const anchor = uptimeAnchor.current;
    return Math.max(status.uptimeSec, anchor.base + Math.floor((now - anchor.at) / 1000));
  }, [status.kind, status.uptimeSec, now]);

  return (
    <>
      <PageHeader
        eyebrow="NAPCAT CONSOLE"
        icon={<TerminalSquare size={13} />}
        title="NapCat 控制台"
        desc="QQ 协议端完全内嵌：进程状态、实时日志、命令、扫码登录与配置都在本页完成，不会弹出外部控制台。"
        actions={(
          <>
            <Badge tone="brand"><Lock size={11} />内嵌托管</Badge>
            <Button variant="secondary" icon={<RefreshCw size={14} className={refreshing ? 'spin' : undefined} />} onClick={() => void refreshAll()} disabled={refreshing}>刷新状态</Button>
          </>
        )}
      />

      <StatusHero
        status={status}
        uptimeSec={uptimeSec}
        action={action}
        onStart={start}
        onStop={stop}
        onRestart={restart}
        onInstall={() => void handleInstall('onekey')}
      />

      <div className="nc-layout">
        <div className="nc-layout__main">
          <ConsolePanel logs={logs} connected={logConnected} sending={sending} onCmd={sendCommand} onClear={clearLogs} />
        </div>
        <aside className="nc-layout__side">
          <LoginPanel
            status={status}
            qr={qr}
            qrPath={qrPath}
            action={action}
            onStart={start}
            onRefreshQr={refreshQr}
            onOpenWebui={() => void openWebui()}
            onInstall={() => void handleInstall('onekey')}
          />
          <WebUiCard webuiUrl={status.webuiUrl || settings.napcat.webuiUrl} webuiToken={settings.napcat.webuiToken} installed={status.installed} />
        </aside>
      </div>

      <NapCatConfigConsole
        config={settings.napcat}
        status={status}
        installing={action === 'install'}
        installResult={installResult}
        appendLocal={appendLocal}
        onSaved={(nextStatus) => setNapcat(nextStatus)}
        onRefreshStatus={pullStatus}
        onInstall={handleInstall}
      />

      <div className="nc-footnote">
        <ShieldCheck size={14} />
        <span>NapCat 是第三方 QQ 协议端，与本软件无隶属关系。进程由鲸鲸在本机托管，所有界面、日志与二维码都停留在当前窗口；请遵守腾讯服务条款，建议使用专用小号并仅用于个人学习。</span>
      </div>
    </>
  );
}
