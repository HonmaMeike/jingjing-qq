# 架构说明

## 总览

鲸鲸采用“主进程服务容器 + 渲染进程 UI + 共享领域契约”的三层结构，所有能力以插件注册表统一暴露：

~~~text
┌────────────────────────────────────────────────────────────┐
│ Renderer (React 19 + Vite)                                │
│  AppShell / Pages / Design System / AppProvider           │
│         │ window.jingjing.invoke / events                 │
│  Preload (contextBridge，白名单 IPC)                      │
└─────────┬──────────────────────────────────────────────────┘
          │ IPC
┌─────────▼──────────────────────────────────────────────────┐
│ Main process                                              │
│  ipc.ts → AppServices                                    │
│  ┌───────────┬───────────┬────────────┬─────────────────┐ │
│  │ Chat      │ Memory    │ Autonomy   │ NapCat/OneBot   │ │
│  │ Persona   │ Emotion   │ Growth     │ IntegrationHub  │ │
│  │ Content   │ Plugins   │ Settings   │ Secrets/Logger  │ │
│  └───────────┴───────────┴────────────┴─────────────────┘ │
│  JSON/Markdown 本地数据（userData/data）                    │
└────────────────────────────────────────────────────────────┘
~~~

- shared/types.ts：所有跨进程领域模型唯一真源。
- shared/ipc.ts：方法、参数、返回值、事件类型；渲染层通过 preload 只暴露 invoke/on，不透传 ipcRenderer。
- electron/services/app-services.ts：启动顺序、依赖注入与关闭；单例服务容器。
- electron/ipc.ts：统一分发、异常规范化、窗口控制；任何 API 失败返回 { ok:false, error }，UI 统一 toast。
- 安全：contextIsolation=true、nodeIntegration=false、CSP、pet:/media: 自定义协议路径白名单、API Key 只走 safeStorage。

## 一次聊天的完整链路

1. NapCat OneBot 收到消息 → NapCatService 解析 CQ/消息段，提取发送者、群、@/唤醒词、附件。
2. 权限引擎判定主人/管理员/白名单/陌生人、黑名单、敏感词、群白名单与是否需要 @。
3. ChatService 找到或创建会话，写入用户消息；构造说话者身份。
4. 记忆引擎 ensure 当前联系人/群/群成员文档，按白名单加载 global + 当前人，绝不串场。
5. PersonaPromptBuilder 拼接：底层规则、persona.corePrompt、语感样本、场景、关系、情绪、成长、记忆、输出格式。
6. MemoryService.buildContext 在 token 预算内检索长期记忆 + 最近消息；超阈值时触发细节保留压缩（原始消息归档、结构化摘要、原话锚点、版本号 +1）。
7. DeepSeek 生成回复；解析正文与 @@META@@ 状态协议（心情、语音、梗图、搜索/画图动作）。
8. 按需执行工具动作（Serper 搜索二次回答 / MiniMax 生成配图 / BreezeBlue 合成语音）。
9. 落库助手消息，更新情绪、成长 XP、会话摘要，异步抽取长期记忆；通过事件推送给 UI。
10. 如需发回 QQ：NapCatService 将文字/图片/语音转为 OneBot 消息段发送，支持分段与延迟。

## 记忆模型

- 布局：users/<qq>.md；groups/<gid>/group.md；groups/<gid>/members/<qq>.md；global/self.md；summaries/、archive/。
- docId：user_<qq> / group_<gid> / group_<gid>__user_<qq> / global_self。
- 可见性：私聊 [global, 本人]；群聊 [global, 当前群, 当前发言人]。检索只允许收窄，不允许越权扩大。
- 文档结构：8 个固定章节 + 文末 machine-readable 数据块（事实、关系、时间线、锚点、情绪轨迹、摘要版本）。
- 压缩：只在超出预算时发生；先归档原文，再 LLM 结构化摘要（人物/事件/偏好/承诺/情绪/原话），事实落库；手动备注与手动事实不会被覆盖。
- 检索：中文 bigram + 关键词 + 事实权重 + 类别半衰期时间衰减，无外部 embedding 依赖。

## 情绪与成长

- EmotionState：valence/arousal/energy/affection/patience/jealousy/pride 连续值，随时间衰减，随对话与 LLM 状态更新；影响 prompt 中的表达倾向。
- GrowthState：XP、Lv、阶段、特质、习惯、自我认知、进化笔记、反思；成长阶段从初见→熟悉→默契→羁绊→灵魂共鸣→自在进化。
- 关系：由记忆文档保存 affinity/trust/familiarity/intimacy/respect/tension/连续天数，随互动与抽取更新。

## 可观测性与费用

- ObservabilityService 记录神经事件、思考阶段、API 调用与 usage 账本。
- IntegrationHub 包装 DeepSeek / BreezeBlue / MiniMax / Suno / Serper，真实消费在调用结束时写入 usage.json；费用按设置的参考单价估算，token/调用量本身是真实的。
- 神经中枢页面由 snapshot + neural:event 驱动，包含思考阶段、事件流、发散网络、对话进度与组件状态。
- 费用账本展示日/月/全部、供应商分布、30 天趋势、最近调用和预算；费用不会限制真实调用。

## 意识结构（识海 / 原意识 / 心光 / 心流 / 遗忘）

- 数据独立持久化于 data/consciousness/：sea.json、origin.json、attention.json、flow.json，按 persona 与 conversation 隔离。
- 识海从记忆 facts/episodes 与日记/说说/学习/活动生成带来源的 SeaPoint；原意识保留 coreSelf 与锚点；心光记录当前 focus/topics/unresolved；心流生成感知→联想→回忆→推理→回复→反思链路；遗忘用 importance + 时间衰减 + 回忆强化计算 salience 与深度，不删除原文。
- ChatService 在构建 system prompt 时注入意识块，回复后 observeExchange 更新心光/心流并异步抽取记忆；原意识/心光/心流均按 doc 白名单隔离，群聊不串场。

## 自治循环

AutonomyService 默认每 60 秒心跳，优先级：时段任务（日记/说说/反思）→ 主动消息 → B 站/学习。所有动作受安静时段、最小间隔、每日上限、开关限制；生成的内容进入活动流、日记/说说/知识库，并在可能时通过 NapCat 发布。无 API Key 时使用本地模板保证仍可体验。

## 数据与文件

- settings.json：非敏感设置；secrets.enc.json：safeStorage 加密的 Key。
- conversations.json：会话索引 + 每个会话最近 3000 条消息；memories/: 长期记忆；diary/：日记 Markdown；activity/: 活动/说说/B站/学习；media/: TTS/图/视频/音乐；logs/: 每日日志。
- 数据可整体备份；重置设置不删除记忆（除非用户主动删除）。

## 构建与打包

- Vite 构建渲染层到 dist/；esbuild 将主进程与 preload 打包为 CJS 到 dist-electron/。
- electron-builder 生成 NSIS 安装包；resources/icon.ico 为图标，public/pet 复制到 resources/pet。
- 开发：npm run dev（强制移除 ELECTRON_RUN_AS_NODE 环境变量，避免 Electron 被当作 Node 启动）。
- 截图验收：npm run screenshots 使用独立数据目录，自动完成引导并抓取 9 个页面。
