import React from 'react';
import { CheckCircle2, Download, Loader2, MonitorPlay, PackageOpen, QrCode, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import type { NapCatStatus } from '@shared/types';
import { Badge, Button, Card, CardBody, CardHead, CopyButton, EmptyState } from '@/components/ui';
import { type NapCatAction, formatDuration, napcatMeta } from './utils';

interface LoginPanelProps {
  status: NapCatStatus;
  qr?: string;
  qrPath?: string;
  action: NapCatAction | null;
  onStart: () => void;
  onRefreshQr: () => Promise<void>;
  onOpenWebui: () => void;
  onInstall: () => void;
}

export function LoginPanel({ status, qr, qrPath, action, onStart, onRefreshQr, onOpenWebui, onInstall }: LoginPanelProps) {
  const [refreshing, setRefreshing] = React.useState(false);
  const meta = napcatMeta(status.kind);
  const online = status.qqOnline || status.kind === 'online';
  const starting = status.kind === 'starting' || status.kind === 'installing';
  const showQr = !online && !starting && status.installed && (status.kind === 'waiting-login' || status.kind === 'running');

  const refreshQr = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await onRefreshQr(); } finally { setRefreshing(false); }
  };

  return (
    <Card className="nc-card nc-login">
      <CardHead
        title="QQ 登录"
        desc="扫码在本页完成，不弹出外部登录窗口"
        icon={<QrCode size={16} />}
        extra={<Badge tone={meta.tone} dot={online}>{online ? '已登录' : meta.label}</Badge>}
      />
      <CardBody className="nc-login__body">
        {online && (
          <>
            <div className="nc-online">
              <div className="nc-online__icon"><CheckCircle2 size={26} /></div>
              <div className="nc-online__text">
                <div className="nc-online__title">{status.nickname || 'QQ 账号'} 已登录</div>
                <div className="nc-online__meta mono">{status.uin ? `UIN ${status.uin}` : 'UIN 未知'}</div>
              </div>
              <Badge tone="success" dot>在线</Badge>
            </div>
            <div className="nc-info-list">
              <div><span>OneBot 连接</span><Badge tone={status.oneBotConnected ? 'success' : 'warning'}>{status.oneBotConnected ? '已连接' : '未连接'}</Badge></div>
              <div><span>本次运行</span><b className="mono">{formatDuration(status.uptimeSec)}</b></div>
              <div><span>隐藏的 QQ 窗口</span><b className="mono">{status.hiddenWindowCount ?? 0} 个</b></div>
            </div>
            <div className="nc-login__note"><ShieldCheck size={13} />二维码已自动清除；如果掉线，NapCat 会自动回到扫码状态。</div>
          </>
        )}

        {!online && starting && (
          <div className="nc-login__busy">
            <Loader2 size={24} className="spin" />
            <div>
              <div className="nc-login__busy-title">{status.kind === 'installing' ? '正在安装 NapCat' : '正在启动 NapCat'}</div>
              <div className="nc-login__busy-desc">进程就绪后，二维码会自动出现在这里，无需任何外部窗口。</div>
            </div>
          </div>
        )}

        {!online && !starting && !status.installed && (
          <EmptyState
            icon={<PackageOpen size={23} />}
            title="尚未安装 NapCat"
            desc="先在页面下方「安装引导」中一键安装 NapCat 内核，安装完成后再次启动即可扫码。"
            action={(
              <Button variant="primary" icon={<Download size={14} />} loading={action === 'install'} disabled={action !== null && action !== 'install'} onClick={onInstall}>
                一键安装 NapCat
              </Button>
            )}
          />
        )}

        {!online && !starting && status.installed && showQr && (
          <>
            <div className="nc-qr-block">
              <div className={qr ? 'nc-qr nc-qr--ready' : 'nc-qr nc-qr--pending'}>
                <span className="nc-qr__corner nc-qr__corner--tl" />
                <span className="nc-qr__corner nc-qr__corner--tr" />
                <span className="nc-qr__corner nc-qr__corner--bl" />
                <span className="nc-qr__corner nc-qr__corner--br" />
                {qr ? (
                  <>
                    <img src={qr} alt="QQ 登录二维码" className="nc-qr__img" />
                    <span className="nc-qr__scan" />
                  </>
                ) : (
                  <div className="nc-qr__pending">
                    <Loader2 size={22} className="spin" />
                    <span>正在获取二维码…</span>
                  </div>
                )}
              </div>
              <div className="nc-qr__meta">
                <Badge tone="warning" dot>等待扫码</Badge>
                <span className="dim text-xs">二维码每 4 秒自动刷新</span>
              </div>
            </div>
            {qrPath && (
              <div className="nc-path-row">
                <span className="mono truncate" title={qrPath}>{qrPath}</span>
                <CopyButton text={qrPath} label="复制路径" />
              </div>
            )}
            <div className="nc-login__note"><Smartphone size={13} />扫码后登录窗口会被自动隐藏，二维码与登录流程全部停留在本页。</div>
          </>
        )}

        {!online && !starting && status.installed && !showQr && (
          <EmptyState
            icon={<QrCode size={23} />}
            title={status.kind === 'error' ? 'NapCat 当前不可用' : '启动后即可扫码登录'}
            desc={status.kind === 'error' ? '请先修复或重启 NapCat，再获取登录二维码。' : '点击右上角「启动 NapCat」，进程就绪后二维码会显示在这里。'}
            action={(
              <Button variant="primary" icon={<QrCode size={14} />} loading={action === 'start'} disabled={action !== null} onClick={onStart}>
                {status.kind === 'error' ? '重新启动' : '启动 NapCat'}
              </Button>
            )}
          />
        )}

        {status.kind === 'error' && status.lastError && (
          <div className="nc-error-note">
            <span className="nc-error-note__title">最近错误</span>
            <span className="nc-error-note__text">{status.lastError}</span>
          </div>
        )}

        {!online && (
          <ol className="nc-login__steps">
            <li><span>1</span>手机 QQ 扫描本页二维码</li>
            <li><span>2</span>登录窗口自动隐藏，不弹外部控制台</li>
            <li><span>3</span>登录成功后自动建立 OneBot 连接</li>
          </ol>
        )}

        <div className="nc-login__actions">
          {showQr && (
            <Button variant="secondary" size="sm" icon={<RefreshCw size={13} className={refreshing ? 'spin' : undefined} />} onClick={() => void refreshQr()} disabled={refreshing}>刷新二维码</Button>
          )}
          <Button variant="ghost" size="sm" icon={<MonitorPlay size={13} />} onClick={onOpenWebui} disabled={!status.installed}>打开内置 WebUI</Button>
        </div>
      </CardBody>
    </Card>
  );
}
