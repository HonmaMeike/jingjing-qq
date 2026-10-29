import React from 'react';
import { Download, FolderOpen, HardDrive, Lock, Power, QrCode, RefreshCcw, RotateCcw, Square, User, Wifi, Wrench, Zap } from 'lucide-react';
import type { NapCatStatus } from '@shared/types';
import { Badge, Button } from '@/components/ui';
import { NAPCAT_STATUS_META, type NapCatAction, formatDuration } from './utils';

interface StatusHeroProps {
  status: NapCatStatus;
  uptimeSec: number;
  action: NapCatAction | null;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onInstall: () => void;
}

const ACTION_LABEL: Record<NapCatAction, string> = {
  start: '正在启动 NapCat 进程…',
  stop: '正在停止 NapCat 进程…',
  restart: '正在重启 NapCat…',
  install: '正在下载并安装 NapCat 内核…',
};

export function StatusHero({ status, uptimeSec, action, onStart, onStop, onRestart, onInstall }: StatusHeroProps) {
  const meta = NAPCAT_STATUS_META[status.kind] ?? NAPCAT_STATUS_META.stopped;
  const canStart = status.kind === 'stopped' || status.kind === 'error';
  const canStop = status.kind === 'running' || status.kind === 'online' || status.kind === 'waiting-login';
  const busy = action !== null;
  const live = status.kind === 'running' || status.kind === 'online' || status.kind === 'waiting-login' || status.kind === 'starting';

  const identity = status.uin ? `UIN ${status.uin}` : '未登录';
  const nickname = status.nickname || '—';

  return (
    <section className="nc-hero" data-kind={status.kind}>
      <div className="nc-hero__main">
        <div className={status.kind === 'online' || live ? 'nc-orb nc-orb--live' : 'nc-orb'} data-kind={status.kind}>
          <span className="nc-orb__ring" />
          <Power size={24} />
        </div>

        <div className="nc-hero__title">
          <div className="nc-hero__badges">
            <span className="nc-eyebrow"><span className="nc-eyebrow__dot" />NAPCAT · {meta.label.toUpperCase()}</span>
            <span className="nc-inline-chip"><Lock size={11} />完全内嵌 · 无外部控制台</span>
            {status.installed ? <Badge tone="mint">已安装{status.version ? ` · v${status.version}` : ''}</Badge> : <Badge tone="warning">未安装</Badge>}
          </div>
          <h2>{meta.title}{status.kind === 'online' && status.nickname ? ` · ${status.nickname}` : ''}</h2>
          <p className="nc-hero__desc">{meta.desc}</p>
          <div className="nc-hero__identity">
            <span><QrCode size={12} />{identity}</span>
            <span><User size={12} />{nickname}</span>
            <span><Wifi size={12} />{status.qqOnline ? 'QQ 在线' : 'QQ 离线'}</span>
            <span><Zap size={12} />{status.oneBotConnected ? 'OneBot 已连接' : 'OneBot 未连接'}</span>
            {status.installDir && <span className="truncate" title={status.installDir}><FolderOpen size={12} />{status.installDir}</span>}
          </div>
        </div>

        <div className="nc-hero__actions">
          {canStart ? (
            <Button variant="primary" icon={<Power size={15} />} loading={action === 'start'} disabled={busy} onClick={onStart}>启动 NapCat</Button>
          ) : (
            <Button variant="danger" icon={<Square size={14} />} loading={action === 'stop'} disabled={busy || !canStop} onClick={onStop}>停止</Button>
          )}
          <Button icon={<RotateCcw size={14} />} loading={action === 'restart'} disabled={busy || !canStop} onClick={onRestart}>重启</Button>
          {!status.installed ? (
            <Button variant="primary" icon={<Download size={15} />} loading={action === 'install'} disabled={busy} onClick={onInstall}>一键安装</Button>
          ) : status.kind === 'error' ? (
            <Button variant="secondary" icon={<Wrench size={14} />} loading={action === 'install'} disabled={busy} onClick={onInstall}>修复安装</Button>
          ) : null}
        </div>
      </div>

      <div className="nc-hero__stats">
        <div className="nc-stat">
          <div className="nc-stat__label">QQ 登录</div>
          <div className={status.qqOnline ? 'nc-stat__value nc-stat__value--ok' : 'nc-stat__value'}>{status.qqOnline ? '已在线' : '未登录'}</div>
          <div className="nc-stat__sub truncate">{status.uin ? `UIN ${status.uin}` : '等待扫码'}</div>
        </div>
        <div className="nc-stat">
          <div className="nc-stat__label">OneBot 连接</div>
          <div className={status.oneBotConnected ? 'nc-stat__value nc-stat__value--ok' : 'nc-stat__value'}>{status.oneBotConnected ? '已连接' : '未连接'}</div>
          <div className="nc-stat__sub">与鲸鲸的消息通道</div>
        </div>
        <div className="nc-stat">
          <div className="nc-stat__label">运行时长</div>
          <div className="nc-stat__value mono">{formatDuration(uptimeSec)}</div>
          <div className="nc-stat__sub">{status.startedAt ? '本次运行' : '尚未启动'}</div>
        </div>
        <div className="nc-stat">
          <div className="nc-stat__label">控制台日志</div>
          <div className="nc-stat__value mono">{status.consoleLines ?? 0}</div>
          <div className="nc-stat__sub">行缓冲</div>
        </div>
        <div className="nc-stat">
          <div className="nc-stat__label">隐藏窗口</div>
          <div className="nc-stat__value mono">{status.hiddenWindowCount ?? 0}</div>
          <div className="nc-stat__sub">{status.installed ? 'QQ 登录窗口已托管' : '—'}</div>
        </div>
      </div>

      {action && (
        <div className="nc-hero__busy">
          <span className="nc-hero__spinner"><RefreshCcw size={13} className="spin" /></span>
          <span>{ACTION_LABEL[action]}</span>
          <span className="nc-hero__progress"><span /></span>
        </div>
      )}

      {status.lastError && (
        <div className="nc-hero__error">
          <HardDrive size={14} />
          <span className="truncate" title={status.lastError}>最近错误：{status.lastError}</span>
        </div>
      )}
    </section>
  );
}
