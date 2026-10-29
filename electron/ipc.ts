import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { IPC_INVOKE } from '../shared/ipc';
import type { IpcMethodMap, IpcResponse } from '../shared/ipc';
import type { ActivityType, ChatMessage, ChatSendParams, GeneratePersonaParams, Persona, ServiceId } from '../shared/types';
import type { AppServices } from './services/app-services';
import { DEFAULT_SETTINGS } from './config/defaults';
import { BUILTIN_PERSONAS } from '../shared/personas';
import { buildPersonaGenerationPrompt, buildPersonaSystemPrompt } from '../shared/persona-prompts';
import { personaVocalGender } from './services/chat-shared';
import { nowIso, safeJsonParse, uid } from './core/utils';

type Handler<M extends keyof IpcMethodMap> = (params: IpcMethodMap[M]['params']) => Promise<IpcMethodMap[M]['result']> | IpcMethodMap[M]['result'];

let getWindowRef: () => BrowserWindow | null = () => null;

export function registerIpcHandlers(services: AppServices, getWindow: () => BrowserWindow | null): void {
  getWindowRef = getWindow;
  ipcMain.handle(IPC_INVOKE, async (_event, req: { method: keyof IpcMethodMap; params: unknown }) => {
    try {
      const data = await dispatch(services, req.method, req.params);
      return { ok: true, data } satisfies IpcResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      services.logger.error('ipc', String(req.method), message);
      return { ok: false, error: message, code: (error as { code?: string }).code } satisfies IpcResponse;
    }
  });

  ipcMain.handle('window:minimize', () => { getWindowRef()?.minimize(); });
  ipcMain.handle('window:toggle-maximize', () => { const win = getWindowRef(); if (!win) return false; if (win.isMaximized()) { win.unmaximize(); return false; } win.maximize(); return true; });
  ipcMain.handle('window:is-maximized', () => getWindowRef()?.isMaximized() ?? false);
  ipcMain.handle('window:close', () => { getWindowRef()?.close(); });
}

