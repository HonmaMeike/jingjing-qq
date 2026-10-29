# 插件系统与扩展指南

## 设计目标

- 功能模块化：DeepSeek、NapCat、BreezeBlue、MiniMax、Suno、Serper、B站、记忆、情绪、成长、日记、QQ空间、学习、自主生活都是插件。
- 配置与 UI 解耦：插件声明 configFields，设置页/插件页自动渲染表单。
- 操作可编排：每个插件声明 actions，插件页可直接执行并展示结果。
- 状态可观测：ready / needs-config / disabled / error，健康检查调用 integrations.test。
- 数据与业务隔离：第三方客户端在 electron/services/integrations/，编排在 service，UI 只通过 shared/ipc.ts 契约调用。

## 内置插件注册

核心注册表：electron/services/plugins.ts。

每个插件定义包含：

- id / name / version / description / category / icon
- configured()：根据 API Key/NapCat 安装目录等计算
- fields：configFields（text/password/number/boolean/select/textarea）
- getConfig / setConfig：把插件配置映射到 AppSettings
- actions + run：可执行操作

新增内置插件步骤：

1. 在 electron/services/ 新建服务（构造函数注入依赖，不直接 new 全局单例）。
2. 如需第三方 API，在 integrations/ 添加客户端并由 integration-hub 暴露。
3. 在 app-services.ts 创建服务并加入插件依赖。
4. 在 plugins.ts 的 defs() 增加插件定义与 run 动作。
5. 在 shared/types.ts 补充设置/数据模型；在 shared/ipc.ts 增加方法（如需要）。
6. 在 ipc.ts 的 handlers 注册方法；在 src/lib/api.ts 增加前端封装。
7. UI 放在 pages/ 或插件配置表单自动渲染；注意写作用域与测试。
8. 运行 npm run typecheck / npm test / npm run screenshots。

## 外部插件（规划）

当前版本以“内置插件注册表”为主，确保类型安全与可审计。外部插件目录为 userData/plugins/<id>/，计划支持：

- plugin.json：id/name/version/description/category/author/configFields/actions；
- main.js：activate(api) 注册命令/定时任务/消息钩子；
- api：registerAction、getConfig、saveConfig、log、sendMessage、onMessage；
- 默认禁用，需要用户在插件页显式启用并确认权限。

在实现之前，请勿把不受信任的第三方 JS 放进主进程，避免任意代码执行与密钥泄漏。

## 插件数据约定

- 设置存于 settings.plugins[id] = { enabled, config }；敏感 Key 绝不放进插件 config。
- 插件运行日志通过 logger（文件 + 控制台）输出，避免打印密钥。
- 长任务返回明确状态与中文错误，UI 用 toast 展示。
- 任何联网操作都要设置超时；支持 AbortSignal（integrations 客户端已统一实现）。

## 测试

- 单元测试：tests/memory.test.ts（记忆隔离/压缩/检索）。
- 类型检查：npm run typecheck。
- 集成验收：npm run screenshots 启动真实 Electron，完成引导并抓取全部页面；重点检查设置页 Key 卡片、NapCat 控制台、聊天/人设/记忆/成长。
- 无 Key 环境下全部 UI 必须可用（离线演示），不出现白屏或未处理 Promise。
