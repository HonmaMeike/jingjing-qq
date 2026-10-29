import type { NapCatStatusKind } from '@shared/types';

export type NapCatAction = 'start' | 'stop' | 'restart' | 'install';

export const NAPCAT_STATUS_META: Record<NapCatStatusKind, { label: string; title: string; desc: string; tone: 'default' | 'brand' | 'success' | 'warning' | 'danger' }> = {
  stopped: {
    label: '已停止',
    title: 'NapCat 尚未启动',
    desc: 'NapCat 进程未运行。启动后，手机 QQ 扫码登录会直接显示在本页。',
    tone: 'default',
  },
  starting: {
    label: '启动中',
    title: '正在启动 NapCat',
    desc: '正在拉起 QQ 与 OneBot 服务，稍候二维码就会出现在登录卡片中。',
    tone: 'brand',
  },
  running: {
    label: '运行中',
    title: 'NapCat 正在运行',
    desc: '进程已就绪，等待 QQ 登录；也可以直接在下方控制台发送命令。',
    tone: 'brand',
  },
  online: {
    label: 'QQ 在线',
    title: 'QQ 已在线',
    desc: '账号已登录，OneBot 已连接，鲸鲸正在收发 QQ 消息。',
    tone: 'success',
  },
  error: {
    label: '运行异常',
    title: 'NapCat 运行异常',
    desc: '运行遇到问题，请查看控制台日志，并在「诊断」中检查端口与 QQ 进程。',
    tone: 'danger',
  },
  installing: {
    label: '安装中',
    title: '正在安装 NapCat',
    desc: '正在下载并部署 NapCat 内核，安装输出会同步写入控制台。',
    tone: 'brand',
  },
  'waiting-login': {
    label: '等待扫码',
    title: '等待 QQ 扫码登录',
    desc: '请使用手机 QQ 扫描登录卡片中的二维码，登录窗口会自动隐藏。',
    tone: 'warning',
  },
};

export function napcatMeta(kind: NapCatStatusKind | undefined) {
  return (kind && NAPCAT_STATUS_META[kind]) || NAPCAT_STATUS_META.stopped;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours} 时 ${String(minutes).padStart(2, '0')} 分`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function errMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '未知错误';
}

export function maskSecret(value?: string): string {
  if (!value) return '未设置';
  if (value.length <= 6) return '••••••';
  return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

/** 为本地 WebUI 地址附加 token 查询参数（NapCat WebUI 支持 ?token= 免登录）。 */
export function withToken(url: string, token?: string): string {
  if (!url || !token) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has('token')) parsed.searchParams.set('token', token);
    return parsed.toString();
  } catch {
    return url;
  }
}

export function splitWords(text: string): string[] {
  return text
    .split(/[\n,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
