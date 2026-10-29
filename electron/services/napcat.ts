import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ChatAttachment, Conversation, NapCatDiagnostics, NapCatFileStatus, NapCatInstallResult,
  NapCatLogLine, NapCatStatus, NapCatStatusKind,
} from '../../shared/types';
import type { SettingsService } from './settings';
import type { EventBus } from '../core/event-bus';
import type { Logger } from '../core/logger';
import type { ChatService, ChatOutbound } from './chat';
import type { ObservabilityService } from './observability';
import { nowIso, sleep, uid } from '../core/utils';

interface OneBotEvent {
  post_type?: string;
  message_type?: 'private' | 'group';
  sub_type?: string;
  self_id?: number | string;
  user_id?: number | string;
  group_id?: number | string;
  message?: string | Array<{ type: string; data: Record<string, unknown> }>;
  raw_message?: string;
  sender?: { nickname?: string; card?: string; user_id?: number | string };
  meta_event_type?: string;
  notice_type?: string;
  time?: number;
}

interface OneBotResponse { status?: string; retcode?: number; data?: unknown; echo?: string; message?: string; wording?: string; }

interface PetAssetFile { name: string; webm?: string; gif?: string; category: string; }

const MAX_LOGS = 600;

export class NapCatService {
  private child: ChildProcess | null = null;
  private hideChild: ChildProcess | null = null;
  private wss: WebSocketServer | null = null;
  private wsClient: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 3000;
  private monitorTimer: NodeJS.Timeout | null = null;
  private actionWaiters = new Map<string, { resolve: (v: OneBotResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private logs: NapCatLogLine[] = [];
  private logSeq = 0;
  private status: NapCatStatus;
  private startedAt = 0;
  private stopped = true;
  private configuredUin = '';
  private qrWarned = false;
  private qrMtime = 0;
  private hasLoggedIn = false;
  private qrPath = '';
  private wssPort = 0;
  private clients = new Set<WebSocket>();
  private seenEvents = new Map<string, number>();
  private assets: PetAssetFile[] = [];
  private configRestartDone = false;
  private parsedWebuiToken = '';

  constructor(private deps: {
    settings: SettingsService;
    events: EventBus;
    logger: Logger;
    paths: { napcatDir: string; dataDir: string; petDir: string; externalPetDir: string };
    chat: ChatService;
    observability?: ObservabilityService;
  }) {
    this.status = this.baseStatus();
    this.loadAssets();
    this.deps.chat.setOutbound(this.outbound);
  }

  private baseStatus(): NapCatStatus {
    const s = this.deps.settings.get().napcat;
    return { kind: 'stopped', installed: this.detectInstalledSync(), installDir: s.installDir, uin: s.botUin, qqOnline: false, oneBotConnected: false, consoleLines: this.logs.length, uptimeSec: 0, webuiUrl: s.webuiUrl };
  }

  private detectInstalledSync(): boolean {
    const dir = this.deps.settings.get().napcat.installDir;
    if (!dir) return false;
    return ['launcher.bat', 'napcat.bat', path.join('bootmain', 'napcat.bat'), path.join('napcat', 'launcher.bat')].some((p) => { try { return fsSync.existsSync(path.join(dir, p)); } catch { return false; } });
  }

  private async loadAssets(): Promise<void> {
    const candidates = [path.join(this.deps.paths.petDir, 'manifest.json'), path.join(this.deps.paths.externalPetDir, 'manifest.json')];
    for (const file of candidates) {
      try {
        const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { animations?: { name: string; webm: string; gif: string }[]; gifs?: never[] };
        if (raw.animations?.length) { this.assets = raw.animations.map((a) => ({ name: a.name, webm: a.webm, gif: a.gif, category: 'animation' })); return; }
      } catch { /* try next */ }
    }
  }

  getStatus(): NapCatStatus { return { ...this.status, consoleLines: this.logs.length, uptimeSec: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0 }; }
  getLogs(limit = 300): NapCatLogLine[] { return this.logs.slice(-limit); }

  private pushLog(level: NapCatLogLine['level'], text: string): void {
    const line: NapCatLogLine = { id: ++this.logSeq, time: nowIso(), level, text: String(text).replace(/\x1b\[[0-9;]*m/g, '') };
    this.logs.push(line);
    if (this.logs.length > MAX_LOGS) this.logs.splice(0, this.logs.length - MAX_LOGS);
    this.deps.events.emit('napcat:log', line);
    const clean = line.text.trim();
    if (!clean) return;
    if (/https?:\/\/[^\s]*(qr|qrcode)[^\s]*/i.test(clean) || /二维码|qrcode/i.test(clean)) this.tryQrFromLog(clean);
    const uinMatch = clean.match(/(?:账号|QQ|uin|Uin|self_id)[^0-9]{0,8}([1-9][0-9]{4,11})/);
    if (uinMatch && !this.configuredUin) { this.configuredUin = uinMatch[1]; this.status.uin = this.configuredUin; this.log('info', '检测到 QQ 账号：' + this.configuredUin); }
    const tokenMatch = clean.match(/WebUi Token[:：]\s*([A-Za-z0-9]+)/i);
    if (tokenMatch) {
      this.parsedWebuiToken = tokenMatch[1];
      const base = this.deps.settings.get().napcat.webuiUrl || 'http://127.0.0.1:6099/webui';
      this.setStatus({ webuiUrl: base + '?token=' + tokenMatch[1] });
    }
    const accountMatch = clean.match(/登录账号[:：]?\s*([1-9][0-9]{4,11})|账号\s*([1-9][0-9]{4,11})\s*登录|self_id[:：]?\s*([1-9][0-9]{4,11})/);
    if (accountMatch && !this.configuredUin) {
      this.configuredUin = accountMatch[1] || accountMatch[2] || accountMatch[3];
      this.status.uin = this.configuredUin;
      this.log('info', '检测到机器人账号：' + this.configuredUin);
    }
    // OneKey 启动器会列出可快速登录的账号；若昵称与 botName 匹配，自动用于 OneBot 配置（仍需用户扫码确认登录）。
    if (!this.configuredUin) {
      const botName = this.deps.settings.get().general.botName || '鲸鲸';
      const quick = clean.match(/^\s*\d+\.\s*([1-9][0-9]{4,11})\s+(.+)$/);
      if (quick && quick[2].includes(botName)) {
        this.configuredUin = quick[1];
        this.status.uin = this.configuredUin;
        this.log('info', '从快速登录列表识别到机器人账号：' + this.configuredUin + '（' + quick[2].trim() + '）');
      }
    }
    if (/登录成功|上线成功|online|Logged in/i.test(clean)) {
      this.status.qqOnline = true;
      this.hasLoggedIn = true;
      this.qrPath = '';
      this.qrMtime = 0;
      this.setStatus({ kind: 'online', qqOnline: true });
      void this.applyOneBotConfig(this.configuredUin);
    }
  }

  private log(level: NapCatLogLine['level'], text: string): void { this.pushLog(level, text); this.deps.logger.info('napcat', text); }

  private setStatus(patch: Partial<NapCatStatus>): void {
    this.status = { ...this.getStatus(), ...patch };
    this.deps.events.emit('napcat:status', this.getStatus());
  }

  private async tryQrFromLog(text: string): Promise<void> {
    const paths = text.match(/[A-Za-z]:\\[^\n"'<>]+\.png|[^\s"'<>]+\.png/gi) ?? [];
    for (const candidate of paths.slice(0, 3)) {
      try {
        const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(this.deps.settings.get().napcat.installDir || this.deps.paths.napcatDir, candidate);
        const data = await fs.readFile(resolved);
        if (data.length > 500) { this.qrPath = resolved; await this.emitQrData(data, resolved); return; }
      } catch { /* ignore */ }
    }
  }

  private async emitQrData(data: Buffer, filePath?: string): Promise<void> {
    const dataUrl = 'data:image/png;base64,' + data.toString('base64');
    this.status.qrCodeDataUrl = dataUrl;
    this.status.loginQrPath = filePath;
    this.deps.observability?.recordNeural({ type: 'napcat', node: 'napcat', target: 'qq', label: '登录二维码已就绪', detail: filePath });
    if (this.status.kind === 'starting') this.setStatus({ kind: 'waiting-login' });
    this.deps.events.emit('napcat:qr', { dataUrl, path: filePath });
  }

  async getQr(): Promise<{ dataUrl?: string; path?: string }> {
    if (this.qrPath) {
      try { const data = await fs.readFile(this.qrPath); if (data.length > 500) return { dataUrl: 'data:image/png;base64,' + data.toString('base64'), path: this.qrPath }; } catch { /* ignore */ }
    }
    const dirs = [this.deps.settings.get().napcat.installDir, this.deps.paths.napcatDir].filter(Boolean);
    for (const dir of dirs) {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !/\.(png|jpg|jpeg)$/i.test(entry.name) || !/qr|code|login/i.test(entry.name)) continue;
          const file = path.join(dir, entry.name);
          const data = await fs.readFile(file);
          if (data.length > 500) { this.qrPath = file; return { dataUrl: 'data:image/png;base64,' + data.toString('base64'), path: file }; }
        }
      } catch { /* ignore */ }
    }
    return {};
  }

  async start(): Promise<NapCatStatus> {
    if (this.child && !this.stopped) return this.getStatus();
    const settings = this.deps.settings.get().napcat;
    const installDir = settings.installDir || this.deps.paths.napcatDir;
    if (!settings.enabled || this.deps.settings.get().plugins.napcat?.enabled === false) { this.log('warn', 'NapCat 插件已禁用'); return this.getStatus(); }
    const launcher = await this.findLauncher(installDir);
    if (!launcher) {
      this.setStatus({ kind: 'error', lastError: '未找到 NapCat 安装目录。请先在 NapCat 页面一键安装或填写已有目录。', installDir });
      this.log('error', '未找到 NapCat 启动器，安装目录：' + installDir);
      return this.getStatus();
    }
    await this.killOrphanBootProcesses();
    this.stopped = false;
    this.qrWarned = false;
    this.qrPath = '';
    this.qrMtime = 0;
    this.hasLoggedIn = false;
    this.startedAt = Date.now();
    this.deps.observability?.recordNeural({ type: 'napcat', node: 'napcat', target: 'qq', label: 'NapCat 启动', detail: installDir });
    this.setStatus({ kind: 'starting', installDir, webuiUrl: settings.webuiUrl, lastError: undefined });
    this.log('info', '启动 NapCat：' + launcher);
    if (settings.botUin) { await this.ensureOneBotConfig(settings.botUin); }
    await this.startOneBotServer();
    const launchDir = path.dirname(launcher);
    const bootExe = path.join(launchDir, 'NapCatWinBootMain.exe');
    const useBootExe = fsSync.existsSync(bootExe);
    const launchFile = useBootExe ? bootExe : launcher;
    const args = useBootExe ? (settings.botUin && settings.autoLogin && this.hasLoggedIn ? [settings.botUin] : []) : ['/d', '/s', '/c', '""' + launcher + '""'];
    try {
      this.child = spawn(useBootExe ? bootExe : 'cmd.exe', args, {
        cwd: launchDir,
        windowsHide: true,
        windowsVerbatimArguments: !useBootExe,
        env: { ...process.env, NAPCAT_HIDE_WINDOW: '1', NAPCAT_HEADLESS: '1', NAPCAT_LOG_LEVEL: 'info' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      this.log('error', '启动失败：' + (error as Error).message);
      this.setStatus({ kind: 'error', lastError: (error as Error).message });
      return this.getStatus();
    }
    this.child.stdout?.on('data', (buf: Buffer) => buf.toString('utf8').split(/\r?\n/).forEach((line) => { if (line.trim()) this.pushLog('info', line); }));
    this.child.stderr?.on('data', (buf: Buffer) => buf.toString('utf8').split(/\r?\n/).forEach((line) => { if (line.trim()) this.pushLog('warn', line); }));
    this.child.on('exit', (code) => {
      this.log(code === 0 ? 'info' : 'error', 'NapCat 进程已退出，退出码 ' + code);
      this.child = null;
      this.qrPath = '';
      this.qrMtime = 0;
      this.hasLoggedIn = false;
      if (!this.stopped) {
        this.setStatus({ kind: code === 0 ? 'stopped' : 'error', qqOnline: false, oneBotConnected: false, lastError: code === 0 ? undefined : '进程退出码 ' + code });
        if (settings.autoRestart) setTimeout(() => { if (!this.stopped) void this.start(); }, 5000);
      }
    });
    if (settings.hideQQWindows) this.startWindowHider(settings.autoHideDelayMs, this.child?.pid);
    this.connectOneBot();
    this.startMonitor();
    return this.getStatus();
  }

  private async killOrphanBootProcesses(): Promise<void> {
    try {
      const script = "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq 'NapCatWinBootMain.exe' } | ForEach-Object { Write-Output $_.ProcessId }";
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true });
      let out = '';
      child.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
      await new Promise<void>((resolve) => { child.on('close', () => resolve()); setTimeout(resolve, 2500); });
      for (const line of out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
        const pid = Number(line);
        if (!Number.isFinite(pid)) continue;
        try { spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); this.pushLog('warn', '已清理上一次未退出的 NapCat 引导进程 PID ' + pid); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  async stop(): Promise<NapCatStatus> {
    this.stopped = true;
    this.log('info', '正在停止 NapCat…');
    if (this.monitorTimer) { clearInterval(this.monitorTimer); this.monitorTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    if (this.wsClient) { try { this.wsClient.close(); } catch { /* ignore */ } this.wsClient = null; }
    for (const client of this.clients) { try { client.close(); } catch { /* ignore */ } }
    this.clients.clear();
    if (this.wss) { try { this.wss.close(); } catch { /* ignore */ } this.wss = null; }
    if (this.hideChild) { try { this.hideChild.kill(); } catch { /* ignore */ } this.hideChild = null; }
    if (this.child?.pid) {
      try { spawn('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* ignore */ }
      this.child = null;
    }
    await this.killOrphanBootProcesses();
    this.startedAt = 0;
    this.qrPath = '';
    this.qrMtime = 0;
    this.hasLoggedIn = false;
    this.deps.observability?.recordNeural({ type: 'napcat', node: 'napcat', target: 'qq', label: 'NapCat 已停止', detail: '通道断开' });
    this.setStatus({ kind: 'stopped', qqOnline: false, oneBotConnected: false, qrCodeDataUrl: undefined, uptimeSec: 0 });
    this.log('info', 'NapCat 已停止');
    return this.getStatus();
  }

  async restart(): Promise<NapCatStatus> { await this.stop(); await sleep(600); return this.start(); }

  async findLauncher(installDir: string): Promise<string | null> {
    if (!installDir) return null;
    const candidates = [
      path.join(installDir, 'launcher.bat'), path.join(installDir, 'napcat.bat'),
      path.join(installDir, 'bootmain', 'napcat.bat'), path.join(installDir, 'napcat', 'launcher.bat'),
      path.join(installDir, 'napcat', 'napcat.bat'),
    ];
    for (const file of candidates) { try { if ((await fs.stat(file)).isFile()) return file; } catch { /* next */ } }
    try {
      const entries = await fs.readdir(installDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && /napcat|shell/i.test(entry.name)) {
          const found = await this.findLauncher(path.join(installDir, entry.name));
          if (found) return found;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  private async startOneBotServer(): Promise<void> {
    if (this.wss) return;
    const settings = this.deps.settings.get().napcat;
    try {
      this.wss = new WebSocketServer({ host: '127.0.0.1', port: settings.reverseWsPort });
      this.wssPort = settings.reverseWsPort;
      this.wss.on('connection', (socket, req) => {
        const token = settings.webuiToken;
        if (token && req.headers.authorization !== 'Bearer ' + token) { try { socket.close(1008, 'unauthorized'); } catch { /* ignore */ } return; }
        this.clients.add(socket);
        this.deps.observability?.recordNeural({ type: 'napcat', node: 'napcat', target: 'core', label: 'OneBot 反向连接建立', detail: 'QQ 消息通道已就绪' });
        this.hasLoggedIn = true;
        this.setStatus({ oneBotConnected: true, qqOnline: true });
        this.log('info', 'OneBot 反向 WebSocket 已连接');
        socket.on('message', (data) => this.handleOneBotPayload(String(data)));
        socket.on('close', () => { this.clients.delete(socket); if (!this.clients.size && !this.wsClient) this.setStatus({ oneBotConnected: false }); });
      });
      this.wss.on('error', (error) => this.log('warn', 'OneBot WS 服务启动失败：' + error.message));
      this.log('info', 'OneBot 反向 WS 监听 127.0.0.1:' + settings.reverseWsPort);
    } catch (error) { this.log('warn', 'OneBot 服务启动失败：' + (error as Error).message); }
  }

  private connectOneBot(): void {
    const settings = this.deps.settings.get().napcat;
    if (settings.oneBotWsUrl) {
      try {
        const ws = new WebSocket(settings.oneBotWsUrl, { headers: settings.webuiToken ? { Authorization: 'Bearer ' + settings.webuiToken } : undefined });
        this.wsClient = ws;
        ws.on('open', () => { this.hasLoggedIn = true; this.setStatus({ oneBotConnected: true, qqOnline: true }); this.log('info', '已连接 NapCat OneBot WebSocket：' + settings.oneBotWsUrl); });
        ws.on('message', (data) => this.handleOneBotPayload(String(data)));
        ws.on('close', () => { if (this.wsClient === ws) this.wsClient = null; if (!this.clients.size) this.setStatus({ oneBotConnected: false }); if (!this.stopped) this.scheduleReconnect(); });
        ws.on('error', () => { /* close handler reconnects */ });
      } catch (error) { this.log('warn', '连接 OneBot 失败：' + (error as Error).message); this.scheduleReconnect(); }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; if (!this.stopped) this.connectOneBot(); }, 5000);
  }

  private handleOneBotPayload(raw: string): void {
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { return; }
    if (!payload || typeof payload !== 'object') return;
    const candidate = payload as OneBotEvent & { message_id?: number | string; time?: number };
    if (candidate.post_type === 'message') {
      const key = String(candidate.message_id ?? '') + '|' + String(candidate.time ?? '') + '|' + String(candidate.user_id ?? '') + '|' + String((candidate.raw_message ?? '').slice(0, 120));
      const last = this.seenEvents.get(key) ?? 0;
      if (Date.now() - last < 5000) return;
      this.seenEvents.set(key, Date.now());
      if (this.seenEvents.size > 500) {
        const cutoff = Date.now() - 30000;
        for (const [k, t] of this.seenEvents) if (t < cutoff) this.seenEvents.delete(k);
      }
    }
    if ('echo' in payload && (payload as OneBotResponse).echo) {
      const waiter = this.actionWaiters.get(String((payload as OneBotResponse).echo));
      if (waiter) { clearTimeout(waiter.timer); this.actionWaiters.delete(String((payload as OneBotResponse).echo)); waiter.resolve(payload as OneBotResponse); }
      return;
    }
    const event = payload as OneBotEvent & { status?: string; retcode?: number };
    if (event.status && event.retcode !== undefined) return;
    if (event.self_id) this.configuredUin = String(event.self_id);
    if (event.post_type === 'meta_event') {
      if (event.meta_event_type === 'lifecycle') { this.setStatus({ qqOnline: true, oneBotConnected: true, kind: 'online' }); this.log('info', 'OneBot 生命周期：' + (event.sub_type ?? 'connect')); }
      return;
    }
    if (event.post_type !== 'message') return;
    if (String(event.user_id) === String(event.self_id)) return;
    const text = this.extractText(event);
    if (!text.trim()) return;
    const wakeWords = event.message_type === 'group' ? this.deps.settings.get().napcat.groupWakeWords : this.deps.settings.get().napcat.privateWakeWords;
    const mentioned = this.isMentioned(event) || wakeWords.some((word) => word && text.includes(word));
    const scene: 'private' | 'group' = event.message_type === 'group' ? 'group' : 'private';
    const nickname = event.sender?.card || event.sender?.nickname || String(event.user_id ?? '未知');
    this.log('chat', `[收到${scene === 'group' ? '群' : '私聊'}] ${nickname}: ${text.slice(0, 120)}`);
    void this.deps.chat.handleIncoming({
      scene, userId: String(event.user_id), nickname, text, groupId: event.group_id ? String(event.group_id) : undefined,
      groupName: undefined, mentioned, attachments: this.extractAttachments(event),
    }).then((result) => {
      if (!result.handled) this.log('info', '未回复：' + (result.reason ?? '规则过滤'));
    }).catch((error) => this.log('error', '处理消息失败：' + (error as Error).message));
  }

  private extractText(event: OneBotEvent): string {
    if (typeof event.message === 'string') return event.message.replace(/\[CQ:[^\]]+\]/g, '').trim();
    const parts = event.message ?? [];
    return parts.filter((p) => p.type === 'text').map((p) => String(p.data.text ?? '')).join('').trim();
  }

  private isMentioned(event: OneBotEvent): boolean {
    if (typeof event.message === 'string') return /\[CQ:at,qq=(all|\d+)\]/.test(event.message);
    return (event.message ?? []).some((p) => p.type === 'at' && ['all', String(event.self_id)].includes(String(p.data.qq)));
  }

  private extractAttachments(event: OneBotEvent): ChatAttachment[] {
    if (typeof event.message === 'string') return [];
    const attachments: ChatAttachment[] = [];
    for (const part of event.message ?? []) {
      if (part.type === 'image') attachments.push({ kind: 'image', url: String(part.data.url ?? part.data.file ?? ''), name: '图片' });
      if (part.type === 'record') attachments.push({ kind: 'voice', url: String(part.data.url ?? part.data.file ?? ''), name: '语音' });
    }
    return attachments;
  }

  private async startMonitor(): Promise<void> {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = setInterval(() => {
      if (this.startedAt) this.setStatus({ uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000) });
      void this.scanQr();
      if (!this.qrWarned && this.startedAt && Date.now() - this.startedAt > 25_000 && !this.qrPath && !this.status.qqOnline) { this.qrWarned = true; this.log('warn', '启动 25 秒仍未捕获二维码：请确认 NapCat 安装目录可写，或关闭“自动登录”后重启；也可打开 WebUI 查看登录状态'); }
    }, 4000);
  }

  private async scanQr(): Promise<void> {
    if (this.status.qqOnline) return;
    const dirs = [this.deps.settings.get().napcat.installDir, this.deps.paths.napcatDir].filter(Boolean);
    const candidates: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth < 0) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) { if (depth > 0 && !['node_modules', '.git'].includes(entry.name)) await walk(path.join(dir, entry.name), depth - 1); }
          else if (/\.(png|jpg|jpeg)$/i.test(entry.name)) candidates.push(path.join(dir, entry.name));
        }
      } catch { /* ignore */ }
    };
    for (const dir of dirs) await walk(dir, 6);
    candidates.sort((a, b) => fsSync.statSync(b).mtimeMs - fsSync.statSync(a).mtimeMs);
    for (const file of candidates.slice(0, 80)) {
      if (!/qr|code|login|qrcode/i.test(path.basename(file))) continue;
      try {
        const stat = await fs.stat(file);
        if (Date.now() - stat.mtimeMs > 15 * 60_000) continue;
        if (this.qrPath === file && stat.mtimeMs <= this.qrMtime) continue;
        const data = await fs.readFile(file);
        if (data.length > 500) { this.qrPath = file; this.qrMtime = stat.mtimeMs; await this.emitQrData(data, file); return; }
      } catch { /* ignore */ }
    }
  }

  private startWindowHider(delayMs: number, rootPid?: number): void {
    if (this.hideChild || !rootPid) return;
    const script = [
      '$rootPid = ' + rootPid,
      '$src = @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class JJWin {',
      '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
      '}',
      '"@',
      'Add-Type -TypeDefinition $src',
      'while ($true) {',
      '  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId',
      '  $ids = New-Object System.Collections.Generic.HashSet[int]',
      '  [void]$ids.Add([int]$rootPid)',
      '  $changed = $true',
      '  while ($changed) {',
      '    $changed = $false',
      '    foreach ($p in $all) {',
      '      if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $changed = $true }',
      '    }',
      '  }',
      '  foreach ($id in $ids) {',
      '    $proc = Get-Process -Id $id -ErrorAction SilentlyContinue',
      '    if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { [JJWin]::ShowWindowAsync($proc.MainWindowHandle, 0) | Out-Null }',
      '  }',
      '  Start-Sleep -Milliseconds ' + Math.max(200, delayMs),
      '}',
    ].join('\n');
    try {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      this.hideChild = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { windowsHide: true, stdio: 'ignore' });
      this.log('info', '已启用 QQ 窗口隐藏守护（仅隐藏 NapCat 进程树，不干扰你自己的 QQ）');
    } catch (error) { this.log('warn', '窗口隐藏守护启动失败：' + (error as Error).message); }
  }

  async hideWindows(): Promise<{ hidden: number }> {
    const rootPid = this.child?.pid;
    if (!rootPid) return { hidden: 0 };
    const script = [
      '$rootPid = ' + rootPid,
      '$src = @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public class JJWin2 {',
      '  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);',
      '}',
      '"@',
      'Add-Type -TypeDefinition $src',
      '$all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId',
      '$ids = New-Object System.Collections.Generic.HashSet[int]',
      '[void]$ids.Add([int]$rootPid)',
      '$changed = $true',
      'while ($changed) { $changed = $false; foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { [void]$ids.Add([int]$p.ProcessId); $changed = $true } } }',
      '$count = 0',
      'foreach ($id in $ids) { $proc = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($proc -and $proc.MainWindowHandle -ne [IntPtr]::Zero) { [JJWin2]::ShowWindowAsync($proc.MainWindowHandle, 0) | Out-Null; $count++ } }',
      'Write-Output $count',
    ].join('\n');
    return new Promise((resolve) => {
      try {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], { windowsHide: true });
        let output = '';
        child.stdout?.on('data', (b: Buffer) => { output += b.toString(); });
        child.on('close', () => resolve({ hidden: Number(output.trim()) || 0 }));
        setTimeout(() => resolve({ hidden: 0 }), 3000);
      } catch { resolve({ hidden: 0 }); }
    });
  }

  private async sendAction(action: string, params: Record<string, unknown>, timeoutMs = 15000): Promise<OneBotResponse> {
    const socket = this.wsClient ?? [...this.clients][0];
    if (socket && socket.readyState === WebSocket.OPEN) {
      const echo = 'echo_' + uid();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.actionWaiters.delete(echo); reject(new Error('OneBot 指令超时：' + action)); }, timeoutMs);
        this.actionWaiters.set(echo, { resolve, reject, timer });
        try { socket.send(JSON.stringify({ action, params, echo })); } catch (error) { clearTimeout(timer); this.actionWaiters.delete(echo); reject(error as Error); }
      });
    }
    const settings = this.deps.settings.get().napcat;
    const base = settings.oneBotHttpUrl.replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(base + '/' + action, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(settings.webuiToken ? { Authorization: 'Bearer ' + settings.webuiToken } : {}) }, body: JSON.stringify(params), signal: controller.signal });
      const json = await res.json() as OneBotResponse;
      return json;
    } finally { clearTimeout(timer); }
  }

  private target(conversation: Conversation): Record<string, unknown> {
    return conversation.scene === 'group' ? { group_id: conversation.groupId ?? conversation.peerId } : { user_id: conversation.peerId };
  }

  private resolveAsset(url?: string): string | null {
    if (!url) return null;
    if (url.startsWith('file://')) return url.replace('file://', '').replace(/^\/([A-Za-z]:)/, '$1');
    if (url.startsWith('pet://asset/')) {
      const rel = decodeURIComponent(url.slice('pet://asset/'.length));
      const candidates = [path.join(this.deps.paths.petDir, rel), path.join(this.deps.paths.externalPetDir, rel)];
      for (const candidate of candidates) { try { if (fsSync.existsSync(candidate)) return candidate; } catch { /* ignore */ } }
    }
    if (url.startsWith('media://asset/')) {
      const rel = decodeURIComponent(url.slice('media://asset/'.length));
      const file = path.resolve(this.deps.paths.dataDir, 'media', rel);
      if (file.startsWith(path.resolve(this.deps.paths.dataDir, 'media'))) { try { if (fsSync.existsSync(file)) return file; } catch { /* ignore */ } }
    }
    try {
      const parsed = new URL(url);
      if ((parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.pathname.startsWith('/media/')) {
        const rel = decodeURIComponent(parsed.pathname.slice('/media/'.length));
        const file = path.resolve(this.deps.paths.dataDir, 'media', rel);
        if (file.startsWith(path.resolve(this.deps.paths.dataDir, 'media')) && fsSync.existsSync(file)) return file;
      }
    } catch { /* not URL */ }
    return null;
  }

  private async buildSegments(part: { text: string; attachments?: ChatAttachment[] }): Promise<Record<string, unknown>[]> {
    const segments: Record<string, unknown>[] = [];
    if (part.text.trim()) segments.push({ type: 'text', data: { text: part.text.trim() } });
    for (const attachment of part.attachments ?? []) {
      if (attachment.kind === 'image' || attachment.kind === 'sticker') {
        const url = attachment.url ?? '';
        if (url.startsWith('data:image/')) {
          const base64 = url.slice(url.indexOf(',') + 1);
          segments.push({ type: 'image', data: { file: 'base64://' + base64 } });
          continue;
        }
        const file = this.resolveAsset(url) ?? attachment.localPath;
        if (file) {
          try {
            const data = await fs.readFile(file);
            segments.push({ type: 'image', data: { file: 'base64://' + data.toString('base64') } });
          } catch { /* ignore */ }
        } else if (url.startsWith('http')) {
          segments.push({ type: 'image', data: { file: url } });
        }
      } else if (attachment.kind === 'voice') {
        const file = attachment.localPath ?? this.resolveAsset(attachment.url);
        if (file) {
          try {
            const data = await fs.readFile(file);
            segments.push({ type: 'record', data: { file: 'base64://' + data.toString('base64') } });
          } catch { /* ignore */ }
        } else if (attachment.url?.startsWith('http')) {
          segments.push({ type: 'record', data: { file: attachment.url } });
        }
      }
    }
    return segments;
  }

  private outbound: ChatOutbound = {
    available: () => this.status.oneBotConnected && this.status.kind !== 'stopped',
    sendReplies: async (conversation, parts) => {
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        try {
          const segments = await this.buildSegments(part);
          if (!segments.length) continue;
          const action = conversation.scene === 'group' ? 'send_group_msg' : 'send_private_msg';
          const res = await this.sendAction(action, { ...this.target(conversation), message: segments });
          this.deps.observability?.recordNeural({ type: 'reply', node: 'core', target: conversation.scene === 'group' ? 'qq' : 'qq', label: '回复已发送到 QQ', detail: part.text.slice(0, 120) });
          if (res.retcode && res.retcode !== 0) this.log('warn', '发送失败：' + (res.message || res.wording || res.retcode));
          if (i < parts.length - 1) await sleep(700 + Math.random() * 900);
        } catch (error) { this.log('warn', '发送 QQ 消息失败：' + (error as Error).message); }
      }
    },
    sendProactive: async (conversation, parts) => { await this.outbound.sendReplies(conversation, parts); },
  };

  async sendTextTo(target: { scene: 'private' | 'group'; peerId: string; groupId?: string }, text: string): Promise<boolean> {
    try {
      const action = target.scene === 'group' ? 'send_group_msg' : 'send_private_msg';
      const params = target.scene === 'group' ? { group_id: target.groupId ?? target.peerId, message: [{ type: 'text', data: { text } }] } : { user_id: target.peerId, message: [{ type: 'text', data: { text } }] };
      const res = await this.sendAction(action, params);
      return !res.retcode || res.retcode === 0;
    } catch (error) { this.log('warn', '发送消息失败：' + (error as Error).message); return false; }
  }

  async postQzone(content: string, images: string[] = [], ugcRight = 1): Promise<{ ok: boolean; tid?: string; error?: string }> {
    try {
      const imagePayload: string[] = [];
      for (const image of images) {
        if (!image) continue;
        if (/^https?:|^base64:/.test(image)) { imagePayload.push(image); continue; }
        const file = image.startsWith('pet://asset/') ? this.resolveAsset(image) : image;
        if (file && fsSync.existsSync(file)) imagePayload.push('file:///' + file.replace(/\\/g, '/'));
        else if (file) imagePayload.push('base64://' + (await fs.readFile(file)).toString('base64'));
      }
      const res = await this.sendAction('send_qzone_msg', { content, images: imagePayload, ugc_right: ugcRight }, 30000);
      if (res.retcode && res.retcode !== 0) return { ok: false, error: res.message || res.wording || '发布失败' };
      const tid = (res.data as { tid?: string } | undefined)?.tid;
      this.log('info', 'QQ 空间说说已发布' + (tid ? '，tid=' + tid : ''));
      return { ok: true, tid };
    } catch (error) { return { ok: false, error: (error as Error).message }; }
  }

  async command(command: string): Promise<{ ok: boolean; message: string }> {
    const cmd = command.trim();
    if (!cmd) return { ok: false, message: '命令为空' };
    const [head, ...rest] = cmd.split(/\s+/);
    const lower = head.toLowerCase();
    if (['help', '帮助', '?'].includes(lower)) return { ok: true, message: '可用命令：status 查看状态；start/stop/restart 控制进程；qr 获取登录二维码；hide 隐藏 QQ 窗口；diagnostics 诊断；clear 清屏；send <私聊QQ|群号> <内容> 发送测试消息；api <action> <json> 调用 OneBot 接口。其他输入会转发到 NapCat 进程标准输入。' };
    if (['status', '状态'].includes(lower)) { const s = this.getStatus(); return { ok: true, message: `状态：${s.kind}｜QQ：${s.qqOnline ? '在线' : '离线'}｜OneBot：${s.oneBotConnected ? '已连接' : '未连接'}｜运行 ${s.uptimeSec}s` }; }
    if (['登录信息', 'logininfo', 'whoami'].includes(lower)) {
      if (!this.status.oneBotConnected) return { ok: false, message: 'OneBot 尚未连接，无法获取登录信息' };
      try { const res = await this.sendAction('get_login_info', {}, 8000); return { ok: true, message: JSON.stringify(res.data ?? res) }; } catch (error) { return { ok: false, message: (error as Error).message }; }
    }
    if (['重载配置', 'reload', 'reloadconfig'].includes(lower)) {
      if (!this.status.oneBotConnected) return { ok: false, message: 'OneBot 尚未连接；可直接在控制台重启 NapCat 以重载配置' };
      try { const res = await this.sendAction('reload_event', {}, 8000); return { ok: true, message: '已请求重载配置：' + JSON.stringify(res.data ?? res) }; } catch (error) { return { ok: false, message: (error as Error).message }; }
    }
    if (['start', '启动'].includes(lower)) { await this.start(); return { ok: true, message: '启动指令已发送' }; }
    if (['stop', '停止'].includes(lower)) { await this.stop(); return { ok: true, message: '已停止' }; }
    if (['restart', '重启'].includes(lower)) { await this.restart(); return { ok: true, message: '正在重启' }; }
    if (['qr', 'login', '登录'].includes(lower)) { const qr = await this.getQr(); return { ok: !!qr.dataUrl, message: qr.dataUrl ? '二维码已刷新，请查看登录卡片' : '暂时没有二维码，请等待 NapCat 启动并检查日志' }; }
    if (['hide', '隐藏'].includes(lower)) { const r = await this.hideWindows(); return { ok: true, message: `已隐藏 ${r.hidden} 个 QQ 相关窗口` }; }
    if (['diagnostics', '诊断'].includes(lower)) { const d = await this.diagnostics(); return { ok: true, message: d.recommendations.join('；') || '未发现明显问题' }; }
    if (lower === 'clear') { this.logs = []; this.deps.events.emit('napcat:clear', true); return { ok: true, message: '日志已清空' }; }
    if (lower === 'send' && rest.length >= 2) {
      const targetId = rest[0]; const text = rest.slice(1).join(' ');
      const isGroup = /^group[:：]/.test(targetId) || /^\d{6,}$/.test(targetId) && false;
      const target = targetId.replace(/^(group|private)[:：]/, '');
      const ok = await this.sendTextTo({ scene: targetId.startsWith('group') ? 'group' : 'private', peerId: target, groupId: target }, text);
      return { ok, message: ok ? '已发送测试消息' : '发送失败，请检查 OneBot 连接' };
    }
    if (lower === 'api' && rest.length) {
      const action = rest[0]; let params: Record<string, unknown> = {};
      try { params = rest.slice(1).join(' ') ? JSON.parse(rest.slice(1).join(' ')) : {}; } catch { return { ok: false, message: '参数必须是 JSON' }; }
      try { const res = await this.sendAction(action, params, 30000); return { ok: true, message: JSON.stringify(res) }; } catch (error) { return { ok: false, message: (error as Error).message }; }
    }
    if (this.child?.stdin?.writable) { this.child.stdin.write(cmd + '\n'); this.log('info', '> ' + cmd); return { ok: true, message: '命令已转发给 NapCat 进程' }; }
    return { ok: false, message: 'NapCat 未运行，无法转发命令。' };
  }

  async diagnostics(): Promise<NapCatDiagnostics> {
    const s = this.deps.settings.get().napcat;
    const files: NapCatFileStatus[] = [
      { label: '安装目录', path: s.installDir, exists: !!s.installDir && fsSync.existsSync(s.installDir) },
      { label: '启动器', path: s.installDir ? path.join(s.installDir, 'launcher.bat') : '', exists: !!s.installDir && fsSync.existsSync(path.join(s.installDir, 'launcher.bat')) },
      { label: 'OneBot 配置目录', path: s.installDir ? path.join(s.installDir, 'napcat', 'config') : '', exists: !!s.installDir && fsSync.existsSync(path.join(s.installDir, 'napcat', 'config')) },
      { label: '数据目录', path: this.deps.paths.napcatDir, exists: fsSync.existsSync(this.deps.paths.napcatDir) },
    ];
    const ports = await Promise.all([
      { name: 'OneBot WS', port: Number(new URL(s.oneBotWsUrl).port) || 3001 },
      { name: 'OneBot HTTP', port: Number(new URL(s.oneBotHttpUrl).port) || 3000 },
      { name: 'WebUI', port: Number(new URL(s.webuiUrl).port) || 6099 },
    ].map(async (item) => ({ ...item, listening: await this.isPortOpen(item.port) })));
    const qqProcesses = await this.listQQProcesses();
    const recs: string[] = [];
    if (!files[0].exists) recs.push('未配置 NapCat 安装目录，请一键安装或选择已有目录');
    if (!ports[0].listening && !this.status.oneBotConnected) recs.push('OneBot 端口未监听：在 NapCat WebUI 中启用 WebSocket 服务器或反向 WebSocket');
    if (!this.status.qqOnline) recs.push('QQ 未登录：查看登录卡片二维码，或在控制台输入 qr 刷新');
    if (!qqProcesses.length && this.status.kind === 'running') recs.push('未检测到 QQ 进程，可能启动失败，请查看控制台日志');
    return { files, ports, qqProcesses, recommendations: recs };
  }

  private isPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('node:net') as typeof import('node:net');
      const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 600 });
      socket.on('connect', () => { socket.destroy(); resolve(true); });
      socket.on('timeout', () => { socket.destroy(); resolve(false); });
      socket.on('error', () => resolve(false));
    });
  }

  private listQQProcesses(): Promise<{ pid: number; name: string; title?: string; hidden?: boolean }[]> {
    return new Promise((resolve) => {
      try {
        const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', 'Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "^(QQ|QQNT|NapCat|NapCatWinBootMain)$" } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress'], { windowsHide: true });
        let out = '';
        ps.stdout?.on('data', (b: Buffer) => { out += b.toString(); });
        ps.on('close', () => {
          try {
            const parsed = JSON.parse(out.trim() || '[]') as { Id?: number; ProcessName?: string; MainWindowTitle?: string }[] | { Id?: number; ProcessName?: string; MainWindowTitle?: string };
            const list = Array.isArray(parsed) ? parsed : [parsed];
            resolve(list.filter((x) => x.Id).map((x) => ({ pid: Number(x.Id), name: String(x.ProcessName), title: x.MainWindowTitle, hidden: !x.MainWindowTitle })));
          } catch { resolve([]); }
        });
        setTimeout(() => resolve([]), 2500);
      } catch { resolve([]); }
    });
  }

  // ---------------- install ----------------
  async installOneKey(): Promise<NapCatInstallResult> {
    const tempRoot = path.join(this.deps.paths.napcatDir, 'installer');
    await fs.mkdir(tempRoot, { recursive: true });
    this.setStatus({ kind: 'installing' });
    try {
      this.log('info', '正在获取 NapCat 最新版本…');
      const releaseRes = await fetch('https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest', { headers: { 'User-Agent': 'JingJing-App' } });
      if (!releaseRes.ok) throw new Error('访问 GitHub Release 失败：HTTP ' + releaseRes.status);
      const release = await releaseRes.json() as { tag_name?: string; assets?: { name: string; browser_download_url: string; size: number }[] };
      const asset = release.assets?.find((a) => a.name === 'NapCat.Shell.Windows.OneKey.zip') ?? release.assets?.find((a) => a.name.endsWith('.zip'));
      if (!asset) throw new Error('未找到可用的 NapCat 安装包');
      this.log('info', '下载 ' + asset.name + `（${(asset.size / 1024 / 1024).toFixed(1)} MB）`);
      const zipPath = path.join(tempRoot, asset.name);
      const dl = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'JingJing-App' } });
      if (!dl.ok) throw new Error('下载失败：HTTP ' + dl.status);
      const buffer = Buffer.from(await dl.arrayBuffer());
      await fs.writeFile(zipPath, buffer);
      this.log('info', '下载完成，解压安装器…');
      const extractDir = path.join(tempRoot, 'onekey');
      await fs.mkdir(extractDir, { recursive: true });
      await this.run('tar.exe', ['-xf', zipPath, '-C', extractDir], tempRoot, 120000);
      const installer = path.join(extractDir, 'NapCatInstaller.exe');
      if (!fsSync.existsSync(installer)) throw new Error('安装器中缺少 NapCatInstaller.exe');
      this.log('info', '启动 NapCat 官方安装器（窗口已隐藏），完成后自动检测安装目录…');
      let exitCode = 0;
      try { exitCode = await this.run(installer, [], extractDir, 10 * 60_000); } catch (error) { this.log('warn', '安装器退出异常：' + (error as Error).message); }
      const installDir = await this.findInstalledDir([extractDir, path.join(tempRoot, 'onekey'), this.deps.paths.napcatDir]);
      if (!installDir) {
        this.setStatus({ kind: 'stopped' });
        return { ok: false, message: `安装器已退出（码 ${exitCode}），但没有找到 NapCat.Shell 目录。请尝试手动安装，或填写已有目录。`, log: this.getLogs(25).map((l) => l.text) };
      }
      await this.deps.settings.save({ napcat: { ...this.deps.settings.get().napcat, installDir } });
      this.setStatus({ kind: 'stopped', installed: true, installDir });
      this.log('info', 'NapCat 安装完成：' + installDir);
      return { ok: true, installDir, message: 'NapCat 已安装到 ' + installDir, log: this.getLogs(25).map((l) => l.text) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log('error', '安装失败：' + message);
      this.setStatus({ kind: 'error', lastError: message });
      return { ok: false, message, log: this.getLogs(25).map((l) => l.text) };
    }
  }

  private run(file: string, args: string[], cwd: string, timeoutMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } reject(new Error('安装步骤超时')); }, timeoutMs);
      child.stdout?.on('data', (b: Buffer) => b.toString().split(/\r?\n/).forEach((line) => line.trim() && this.log('info', line)));
      child.stderr?.on('data', (b: Buffer) => b.toString().split(/\r?\n/).forEach((line) => line.trim() && this.log('warn', line)));
      child.on('error', (error) => { clearTimeout(timer); reject(error); });
      child.on('exit', (code) => { clearTimeout(timer); resolve(code ?? 0); });
    });
  }

  private async findInstalledDir(roots: string[]): Promise<string | null> {
    for (const root of roots) {
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (!/napcat|shell/i.test(entry.name)) continue;
          const candidate = path.join(root, entry.name);
          if (await this.findLauncher(candidate)) return candidate;
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  private async applyOneBotConfig(uin: string): Promise<void> {
    if (!uin || this.configRestartDone) return;
    const wrote = await this.ensureOneBotConfig(uin);
    if (!wrote || this.status.oneBotConnected) return;
    this.configRestartDone = true;
    try {
      const current = this.deps.settings.get().napcat;
      if (current.botUin !== uin) await this.deps.settings.save({ napcat: { ...current, botUin: uin } });
    } catch { /* ignore */ }
    this.log('warn', 'OneBot 配置已写入，10 秒后自动重启 NapCat 使其生效（通常会自动快速登录）');
    setTimeout(() => {
      if (!this.stopped && !this.status.oneBotConnected) void this.restart().then((s) => this.log('info', 'OneBot 配置重载后状态：' + s.kind));
    }, 10000);
  }

  async ensureOneBotConfig(uin: string): Promise<boolean> {
    if (!uin) return false;
    const installDir = this.deps.settings.get().napcat.installDir;
    if (!installDir) return false;
    const settings = this.deps.settings.get().napcat;
    const versionConfigs: string[] = [];
    try {
      const versionsDir = path.join(installDir, 'versions');
      const versions = await fs.readdir(versionsDir).catch(() => [] as string[]);
      for (const version of versions) versionConfigs.push(path.join(versionsDir, version, 'resources', 'app', 'napcat', 'config'));
    } catch { /* ignore */ }
    const configDirs = [...versionConfigs, path.join(installDir, 'napcat', 'config'), path.join(installDir, 'config'), path.join(installDir, 'bootmain', 'napcat', 'config')];
    let dir = configDirs.find((d) => fsSync.existsSync(d)) ?? configDirs[versionConfigs.length - 1] ?? configDirs[0];
    if (!dir) return false;
    if (!fsSync.existsSync(dir)) {
      try { await fs.mkdir(dir, { recursive: true }); } catch { return false; }
    }
    const config = {
      network: {
        httpServers: [{ name: 'jingjing-http', enable: true, host: '0.0.0.0', port: Number(new URL(settings.oneBotHttpUrl).port) || 3000, enableCors: true, enableWebsocket: false, messagePostFormat: 'array', token: settings.webuiToken, debug: false, heartInterval: 30000, reconnectInterval: 30000 }],
        httpClients: [],
        httpSseServers: [],
        httpSseClients: [],
        websocketServers: [{ name: 'jingjing-ws', enable: true, host: '0.0.0.0', port: Number(new URL(settings.oneBotWsUrl).port) || 3001, messagePostFormat: 'array', reportSelfMessage: false, token: settings.webuiToken, enableForcePushEvent: true, debug: false, heartInterval: 30000 }],
        websocketClients: [{ name: 'jingjing-reverse', enable: true, url: 'ws://127.0.0.1:' + (Number(settings.reverseWsPort) || 3002), token: settings.webuiToken, reconnectInterval: 5000, heartInterval: 30000 }],
      },
      musicSignUrl: '',
      enableLocalFile2Url: false,
      parseMultMsg: true,
      imageDownloadProxy: '',
      timeout: { baseTimeout: 10000, uploadTimeout: 60000, downloadTimeout: 60000 },
      autoDeleteFile: false,
      autoDeleteFileSecond: 60,
      fileLog: false,
      consoleLog: true,
      fileLogLevel: 'debug',
      consoleLogLevel: 'info',
      enableFileLog: false,
    };
    try {
      const target = path.join(dir, 'onebot11_' + uin + '.json');
      let existing: Record<string, unknown> = {};
      try { existing = JSON.parse(await fs.readFile(target, 'utf8')) as Record<string, unknown>; } catch { /* new */ }
      const merged = { ...existing, ...config, network: { ...(existing.network as object ?? {}), ...config.network } };
      await fs.writeFile(target, JSON.stringify(merged, null, 2), 'utf8');
      this.log('info', '已写入 OneBot 配置：' + target);
      return true;
    } catch (error) { this.log('warn', '写入 OneBot 配置失败：' + (error as Error).message); return false; }
  }

  async saveSettings(patch: Partial<ReturnType<SettingsService['get']>['napcat']>): Promise<NapCatStatus> {
    await this.deps.settings.save({ napcat: { ...this.deps.settings.get().napcat, ...patch } });
    if (patch.botUin) await this.ensureOneBotConfig(patch.botUin);
    this.status = { ...this.getStatus(), installDir: this.deps.settings.get().napcat.installDir, webuiUrl: this.deps.settings.get().napcat.webuiUrl };
    this.setStatus({ installed: this.detectInstalledSync() });
    return this.getStatus();
  }

  async shutdown(): Promise<void> { await this.stop(); }
}
