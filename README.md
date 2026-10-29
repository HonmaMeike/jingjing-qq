# 鲸鲸 · QQ 智能伙伴

> 一只从 DeepSeek 蓝海游来的鲸鱼娘，住进你的 Windows 桌面。
> 她有长期记忆、自己的情绪与日记，会主动找你说话，也会在 QQ 群里交朋友。

鲸鲸是一个 **Electron + React + TypeScript** 的原生 Windows 桌面应用：内置 NapCat QQ 协议端管理、DeepSeek 大脑、BreezeBlue 语音、MiniMax 图像/视频、Suno 音乐、Serper 搜索，以及完全本地化的长期记忆与自主生活引擎。

## 核心能力

- **8 个内置人设**：鲸鲸（DeepSeek 蓝鲸娘，原始模板）、奶泡（软萌白鲸幼崽）、阿棘（毒舌虎鲸小雌鬼）、阿澄（邻家抹香鲸妹妹）、闹闹（熊孩子座头鲸）、知汐（三好学生长须鲸）、老鲸（贴吧冲浪十五年）、纳兰·鲸月（老北京正黄旗鲸鱼格格）。每个都有独立的口头禅、小动作、脾气、情绪、语感、边界、示例对话与 TTS 音色。支持自由切换、编辑、自定义与 AI 生成新人设。
- **DeepSeek 核心大脑**：默认 DeepSeek V4.1 Flash（更省钱），可切换 V4 Pro；支持官方 thinking 模式与 reasoning_effort=low/high/max；人设 prompt 与运行期情绪、成长、关系、长期记忆分层拼装。
- **长期记忆**：每位联系人独立 Markdown 记忆文档，群聊按「群 + 当前发言人」隔离；自动抽取事实、偏好、承诺、情绪和原话锚点；细节保留式上下文压缩，不把熟人聊成陌生人。
- **情绪与成长**：愉悦/精力/亲近/耐心/吃醋/自豪等连续状态，会随时间与互动衰减/变化；成长 XP、阶段、性格特质、习惯、自我认知与反思持续演化。
- **自主生活**：定时心跳，自主写日记、发 QQ 空间说说（MiniMax 配图）、刷 B 站、上网学习、自我反思、主动找你说话；有安静时段与每日次数限制。
- **QQ / NapCat 深度集成**：内嵌 NapCat 控制台、日志、命令、二维码、配置与诊断；启动 QQ 相关窗口会被自动隐藏，所有操作都在鲸鲸窗口内完成（Windows QQ 无官方无头模式，详见 docs/NAPCAT.md）。
- **多模态创作**：MiniMax image-01 文生图 / MiniMax-H3、H3 Max、H3 Highspeed、H3 Lite 文生视频（V2 接口，4–15 秒、2K/768P/480P，画幅可选）、Suno V6 音乐；作品保存在本地媒体库，可随聊天发送。
- **语音**：BreezeBlue 音色库自动同步、按最新音色优先、中文音频标签（[轻笑]、[叹气] 等），支持本地试听与 QQ 语音发送。
- **权限体系**：主人 / 管理员 / 白名单 / 陌生人四级；私聊、群聊 @ 或唤醒词、黑名单、敏感词、群白名单等规则。
- **意识海**：真实记忆结构升级——识海（经历点云）、原意识（深处的她与锚点）、心光（此刻注意什么）、心流（念头链路）、遗忘（细节下沉、重要保留）；每次醒来能接上昨天。
- **一键清空**：设置 → 上下文与数据 → 一键清空，删除记忆、会话、日记、说说、成长、意识、表情包、媒体与费用记录，保留密钥和全部设置；清空后自动重启为全新状态。
- **人设隔离**：每个人设一份独立记忆、日记、说说、成长与意识数据，切换时自动切换；音色按人设绑定，可手动覆盖。
- **DeepSeek 官方搜索**：支持 `/v1/tools/search` 与 `/v1/tools/fetch`，自动/DeepSeek/Serper 可切换。
- **供应商余额**：费用账本实时显示 DeepSeek 余额、BreezeBlue 积分、Suno credits、Serper credits；MiniMax 显示官方控制台入口。
- **聊天工具**：好感档案图片、画图/视频/唱歌命令，按权限与每日次数限制；自主活动不受聊天额度影响。
- **表情包库**：内置鲸鱼娘表情包，她会在聊天和 QQ 空间说说里按心情自己挑一张；你可以上传收藏、打标签、设为最爱，她也会每日自主生成/收集新的鲸鱼娘表情包（可关闭与限流）。
- **神经中枢**：真实运行时可观测性——DeepSeek token 流、记忆检索、工具调用、NapCat/QQ、语音与媒体组件的数据流，粒子神经网由真实事件驱动；多个窗口展示思考阶段、数据流、发散网络、对话进程、组件状态。
- **费用账本**：记录每一次 DeepSeek token、BreezeBlue 字符、MiniMax 图像/视频、Suno 音乐、Serper 搜索与 QQ 消息的真实调用量；按可配置参考单价估算费用，30 天趋势、供应商占比、预算与明细。
- **插件化架构**：所有能力以插件形式注册在统一插件中心，支持启用/禁用、可视化配置、健康检查与操作执行；数据层、服务层、UI 层解耦，方便扩展。
- **精美自适应 UI**：深海蓝玻璃拟态、卡片化布局、可折叠侧栏、响应式栅格、完整功能引导；使用附带的 dsh-pet 鲸鱼动画与 27 张梗图。