const handlers: { [M in keyof IpcMethodMap]?: Handler<M> } = {
  'app:bootstrap': async () => currentServices.buildBootstrap(),
  'media:creations': async () => services0!.listCreations(),
  'app:stats': async () => currentServices.stats(),
  'app:info': async () => ({ version: app.getVersion(), electron: process.versions.electron, platform: process.platform, dataDir: currentServices.paths.dataDir, logFile: currentServices.logger.logFile }),
  'app:complete-onboarding': async ({ done }) => services0!.settings.save({ onboardingDone: done }).then((r) => r.settings),
  'app:open-external': async ({ url }) => { if (!/^https?:\/\//i.test(url)) throw new Error('只允许打开 http(s) 链接'); await shell.openExternal(url); return true; },
  'app:open-path': async ({ path: target }) => { const p = target || services0!.paths.dataDir; await shell.openPath(p); return true; },
  'app:quit': async () => { setImmediate(() => app.quit()); return true; },
  'app:reset-data': async () => {
    const result = await services0!.resetUserData();
    setTimeout(() => { app.relaunch(); app.exit(0); }, 700);
    return result;
  },

  'settings:get': async () => ({ settings: services0!.settings.get(), keyStatus: services0!.settings.getKeyStatus(), maskedKeys: { deepseek: services0!.settings.maskSecret('deepseek'), breezeblue: services0!.settings.maskSecret('breezeblue'), minimax: services0!.settings.maskSecret('minimax'), suno: services0!.settings.maskSecret('suno'), serper: services0!.settings.maskSecret('serper') } }),
  'settings:save': async ({ patch, secrets }) => {
    const res = await services0!.settings.save(patch ?? {}, secrets);
    if (patch?.models?.breezeVoiceId !== undefined) {
      await services0!.bindActiveVoice(patch.models.breezeVoiceId, patch.models.breezeVoiceName ?? '');
    }
    services0!.hub.rebuild();
    try { app.setLoginItemSettings({ openAtLogin: res.settings.general.autoLaunch }); } catch { /* ignore */ }
    return res;
  },
  'settings:test': async ({ service }) => services0!.hub.test(service),
  'settings:clear-demo': async () => ({ ok: true, removed: await services0!.conversations.removeDemo() }),
  'settings:reset': async () => {
    await services0!.settings.save(DEFAULT_SETTINGS as never, { deepseek: '', breezeblue: '', minimax: '', suno: '', serper: '' });
    services0!.hub.rebuild();
    const res = { settings: services0!.settings.get(), keyStatus: services0!.settings.getKeyStatus() };
    return res;
  },
  'settings:export': async () => {
    const desktop = app.getPath('desktop');
    const zip = path.join(desktop, '鲸鲸备份-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.zip');
    const ps = 'Compress-Archive -Path ' + JSON.stringify(path.join(services0!.paths.dataDir, '*')) + ' -DestinationPath ' + JSON.stringify(zip) + ' -Force';
    await new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true });
      child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('备份失败，退出码 ' + code)));
    });
    return { ok: true, path: zip };
  },
  'settings:pick-assets': async () => {
    const win = getWindowRef();
    const result = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择 dsh-pet-assets 素材目录' }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) throw new Error('未选择目录');
    await services0!.settings.save({ general: { ...services0!.settings.get().general, assetsPath: result.filePaths[0] } });
    await services0!.settings.save({});
    (services0! as unknown as { petAssets: unknown }).petAssets = await (services0! as unknown as { loadPetAssets: () => Promise<unknown> }).loadPetAssets();
    return { path: result.filePaths[0] };
  },

  'personas:list': async () => services0!.personas.list(),
  'personas:set-active': async ({ personaId }) => {
    return services0!.switchPersona(personaId);
  },
  'personas:save': async ({ persona }) => {
    const saved = await services0!.personas.save(persona);
    return saved;
  },
  'personas:delete': async ({ personaId }) => { await services0!.personas.remove(personaId); return { ok: true }; },
  'personas:generate': async (params) => generatePersona(services0!, params),
  'personas:preview-prompt': async ({ personaId }) => {
    const persona = personaId ? services0!.personas.get(personaId) : services0!.personas.active();
    if (!persona) throw new Error('人设不存在');
    const prompt = buildPersonaSystemPrompt({ persona, scene: 'private', userName: '示例用户', userRole: 'owner', emotion: services0!.emotion.get(persona.id), growth: services0!.growth.get(persona.id), replyLength: services0!.settings.get().persona.replyLength, now: new Date() });
    return { prompt, tokens: Math.ceil(prompt.length * 1.1) };
  },

  'chat:conversations': async () => services0!.chat.listConversations(),
  'chat:messages': async ({ conversationId, limit }) => { await services0!.chat.markRead(conversationId); return services0!.chat.getMessages(conversationId, limit ?? 200); },
  'chat:share-creation': async (params) => services0!.chat.shareCreation(params),
  'chat:send': async (params) => services0!.chat.send(params),
  'chat:create': async ({ peerName, scene, peerId, demo }) => services0!.chat.createConversation({ peerName, scene, peerId, demo }),
  'chat:clear': async ({ conversationId }) => { await services0!.chat.clear(conversationId); return { ok: true }; },
  'chat:delete': async ({ conversationId }) => { await services0!.chat.remove(conversationId); return { ok: true }; },
  'chat:set-persona': async ({ conversationId, personaId }) => services0!.chat.setPersona(conversationId, personaId),
  'chat:simulate': async ({ conversationId, text }) => services0!.chat.send({ conversationId, text }),

  'memory:summary': async () => services0!.memory.getSummary(),
  'memory:read': async ({ docId }) => services0!.memory.readDoc(docId),
  'memory:save': async ({ docId, markdown }) => { await services0!.memory.store.updateManualNote(docId, markdown); return services0!.memory.readDoc(docId); },
  'memory:search': async ({ query }) => services0!.memory.search(query, { topK: 20 }),
  'memory:forget': async ({ docId, factId }) => { if (factId) await services0!.memory.forgetFact(docId, factId); return services0!.memory.readDoc(docId); },
  'memory:delete': async ({ docId }) => ({ ok: await services0!.memory.forgetDoc(docId) }),
  'memory:open-folder': async () => { await shell.openPath(services0!.paths.memoriesDir); return true; },
  'memory:relationship': async ({ docId }) => { const result = await services0!.memory.readDoc(docId); return result.doc.relationship; },

  'growth:overview': async () => services0!.autonomy.overview(),
  'growth:trigger': async ({ kind, force }) => services0!.autonomy.trigger(kind as ActivityType, force),
  'growth:diary-generate': async ({ force }) => services0!.autonomy.generateDiary(force),
  'growth:diary-list': async () => services0!.content.listDiaries(services0!.settings.get().persona.activeId),
  'growth:diary-read': async ({ id }) => { const d = await services0!.content.readDiary(id); if (!d) throw new Error('日记不存在'); return d; },
  'growth:qzone-generate': async ({ prompt, autoPost }) => services0!.autonomy.generateQzone(prompt, autoPost),
  'growth:qzone-list': async () => services0!.content.listQzone(services0!.settings.get().persona.activeId),
  'growth:bili-refresh': async () => { await services0!.autonomy.trigger('bilibili', true); return services0!.content.listBili(services0!.settings.get().persona.activeId); },
  'growth:learn': async ({ topic }) => services0!.autonomy.learn(topic),
  'growth:activity-list': async ({ limit }) => services0!.content.listActivities(limit ?? 30, services0!.settings.get().persona.activeId),

  'plugins:list': async () => services0!.plugins.list(),
  'plugins:toggle': async ({ pluginId, enabled }) => services0!.plugins.toggle(pluginId, enabled),
  'plugins:configure': async ({ pluginId, config }) => services0!.plugins.configure(pluginId, config),
  'plugins:run': async ({ pluginId, action }) => services0!.plugins.run(pluginId, action),
  'plugins:import': async () => {
    const win = getWindowRef();
    const result = await dialog.showOpenDialog(win ?? undefined!, { title: '导入插件清单', filters: [{ name: '插件清单', extensions: ['json'] }], properties: ['openFile'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const raw = await fs.readFile(result.filePaths[0], 'utf8');
    const manifest = safeJsonParse<Record<string, unknown>>(raw, {});
    return services0!.plugins.importManifest(manifest);
  },
  'plugins:open-folder': async () => {
    const dir = path.join(services0!.paths.dataDir, 'plugins');
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return true;
  },

  'napcat:status': async () => services0!.napcat.getStatus(),
  'napcat:install': async ({ method }) => {
    if (method === 'existing') {
      const win = getWindowRef();
      const result = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'], title: '选择 NapCat 或 Shell 安装目录' }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return { ok: false, message: '未选择目录' };
      await services0!.napcat.saveSettings({ installDir: result.filePaths[0] });
      return { ok: true, installDir: result.filePaths[0], message: '已设置 NapCat 目录' };
    }
    return services0!.napcat.installOneKey();
  },
  'napcat:start': async () => services0!.napcat.start(),
  'napcat:stop': async () => services0!.napcat.stop(),
  'napcat:restart': async () => services0!.napcat.restart(),
  'napcat:command': async ({ command }) => services0!.napcat.command(command),
  'napcat:logs': async ({ limit }) => services0!.napcat.getLogs(limit ?? 300),
  'napcat:diagnostics': async () => services0!.napcat.diagnostics(),
  'napcat:save': async ({ config }) => services0!.napcat.saveSettings(config),
  'napcat:hide-windows': async () => services0!.napcat.hideWindows(),
  'napcat:open-webui': async ({ url }) => {
  if (!/^https?:\/\//i.test(url)) throw new Error('WebUI 地址必须是 http(s)');
  const win = new BrowserWindow({ width: 1240, height: 860, minWidth: 900, minHeight: 640, title: 'NapCat WebUI · 鲸鲸内嵌窗口', autoHideMenuBar: true, backgroundColor: '#0b1522', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await win.loadURL(url);
  win.show();
  return true;
},
  'napcat:qr': async () => services0!.napcat.getQr(),

  'integrations:status': async () => services0!.hub.status(),
  'integrations:voices': async ({ refresh }) => {
    const result = await services0!.hub.listVoices(!!refresh);
    const settings = services0!.settings.get();
    const chosen = settings.models.breezeVoiceId ? result.voices.find((v) => v.voiceId === settings.models.breezeVoiceId) : undefined;
    if ((!settings.models.breezeVoiceId || !chosen) && result.latestVoiceId) {
      const latest = result.voices.find((v) => v.voiceId === result.latestVoiceId);
      await services0!.settings.save({ models: { ...settings.models, breezeVoiceId: result.latestVoiceId, breezeVoiceName: latest?.name ?? '最新音色' } });
    }
    return result;
  },
  'integrations:test': async ({ service }) => services0!.hub.test(service as ServiceId),
  'integrations:search': async ({ query, type }) => services0!.hub.search(query, type ?? 'search'),
  'integrations:image': async ({ prompt, aspectRatio }) => services0!.hub.generateImage(prompt, aspectRatio, services0!.personas.active()),
  'integrations:video': async ({ prompt, duration, resolution }) => services0!.hub.generateVideo(prompt, duration, resolution, services0!.personas.active()),
  'integrations:music': async (params) => { const active = services0!.personas.active(); return services0!.hub.generateMusic({ ...params, vocalGender: params.vocalGender ?? (active ? personaVocalGender(active) : 'f') }); },
  'integrations:tts': async ({ text, personaId, voiceId }) => {
    const persona = (personaId ? services0!.personas.get(personaId) : services0!.personas.active()) ?? services0!.personas.active();
    return services0!.hub.synthesize(text, persona, voiceId);
  },
  'integrations:bili': async () => {
    const persona = services0!.personas.active();
    const settings = services0!.settings.get();
    try {
      const videos = await services0!.hub.biliDiscover(settings.bilibili.interests, settings.bilibili.fetchLimit);
      for (const video of videos.slice(0, 6)) {
        await services0!.content.addBili({ id: uid('bili-'), title: video.title, url: video.url, cover: video.cover, upName: video.upName, play: video.play, duration: video.duration, reason: '刷到「' + video.title.slice(0, 20) + '」', comment: '这个有点意思，鲸鲸停下来看了。', createdAt: nowIso(), personaId: persona.id });
      }
      return services0!.content.listBili(services0!.settings.get().persona.activeId);
    } catch (error) { throw new Error('B站暂时无法访问：' + (error as Error).message); }
  },

  'pet:list': async () => services0!.petAssets,

  'neural:snapshot': async () => services0!.observability.snapshot(),
  'neural:clear': async () => { services0!.observability.clearEvents(); return { ok: true }; },
  'usage:summary': async () => services0!.observability.usageSummary(),
  'usage:list': async ({ limit }) => services0!.observability.listUsage(limit ?? 200),
  'usage:balances': async () => services0!.hub.getBalances(),
  'usage:clear': async () => { await services0!.observability.clearUsage(); return { ok: true }; },
  'usage:billing': async ({ billing }) => {
    const current = services0!.settings.get();
    const saved = await services0!.settings.save({ billing: { ...current.billing, ...billing } });
    return { settings: saved.settings, summary: services0!.observability.usageSummary() };
  },

  'consciousness:overview': async () => services0!.consciousness.overview(),
  'consciousness:search': async ({ query, limit }) => services0!.consciousness.search(query, { limit: limit ?? 20 }),
  'consciousness:resume': async () => { const result = await services0!.consciousness.resume(); return { brief: result.brief, overview: result.overview }; },

  'stickers:overview': async () => services0!.stickers.overview(),
  'stickers:save': async (input) => services0!.stickers.saveDataUrl(input),
  'stickers:update': async ({ id, patch }) => services0!.stickers.update(id, patch),
  'stickers:delete': async ({ id }) => services0!.stickers.remove(id),
  'stickers:collect': async () => services0!.stickers.collectNow(),
  'stickers:settings': async (patch) => services0!.stickers.setSettings(patch ?? {}),
};

let services0: AppServices | null = null;
let currentServices: AppServices;

async function dispatch(services: AppServices, method: keyof IpcMethodMap, params: unknown): Promise<unknown> {
  services0 = services;
  currentServices = services;
  const fn = handlers[method] as ((p: unknown) => unknown) | undefined;
  if (!fn) throw new Error('未知的 IPC 方法：' + method);
  return fn(params ?? {});
}

async function generatePersona(services: AppServices, params: GeneratePersonaParams): Promise<Persona> {
  const base = BUILTIN_PERSONAS.find((p) => p.id === params.baseId) ?? BUILTIN_PERSONAS[0];
  const fallback = (): Persona => ({
    ...base,
    id: uid('persona-'),
    name: params.name,
    nickname: params.name,
    title: params.traits.slice(0, 18) + ' · 鲸落海新成员',
    tagline: params.style,
    description: params.userPrompt || ('以鲸鲸为模板诞生的新人格：' + params.traits),
    baseTemplateId: base.id,
    isBuiltin: false,
    traits: params.traits.split(/[,，、]/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    catchphrases: ['……让我想想。', '鲸落海今天也很安静。'],
    quirks: ['说话时会不自觉地晃尾巴'],
    temper: '温和，但有自己的底线。',
    background: '从鲸鲸的原始模板中长出的新人格，带着自己的小秘密来到鲸落海。',
    speechStyle: params.style,
    relationshipStyle: '慢慢熟悉，认真对待每一次对话。',
    boundaries: base.boundaries,
    interests: base.interests,
    examples: base.examples,
    corePrompt: base.corePrompt + '\n\n【新人格分支】你是以鲸鲸为模板诞生的新个体，名字叫' + params.name + '。你的性格关键词：' + params.traits + '。说话风格：' + params.style + '。' + (params.userPrompt ? '补充：' + params.userPrompt : ''),
    greeting: '你好呀，我是' + params.name + '。',
    tts: { ...base.tts },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  if (!services.settings.hasSecret('deepseek')) return services.personas.save(fallback());
  try {
    const prompt = buildPersonaGenerationPrompt(params, base);
    const result = await services.hub.clients.deepseek.chat([
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ], { model: services.settings.get().models.deepseekChat, temperature: 1.0, maxTokens: 3000, jsonMode: true, timeoutMs: 120000 });
    const parsed = safeJsonParse<Partial<Persona>>(result.content, {});
    const persona = fallback();
    const merged: Persona = {
      ...persona,
      ...parsed,
      id: uid('persona-'), name: params.name, nickname: parsed.nickname || params.name,
      baseTemplateId: params.baseId, isBuiltin: false, createdAt: nowIso(), updatedAt: nowIso(),
      traits: Array.isArray(parsed.traits) && parsed.traits.length ? parsed.traits : persona.traits,
      catchphrases: Array.isArray(parsed.catchphrases) && parsed.catchphrases.length ? parsed.catchphrases : persona.catchphrases,
      quirks: Array.isArray(parsed.quirks) && parsed.quirks.length ? parsed.quirks : persona.quirks,
      examples: Array.isArray(parsed.examples) && parsed.examples.length ? parsed.examples : persona.examples,
      boundaries: Array.isArray(parsed.boundaries) && parsed.boundaries.length ? parsed.boundaries : persona.boundaries,
      likes: Array.isArray(parsed.likes) ? parsed.likes : persona.likes,
      dislikes: Array.isArray(parsed.dislikes) ? parsed.dislikes : persona.dislikes,
      interests: Array.isArray(parsed.interests) ? parsed.interests : persona.interests,
      corePrompt: typeof parsed.corePrompt === 'string' && parsed.corePrompt.length > 200 ? parsed.corePrompt : persona.corePrompt,
      tts: { ...persona.tts, ...(parsed.tts ?? {}) },
    };
    return services.personas.save(merged);
  } catch (error) {
    services.logger.warn('personas', 'AI 生成人设失败，使用模板:', (error as Error).message);
    return services.personas.save(fallback());
  }
}
