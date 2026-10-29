import type { PluginConfigField, PluginInfo } from '../../shared/types';
import type { SettingsService } from './settings';
import type { IntegrationHub } from './integration-hub';
import type { NapCatService } from './napcat';
import type { AutonomyService } from './autonomy';
import type { MemoryService } from './memory';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

interface PluginDefinition {
  id: string; name: string; version: string; description: string; category: PluginInfo['category']; icon: string;
  actions?: PluginInfo['actions']; fields?: PluginConfigField[];
  configured?: () => boolean;
  run?: (action: string) => Promise<{ ok: boolean; message: string; data?: unknown }>;
  getConfig?: () => Record<string, unknown>;
  setConfig?: (config: Record<string, unknown>) => Promise<void>;
}

export class PluginService {
  constructor(private deps: {
    settings: SettingsService; hub: IntegrationHub; napcat: NapCatService; autonomy: AutonomyService; memory: MemoryService; dataDir?: string;
  }) {}

  private get pluginsDir(): string { return path.join(this.deps.dataDir || '', 'plugins'); }

  private externalDefs(): PluginInfo[] {
    const root = this.pluginsDir;
    if (!root) return [];
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return []; }
    const plugins: PluginInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'plugin.json'), 'utf8')) as Record<string, unknown>;
        const id = String(manifest.id || entry.name).replace(/[^a-zA-Z0-9_-]/g, '-');
        if (!id || !manifest.name) continue;
        const enabled = this.deps.settings.get().plugins[id]?.enabled ?? true;
        plugins.push({
          id, name: String(manifest.name), version: String(manifest.version || '0.1.0'),
          description: String(manifest.description || '外部插件（由插件目录加载）'),
          category: (manifest.category as PluginInfo['category']) || 'utility',
          icon: String(manifest.icon || 'puzzle'), enabled, builtin: false,
          configured: true, status: enabled ? 'ready' : 'disabled',
          actions: Array.isArray(manifest.actions) ? manifest.actions as PluginInfo['actions'] : [],
          configFields: Array.isArray(manifest.configFields) ? manifest.configFields as PluginInfo['configFields'] : [],
          config: (manifest.config as Record<string, unknown>) || {},
        });
      } catch { /* ignore invalid */ }
    }
    return plugins;
  }

  async importManifest(manifest: Record<string, unknown>): Promise<PluginInfo> {
    const rawId = String(manifest.id || '').trim();
    const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '-');
    if (!id || !manifest.name) throw new Error('插件清单缺少 id 或 name');
    const dir = path.join(this.pluginsDir, id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
    const found = this.externalDefs().find((item) => item.id === id);
    if (!found) throw new Error('导入后无法读取插件清单');
    return found;
  }

  private defs(): PluginDefinition[] {
    const s = this.deps.settings;
    const keys = s.getKeyStatus();
    return [
      {
        id: 'deepseek', name: 'DeepSeek 大脑', version: '1.0.0', category: 'core', icon: 'brain',
        description: '对话、人设推理、记忆抽取、日记与自主活动的核心大脑。支持 DeepSeek V4 Pro / V4.1 Flash 与 thinking 模式。',
        configured: () => keys.deepseek,
        fields: [
          { key: 'model', label: '对话模型', type: 'select', options: [{ label: 'deepseek-flash · V4.1 Flash（默认省钱）', value: 'deepseek-flash' }, { label: 'deepseek-v4-pro · V4 Pro（更贵）', value: 'deepseek-v4-pro' }], default: 'deepseek-flash' },
          { key: 'temperature', label: '创意温度', type: 'number', description: '0.8—1.3 之间更像真人，过高容易跑题', default: 1.15 },
          { key: 'maxTokens', label: '单次最大 Token', type: 'number', default: 1200 },
        ],
        getConfig: () => ({ model: s.get().models.deepseekChat, temperature: s.get().deepseek.temperature, maxTokens: s.get().deepseek.maxTokens }),
        setConfig: async (config) => {
          await s.save({ models: { ...s.get().models, deepseekChat: String(config.model ?? 'deepseek-flash') }, deepseek: { ...s.get().deepseek, temperature: Number(config.temperature) || 1.15, maxTokens: Number(config.maxTokens) || 1200 } });
        },
        actions: [{ id: 'test', label: '测试连接' }],
        run: async (action) => action === 'test' ? this.test('deepseek') : { ok: false, message: '未知操作' },
      },
      {
        id: 'napcat', name: 'NapCat QQ 通道', version: '1.0.0', category: 'channel', icon: 'terminal',
        description: '内嵌 NapCat 协议端：QQ 私聊/群聊、图片语音发送、QQ 空间说说。所有控制与二维码都在软件内完成。',
        configured: () => !!s.get().napcat.installDir,
        fields: [
          { key: 'autoStart', label: '随软件启动', type: 'boolean', default: false },
          { key: 'hideQQWindows', label: '隐藏 QQ 原生窗口', type: 'boolean', default: true },
          { key: 'botUin', label: '机器人 QQ 号', type: 'text', placeholder: '用于生成 OneBot 配置' },
        ],
        getConfig: () => ({ autoStart: s.get().napcat.autoStart, hideQQWindows: s.get().napcat.hideQQWindows, botUin: s.get().napcat.botUin }),
        setConfig: async (config) => { await this.deps.napcat.saveSettings({ autoStart: !!config.autoStart, hideQQWindows: !!config.hideQQWindows, botUin: String(config.botUin ?? '') }); },
        actions: [{ id: 'start', label: '启动 NapCat' }, { id: 'stop', label: '停止' }, { id: 'status', label: '查看状态' }],
        run: async (action) => {
          if (action === 'start') { const st = await this.deps.napcat.start(); return { ok: true, message: 'NapCat 状态：' + st.kind }; }
          if (action === 'stop') { await this.deps.napcat.stop(); return { ok: true, message: 'NapCat 已停止' }; }
          const st = this.deps.napcat.getStatus(); return { ok: true, message: 'NapCat：' + st.kind + '｜QQ：' + (st.qqOnline ? '在线' : '离线'), data: st };
        },
      },
      {
        id: 'breezeblue', name: 'BreezeBlue 语音', version: '1.0.0', category: 'creation', icon: 'mic',
        description: '自动同步最新音色库，支持 51 种语言和中文音频标签（[轻笑]、[叹气] 等），把回复变成有情绪的声音。',
        configured: () => keys.breezeblue,
        fields: [
          { key: 'voiceId', label: '默认音色 ID', type: 'text', placeholder: '在语音模块中同步并选择' },
          { key: 'autoSyncVoices', label: '启动时自动同步音色', type: 'boolean', default: true },
          { key: 'voiceReplyChance', label: '语音回复概率', type: 'number', description: '0—1，默认 0.22', default: 0.22 },
        ],
        getConfig: () => ({ voiceId: s.get().models.breezeVoiceId, autoSyncVoices: s.get().tts.autoSyncVoices, voiceReplyChance: s.get().tts.voiceReplyChance }),
        setConfig: async (config) => { await s.save({ models: { ...s.get().models, breezeVoiceId: String(config.voiceId ?? '') }, tts: { ...s.get().tts, autoSyncVoices: !!config.autoSyncVoices, voiceReplyChance: Number(config.voiceReplyChance) || 0 } }); },
        actions: [{ id: 'sync', label: '同步最新音色' }, { id: 'test', label: '测试连接' }],
        run: async (action) => {
          if (action === 'sync') { const r = await this.deps.hub.listVoices(true); return { ok: true, message: `已同步 ${r.total} 个音色`, data: r }; }
          return this.test('breezeblue');
        },
      },
      {
        id: 'minimax', name: 'MiniMax 图像 / 视频', version: '1.0.0', category: 'creation', icon: 'image',
        description: '文生图 image-01 与 MiniMax-H3 / H3 Max 视频生成，支持最新 V2 接口、画幅、分辨率与 4–15 秒时长。',
        configured: () => keys.minimax,
        fields: [
          { key: 'imageModel', label: '图像模型', type: 'select', options: [{ label: 'image-01-live', value: 'image-01-live' }, { label: 'image-01', value: 'image-01' }], default: 'image-01-live' },
          { key: 'videoModel', label: '视频模型', type: 'select', options: [{ label: 'MiniMax-H3（最新旗舰）', value: 'MiniMax-H3' }, { label: 'MiniMax-H3-Max', value: 'MiniMax-H3-Max' }, { label: 'MiniMax-H3-Highspeed', value: 'MiniMax-H3-Highspeed' }, { label: 'MiniMax-H3-Lite', value: 'MiniMax-H3-Lite' }, { label: 'MiniMax-Hailuo-2.3（旧版）', value: 'MiniMax-Hailuo-2.3' }], default: 'MiniMax-H3' },
          { key: 'videoResolution', label: '视频分辨率', type: 'select', options: [{ label: '2K（H3 默认）', value: '2K' }, { label: '768P', value: '768P' }, { label: '480P', value: '480P' }], default: '2K' },
        ],
        getConfig: () => ({ imageModel: s.get().models.minimaxImage, videoModel: s.get().models.minimaxVideo, videoResolution: s.get().models.minimaxVideoResolution }),
        setConfig: async (config) => { await s.save({ models: { ...s.get().models, minimaxImage: String(config.imageModel ?? 'image-01-live'), minimaxVideo: String(config.videoModel ?? 'MiniMax-H3'), minimaxVideoResolution: String(config.videoResolution ?? '2K') } }); },
        actions: [{ id: 'test', label: '测试连接' }],
        run: async (action) => this.test('minimax'),
      },
      {
        id: 'suno', name: 'Suno 音乐工坊', version: '1.0.0', category: 'creation', icon: 'music',
        description: '用一句话生成完整歌曲：自动写词、编曲、演唱，支持 V6 系列模型与器乐模式，作品会保存在媒体库。',
        configured: () => keys.suno,
        fields: [
          { key: 'model', label: 'Suno 模型', type: 'select', options: [{ label: 'V6（推荐）', value: 'V6' }, { label: 'V6_WILD', value: 'V6_WILD' }, { label: 'V6_MINI', value: 'V6_MINI' }], default: 'V6' },
        ],
        getConfig: () => ({ model: s.get().models.suno }),
        setConfig: async (config) => { await s.save({ models: { ...s.get().models, suno: String(config.model ?? 'V6') } }); },
        actions: [{ id: 'test', label: '测试连接' }],
        run: async () => this.test('suno'),
      },
      {
        id: 'serper', name: 'Serper 网络搜索', version: '1.0.0', category: 'knowledge', icon: 'search',
        description: 'Google 搜索结果接入：聊天中按需查资料、自主上网学习新知识，并把可信来源写进学习笔记。',
        configured: () => keys.serper,
        fields: [{ key: 'maxResults', label: '单次结果数', type: 'number', default: 6 }],
        getConfig: () => ({ maxResults: s.get().search.maxResults }),
        setConfig: async (config) => { await s.save({ search: { ...s.get().search, maxResults: Number(config.maxResults) || 6 } }); },
        actions: [{ id: 'test', label: '测试搜索' }],
        run: async () => this.test('serper'),
      },
      {
        id: 'bilibili', name: 'B 站冲浪', version: '1.0.0', category: 'autonomy', icon: 'video',
        description: '根据人设兴趣自主刷 B 站排行榜与搜索，挑出好玩的内容、写吐槽，分享到聊天、日记或说说。',
        configured: () => true,
        fields: [{ key: 'interests', label: '兴趣标签（逗号分隔）', type: 'text', default: '' }],
        getConfig: () => ({ interests: s.get().bilibili.interests.join('，') }),
        setConfig: async (config) => { await s.save({ bilibili: { ...s.get().bilibili, interests: String(config.interests ?? '').split(/[,，]/).map((s) => s.trim()).filter(Boolean) } }); },
        actions: [{ id: 'refresh', label: '现在刷一会儿' }, { id: 'test', label: '测试连接' }],
        run: async (action) => {
          if (action === 'refresh') { const r = await this.deps.autonomy.trigger('bilibili', true); return { ok: true, message: r.skippedReason ?? '发现已更新' }; }
          return this.test('bilibili');
        },
      },
      {
        id: 'memory', name: '长期记忆与关系', version: '1.0.0', category: 'core', icon: 'brain',
        description: '每个联系人独立 Markdown 记忆文档，按人/群隔离；细节保留式上下文压缩、关系数值与重要事实抽取。',
        configured: () => true,
        fields: [{ key: 'autoMemoryExtraction', label: '自动抽取长期记忆', type: 'boolean', default: true }],
        getConfig: () => ({ autoMemoryExtraction: s.get().context.autoMemoryExtraction }),
        setConfig: async (config) => { await s.save({ context: { ...s.get().context, autoMemoryExtraction: !!config.autoMemoryExtraction } }); },
        actions: [{ id: 'stats', label: '查看统计' }],
        run: async () => { const st = await this.deps.memory.getStats(); return { ok: true, message: `${st.users} 位联系人 / ${st.groups} 个群 / ${st.facts} 条事实`, data: st }; },
      },
      {
        id: 'emotion', name: '情绪与成长', version: '1.0.0', category: 'core', icon: 'sparkles',
        description: '独立的情绪状态、能量、耐心、亲密度与成长阶段；会随对话、时间和自主活动变化，并影响说话方式。',
        configured: () => true,
        fields: [{ key: 'evolveEnabled', label: '允许人格进化', type: 'boolean', default: true }],
        getConfig: () => ({ evolveEnabled: s.get().persona.evolveEnabled }),
        setConfig: async (config) => { await s.save({ persona: { ...s.get().persona, evolveEnabled: !!config.evolveEnabled } }); },
        actions: [{ id: 'reflect', label: '让她反思一下' }],
        run: async () => { const r = await this.deps.autonomy.trigger('reflection', true); return { ok: true, message: r.activity?.summary ?? '完成了一次自我反思' }; },
      },
      {
        id: 'diary', name: '鲸鲸的日记', version: '1.0.0', category: 'autonomy', icon: 'book',
        description: '每天写一篇只属于自己的日记，记录真实发生的小事、情绪和发现，保存为 Markdown 与时间线。',
        configured: () => true,
        actions: [{ id: 'write', label: '现在写一篇' }],
        run: async () => { const r = await this.deps.autonomy.generateDiary(true); return { ok: true, message: '写好了《' + r.entry.title + '》', data: r.entry }; },
      },
      {
        id: 'qzone', name: 'QQ 空间说说', version: '1.0.0', category: 'autonomy', icon: 'send',
        description: '根据心情自主写说说，用 MiniMax 配图，并通过 NapCat 发布到 QQ 空间。',
        configured: () => true,
        actions: [{ id: 'write', label: '生成一条说说' }],
        run: async () => { const r = await this.deps.autonomy.generateQzone(undefined, false); return { ok: true, message: r.posted ? '已发布' : '已保存草稿', data: r.post }; },
      },
      {
        id: 'learning', name: '自主学习', version: '1.0.0', category: 'autonomy', icon: 'graduation',
        description: '基于兴趣用 Serper 搜索、用 DeepSeek 总结，把新知识写进学习笔记，并逐渐影响她看世界的方式。',
        configured: () => keys.serper && keys.deepseek,
        actions: [{ id: 'learn', label: '现在学点什么' }],
        run: async () => { const r = await this.deps.autonomy.learn(); return 'error' in r ? { ok: false, message: r.error } : { ok: true, message: '学完了：' + r.topic, data: r }; },
      },
      {
        id: 'autonomy', name: '自主生活引擎', version: '1.0.0', category: 'autonomy', icon: 'orbit',
        description: '定时心跳：主动找你说话、写日记、发说说、刷 B 站、学习、反思与成长。遵守安静时段与每日次数限制。',
        configured: () => true,
        fields: [
          { key: 'enabled', label: '启用自主生活', type: 'boolean', default: true },
          { key: 'proactiveEnabled', label: '允许主动找你', type: 'boolean', default: true },
          { key: 'idleTriggerMinutes', label: '安静多久后主动（分钟）', type: 'number', default: 90 },
        ],
        getConfig: () => ({ enabled: s.get().autonomy.enabled, proactiveEnabled: s.get().autonomy.proactiveEnabled, idleTriggerMinutes: s.get().autonomy.idleTriggerMinutes }),
        setConfig: async (config) => { await s.save({ autonomy: { ...s.get().autonomy, enabled: !!config.enabled, proactiveEnabled: !!config.proactiveEnabled, idleTriggerMinutes: Number(config.idleTriggerMinutes) || 90 } }); },
        actions: [{ id: 'proactive', label: '主动说句话' }, { id: 'status', label: '查看心跳' }],
        run: async (action) => {
          if (action === 'proactive') { const r = await this.deps.autonomy.trigger('proactive', true); return { ok: true, message: r.message ?? r.skippedReason ?? '已发出' }; }
          return { ok: true, message: JSON.stringify(this.deps.autonomy.status()) };
        },
      },
    ];
  }

  private async test(service: 'deepseek' | 'breezeblue' | 'minimax' | 'suno' | 'serper' | 'bilibili'): Promise<{ ok: boolean; message: string; data?: unknown }> {
    const r = await this.deps.hub.test(service);
    return { ok: r.ok, message: r.message };
  }

  list(): PluginInfo[] {
    const settings = this.deps.settings.get();
    return this.defs().map((def) => {
      const enabled = settings.plugins[def.id]?.enabled ?? true;
      const configured = def.configured ? def.configured() : true;
      return {
        id: def.id, name: def.name, version: def.version, description: def.description, category: def.category,
        icon: def.icon, enabled, builtin: true, configured,
        status: !enabled ? 'disabled' : !configured ? 'needs-config' : 'ready',
        actions: def.actions ?? [], configFields: def.fields ?? [], config: def.getConfig?.() ?? {},
      } as PluginInfo;
    }).concat(this.externalDefs());
  }

  async toggle(id: string, enabled: boolean): Promise<PluginInfo[]> {
    const current = this.deps.settings.get();
    const plugins = { ...current.plugins, [id]: { ...(current.plugins[id] ?? { config: {} }), enabled } };
    await this.deps.settings.save({ plugins });
    if (id === 'napcat' && !enabled) await this.deps.napcat.stop();
    if (id === 'autonomy' && !enabled) this.deps.autonomy.stop();
    if (id === 'autonomy' && enabled && this.deps.settings.get().autonomy.enabled) this.deps.autonomy.start();
    return this.list();
  }

  async configure(id: string, config: Record<string, unknown>): Promise<PluginInfo[]> {
    const external = this.externalDefs().find((d) => d.id === id);
    if (external) {
      const dir = path.join(this.pluginsDir, id);
      const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'plugin.json'), 'utf8')) as Record<string, unknown>;
      manifest.config = { ...(manifest.config as Record<string, unknown> | undefined ?? {}), ...config };
      await fsp.writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8');
      return this.list();
    }
    const def = this.defs().find((d) => d.id === id);
    if (!def) throw new Error('插件不存在');
    if (def.setConfig) await def.setConfig(config);
    const current = this.deps.settings.get();
    await this.deps.settings.save({ plugins: { ...current.plugins, [id]: { enabled: current.plugins[id]?.enabled ?? true, config } } });
    this.deps.hub.rebuild();
    return this.list();
  }

  async run(id: string, action: string): Promise<{ ok: boolean; message: string; data?: unknown }> {
    const external = this.externalDefs().find((d) => d.id === id);
    if (external) return { ok: true, message: '外部插件已加载；具体动作由 Agent/宿主工具执行：' + action };
    const def = this.defs().find((d) => d.id === id);
    if (!def) return { ok: false, message: '插件不存在' };
    if (!def.run) return { ok: false, message: '这个插件没有可执行操作' };
    try { return await def.run(action); } catch (error) { return { ok: false, message: (error as Error).message }; }
  }
}