## 界面预览

| 首页 | 聊天 |
|---|---|
| ![首页](screenshots/01-dashboard.png) | ![聊天](screenshots/02-chat.png) |

| 人设工坊 | 记忆库 |
|---|---|
| ![人设](screenshots/03-personas.png) | ![记忆](screenshots/04-memory.png) |

| 成长日记 | 插件中心 |
|---|---|
| ![成长](screenshots/05-growth.png) | ![插件](screenshots/06-plugins.png) |

| NapCat 内嵌控制台 | API 密钥中心 |
|---|---|
| ![NapCat](screenshots/07-napcat.png) | ![密钥](screenshots/09-settings-keys.png) |

| 意识海 | 神经中枢 | 费用账本 |
|---|---|---|
| ![意识海](screenshots/10-consciousness.png) | ![神经中枢](screenshots/11-neural.png) | ![费用](screenshots/12-costs.png) |

| 表情包库 | 数据清理 |
|---|---|
| ![表情包库](screenshots/14-stickers.png) | ![数据清理](screenshots/15-settings-data.png) |

| 好感档案卡 |
|---|
| ![好感档案](screenshots/16-affection.png) |

> 截图来自本机打包版本的真实运行（离线演示数据）。完整安装包位于 release/JingJing-1.0.0-Setup.exe；免安装版本位于 release/win-unpacked/（与安装包同一次构建）。
> 安装包未做代码签名，Windows SmartScreen 可能提示；选择“更多信息 → 仍要运行”即可。应用不会上传遥测。

## 快速开始

环境：Windows 10/11、Node.js 20+（推荐 22/24）、npm。

~~~bash
npm install
npm run dev
~~~

生产构建：

~~~bash
npm run build       # 构建渲染层与主进程
npm start           # 用构建产物启动
npm run dist        # 生成 Windows NSIS 安装包（需要 electron-builder 下载工具链）
~~~

首次启动会进入**功能引导**：填 DeepSeek Key、连接 NapCat、设置主人 QQ、选择音色、开启自主生活。没有 Key 也可以先用离线演示模式体验完整 UI；配置后自动切换为真实对话。

## API 密钥

所有 API Key 都集中在 **设置 → API 密钥中心** 一个卡片内，使用 Electron safeStorage（Windows DPAPI）加密保存在本地，不会进入日志、插件配置或导出聊天记录。

| 服务 | 用途 | 获取地址 |
|---|---|---|
| DeepSeek | 对话、人设、记忆抽取、日记/说说/学习 | https://platform.deepseek.com/api_keys |
| BreezeBlue | 语音合成与音色库 | https://docs.breezeblue.ai/ |
| MiniMax | image-01 / MiniMax-H3 图像视频生成 | https://platform.minimax.io/ |
| Suno（sunoapi.org 网关） | 音乐生成 | https://sunoapi.org/api-key |
| Serper | Google 搜索 / 自主学习 | https://serper.dev/ |

## NapCat 集成

- **一键安装**：NapCat 页面 → “一键安装 OneKey” → 自动下载官方最新 Release 并运行安装器；也可以选择“已有目录”。
- **启动**：由鲸鲸以隐藏窗口方式启动 NapCat/QQ，控制台、日志、扫码登录、WebUI 全部内嵌；提供启动/停止/重启、实时命令、诊断、文件/端口/进程检查。
- **OneBot**：默认同时启用 HTTP（3000）与 WebSocket（3001）服务，并在 3002 启动反向 WS；鲸鲸会自动连接并支持断线重连。
- **二维码**：自动从 NapCat 日志与安装目录捕获二维码，显示在登录卡片中；窗口隐藏后依然可以扫码。
- **QQ 空间**：使用 NapCat 扩展接口 send_qzone_msg，可带图与设置可见范围。

