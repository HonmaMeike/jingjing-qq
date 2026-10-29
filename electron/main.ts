import { app, BrowserWindow, Menu, Tray, nativeImage, protocol, net, shell } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvePaths, type AppPaths } from './core/paths';
import { AppServices } from './services/app-services';
import { registerIpcHandlers } from './ipc';
import { IPC_EVENT } from '../shared/ipc';
import type { AppEventName } from '../shared/types';

protocol.registerSchemesAsPrivileged([
  { scheme: 'pet', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let services: AppServices | null = null;
let paths: AppPaths | null = null;
let quitting = false;
let shuttingDown = false;

const gotLock = process.env.JINGJING_SCREENSHOT_DIR ? true : app.requestSingleInstanceLock();
if (!gotLock) app.quit();

app.setAppUserModelId('com.reasonix.jingjing');
if (process.env.JINGJING_DATA_DIR) {
  try { app.setPath('userData', path.join(process.env.JINGJING_DATA_DIR, '_electron-profile')); } catch { /* ignore */ }
}
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function isSafePath(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const MIME_TYPES: Record<string, string> = { '.webm': 'video/webm', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg' };

async function serveFile(file: string, request: Request): Promise<Response> {
  const { readFile, stat } = await import('node:fs/promises');
  const info = await stat(file);
  const total = info.size;
  const type = MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = request.headers.get('range');
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      let start = match[1] ? Number(match[1]) : 0;
      let end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
      if (Number.isNaN(start) || start < 0) start = 0;
      if (end < start) end = total - 1;
      const data = await readFile(file);
      const body = data.subarray(start, end + 1);
      return new Response(body, { status: 206, headers: { 'Content-Type': type, 'Content-Length': String(body.byteLength), 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' } });
    }
  }
  const data = await readFile(file);
  return new Response(data, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(data.byteLength), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=3600' } });
}

function registerAssetProtocols(appPaths: AppPaths): void {
  protocol.handle('pet', async (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const settings = services?.settings.get();
      const roots = [settings?.general.assetsPath, appPaths.defaultExternalPetDir, appPaths.bundledPetDir].filter(Boolean) as string[];
      for (const root of roots) {
        const file = path.resolve(root, rel);
        if (isSafePath(root, file)) {
          try {
            const { stat } = await import('node:fs/promises');
            if ((await stat(file)).isFile()) return serveFile(file, request);
          } catch { /* next */ }
        }
      }
      return new Response('Pet asset not found', { status: 404 });
    } catch (error) { console.error('[pet protocol] failed', request.url, error); return new Response('Bad request', { status: 400 }); }
  });
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const root = path.join(appPaths.dataDir, 'media');
      const file = path.resolve(root, rel);
      if (!isSafePath(root, file)) return new Response('Forbidden', { status: 403 });
      try { return await serveFile(file, request); } catch (error) { console.error('[media protocol] failed', request.url, error); return new Response('Media not found', { status: 404 }); }
    } catch (error) { console.error('[media protocol] outer', request.url, error); return new Response('Bad request', { status: 400 }); }
  });
  protocol.handle('demo', async (request) => {
    try {
      const url = new URL(request.url);
      const key = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'demo';
      const memes = ['可爱.png', '得意.png', '吃饱饱摸肚子.png', '哦鲸鲸.png', '厉害了我的鲸.png', '先养着吧.png'];
      let hash = 0; for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
      const file = path.join(appPaths.bundledPetDir, 'memes', memes[hash % memes.length]);
      return await serveFile(file, request);
    } catch { return new Response('Demo avatar not found', { status: 404 }); }
  });
}

function forwardEvents(win: BrowserWindow): void {
  if (!services) return;
  const channels: string[] = [
    'toast', 'chat:message', 'chat:typing', 'napcat:log', 'napcat:status', 'napcat:qr',
    'activity:new', 'growth:update', 'persona:change', 'memory:update', 'settings:update',
    'integration:status', 'app:navigate', 'app:ready', 'emotion:change', 'theme:change', 'napcat:clear',
    'neural:event', 'neural:snapshot', 'usage:update', 'consciousness:update', 'stickers:update',
  ];
  for (const channel of channels) {
    services.events.on(channel, (payload) => {
      if (!win.isDestroyed()) win.webContents.send(IPC_EVENT, { channel, payload });
    });
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1460,
    height: 930,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    frame: false,
    title: '鲸鲸 · QQ 智能伙伴',
    backgroundColor: '#07111f',
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  win.setMenuBarVisibility(false);
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  win.once('ready-to-show', () => {
    win.show();
    win.webContents.send(IPC_EVENT, { channel: 'app:ready', payload: { version: app.getVersion() } });
    if (process.env.JINGJING_SCREENSHOT_DIR) setTimeout(() => { void captureScreenshots(win); }, 1800);
  });
  win.on('maximize', () => win.webContents.send('window:maximized-change', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized-change', false));
  win.on('close', (event) => {
    if (quitting || !services) return;
    const s = services.settings.get();
    if (s.general.closeToTray) { event.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { mainWindow = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.JINGJING_TEST_LOG === '1') {
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      console.log('[renderer:' + level + '] ' + message + ' (' + sourceId + ':' + line + ')');
    });
  }
  win.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith('http://127.0.0.1:5273') || url.startsWith('file://');
    if (!allowed) event.preventDefault();
  });
  if (process.env.NODE_ENV === 'development' && process.env.JINGJING_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

async function captureScreenshots(win: BrowserWindow): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const dir = process.env.JINGJING_SCREENSHOT_DIR as string;
  await mkdir(dir, { recursive: true });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const shot = async (name: string, route?: string, extra?: () => Promise<void>) => {
    if (route) { await win.webContents.executeJavaScript("location.hash = '#/" + route + "'"); await wait(1000); }
    if (extra) { await extra(); await wait(900); }
    const image = await win.webContents.capturePage();
    await writeFile(path.join(dir, name + '.png'), image.toPNG());
    console.log('[screenshot]', name);
  };
  try {
    await wait(1400);
    win.show();
    win.focus();
    await shot('00-onboarding', 'dashboard');
    await win.webContents.executeJavaScript("window.jingjing.invoke('app:complete-onboarding', { done: true })");
    await wait(600);
    win.webContents.reload();
    await wait(2200);
    await shot('01-dashboard', 'dashboard');
    await shot('02-chat', 'chat');
    await shot('03-personas', 'personas');
    await shot('04-memory', 'memory');
    await shot('05-growth', 'growth');
    await shot('06-plugins', 'plugins');
    await shot('07-napcat', 'napcat');
    await shot('08-settings', 'settings');
    try {
      await win.webContents.executeJavaScript(`(() => { const buttons = Array.from(document.querySelectorAll('button')); const target = buttons.find((b) => (b.textContent || '').includes('API 密钥')); if (target) target.click(); return !!target; })()`);
      await wait(900);
      await shot('09-settings-keys');
    } catch (error) { console.log('[screenshot] keys tab failed', error); }
    try {
      await win.webContents.executeJavaScript(`(() => { const buttons = Array.from(document.querySelectorAll('button')); const target = buttons.find((b) => (b.textContent || '').includes('模型与语音')); if (target) target.click(); return !!target; })()`);
      await wait(1000);
      await shot('13-settings-models');
    } catch (error) { console.log('[screenshot] models tab failed', error); }
    try {
      await win.webContents.executeJavaScript(`(() => { const buttons = Array.from(document.querySelectorAll('button')); const target = buttons.find((b) => (b.textContent || '').includes('上下文与数据')); if (target) target.click(); return !!target; })()`);
      await wait(900);
      await shot('15-settings-data');
    } catch (error) { console.log('[screenshot] data tab failed', error); }
    await shot('14-stickers', 'stickers');
    await shot('10-consciousness', 'consciousness');
    try {
      await win.webContents.executeJavaScript(`(async () => { const boot = await window.jingjing.invoke('app:bootstrap'); const conv = boot.data?.conversations?.[0]; if (conv) await window.jingjing.invoke('chat:send', { conversationId: conv.id, text: '鲸鲸，今天想听你说说昨天的事。' }); })()`);
      await wait(2200);
    } catch (error) { console.log('[screenshot] neural seed failed', error); }
    await shot('11-neural', 'neural');
    await shot('12-costs', 'costs');
    console.log('[screenshot] done');
  } catch (error) {
    console.error('[screenshot] failed', error);
  } finally {
    setTimeout(() => { quitting = true; app.quit(); setTimeout(() => app.exit(0), 1500); }, 600);
  }
}

function createTray(): void {
  try {
    const iconPath = path.join(app.getAppPath(), 'resources', 'icon.png');
    const image = nativeImage.createFromPath(iconPath);
    tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 20, height: 20 }));
    const menu = Menu.buildFromTemplate([
      { label: '显示鲸鲸', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
      { label: '隐藏到托盘', click: () => mainWindow?.hide() },
      { type: 'separator' },
      { label: 'NapCat 控制台', click: () => { mainWindow?.show(); mainWindow?.webContents.send(IPC_EVENT, { channel: 'app:navigate', payload: { route: 'napcat' } }); } },
      { label: '设置', click: () => { mainWindow?.show(); mainWindow?.webContents.send(IPC_EVENT, { channel: 'app:navigate', payload: { route: 'settings' } }); } },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ]);
    tray.setToolTip('鲸鲸 · QQ 智能伙伴');
    tray.setContextMenu(menu);
    tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
  } catch { /* tray optional */ }
}

async function bootstrap(): Promise<void> {
  paths = resolvePaths();
  services = new AppServices(paths);
  await services.init();
  registerAssetProtocols(paths);
  registerIpcHandlers(services, () => mainWindow);
  mainWindow = createWindow();
  forwardEvents(mainWindow);
  createTray();
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '文件', submenu: [{ label: '打开数据目录', click: () => void shell.openPath(paths!.dataDir) }, { type: 'separator' }, { label: '退出', click: () => { quitting = true; app.quit(); } }] },
    { label: '视图', submenu: [{ role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' }, { role: 'resetZoom', label: '重置缩放' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }] },
    { label: '帮助', submenu: [{ label: 'BreezeBlue 文档', click: () => void shell.openExternal('https://docs.breezeblue.ai/guides/audio-tags#simplified-chinese-zh') }, { label: 'Suno API 文档', click: () => void shell.openExternal('https://docs.sunoapi.org/') }, { label: 'NapCat 文档', click: () => void shell.openExternal('https://napneko.github.io/') }] },
  ]));
}

app.whenReady().then(async () => {
  try { await bootstrap(); }
  catch (error) {
    console.error('启动失败', error);
    const { dialog } = await import('electron');
    dialog.showErrorBox('鲸鲸启动失败', error instanceof Error ? error.stack ?? error.message : String(error));
    app.quit();
  }
});

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); } });

app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void bootstrap(); else mainWindow?.show(); });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!tray || quitting) app.quit();
  }
});

app.on('before-quit', (event) => {
  quitting = true;
  if (shuttingDown || !services) return;
  event.preventDefault();
  shuttingDown = true;
  void services.shutdown().catch(() => undefined).finally(() => app.exit(0));
});