> 注意：NapCat 基于 NTQQ 注入，属于第三方非官方方案，可能违反 QQ 用户协议并存在账号风险；请仅用于个人学习与合规用途，遵守当地法律法规和平台规则。QQ 在 Windows 上没有官方无头模式，鲸鲸会隐藏其窗口并接管控制，但登录/协议端行为最终取决于腾讯与 NapCat。

## 数据与隐私

- 所有设置、记忆、日记、说说、媒体、聊天记录默认保存在本机用户数据目录：
  %APPDATA%/鲸鲸 · QQ 智能伙伴/data（开发时可用 JINGJING_DATA_DIR 覆盖）。
- 记忆集中存放在 memories/，每位联系人一个 Markdown 文件；群聊为 groups/<groupId>/group.md + members/<qq>.md。
- API Key 单独加密存放，不写入设置 JSON。
- 没有遥测；只有你配置的第三方 API 会收到必要请求。使用前请阅读各服务隐私政策。
- 支持设置页备份数据、打开数据目录、清除演示会话与重置设置。

## 目录结构

~~~text
electron/
  main.ts                 Electron 入口：窗口、托盘、协议、生命周期
  ipc.ts                  全部 IPC 方法（统一响应、错误处理）
  preload.ts              contextBridge 安全桥
  config/                 默认设置、成长阶段
  core/                   路径、日志、事件总线、JSON 存储、密钥保管
  services/
    app-services.ts       服务容器与启动编排
    settings.ts / personas.ts / conversations.ts / chat.ts
    memory/               独立长期记忆与上下文引擎（30 个测试）
    emotion.ts / growth.ts / content.ts
    integration-hub.ts    DeepSeek / BreezeBlue / MiniMax / Suno / Serper / Bilibili
    integrations/         各第三方 API 客户端
    stickers.ts           表情包库：鲸鱼娘内置种子、上传收藏、按心情挑图、自主生成/收集
    napcat.ts             NapCat 生命周期、OneBot、控制台、二维码、Qzone
    autonomy.ts           心跳、日记、说说、B站、学习、主动消息
    plugins.ts            插件注册表与配置/操作
    demo.ts / content.ts  演示数据
src/
  App.tsx                 标题栏、侧栏、路由、命令面板
  app/AppProvider.tsx     全局数据、事件、主题、设置
  components/ui.tsx       设计系统原子组件
  pages/                  首页、聊天、人设、记忆、成长、插件、NapCat、设置
  components/...          各页面模块
  styles/tokens.css       深海主题设计 token
shared/
  types.ts                主进程/渲染层共享领域模型
  ipc.ts                  IPC 契约
  personas.ts             8 个人设（唯一真源）
  persona-prompts.ts      System Prompt 与 TTS 指令构建
public/pet/               内置鲸鱼动画、梗图、manifest（来自 dsh-pet，MIT）
resources/                icon
tests/memory.test.ts      记忆隔离/压缩/检索/安全测试
docs/                     架构、NapCat、插件、API 指南
~~~

## 测试与验收

~~~bash
npm test                 # 记忆引擎 30 个用例
npm run typecheck        # TypeScript 全量检查
npm run screenshots      # 自动启动并截取 9 个页面到 screenshots/
~~~

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [NapCat 集成与无弹窗说明](docs/NAPCAT.md)
- [意识结构：识海 / 原意识 / 心光 / 心流 / 遗忘](docs/CONSCIOUSNESS.md)
- [插件系统与扩展指南](docs/PLUGINS.md)
- [插件制作教程（Agent 接入）](docs/PLUGIN_AUTHORING.md)
- [API 密钥与第三方服务](docs/API_KEYS.md)
- [用户手册](docs/USER_GUIDE.md)

## 许可与致谢

- 应用代码：MIT。
- 鲸鱼动画/梗图：来自 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)，MIT，见 public/pet/LICENSE。
- NapCat：https://github.com/NapNeko/NapCatQQ
- DeepSeek、BreezeBlue、MiniMax、Suno、Serper、哔哩哔哩均为各自权利人所有；本项目与它们无隶属或背书关系。
