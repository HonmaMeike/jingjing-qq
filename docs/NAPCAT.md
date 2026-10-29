# NapCat 集成与无弹窗说明

## 原理

NapCatQQ 是基于 NTQQ 的第三方协议端，通过 OneBot 11 暴露 HTTP/WebSocket。鲸鲸把 NapCat 当作受管子进程：启动、停止、重启、日志、命令、二维码、配置、诊断都在应用内完成。

## 首次连接（推荐顺序）

1. 打开 **NapCat** 页面。
2. 点击 **一键安装 OneKey**：
   - 自动查询 GitHub 最新 Release，下载 NapCat.Shell.Windows.OneKey.zip；
   - 解压并运行官方安装器（隐藏窗口）；
   - 自动检测安装目录并写入设置。
   - 如果网络受限，可手动安装后选择“已有目录”。
3. 在 NapCat 配置 Tab 填写机器人 QQ 号（可选，但推荐），保存后会尝试写入 OneBot 配置。
4. 点击 **启动**。NapCat/QQ 的控制台与登录窗口会被隐藏。
5. 登录卡片会自动轮询二维码；用手机 QQ 扫码。
6. 登录成功后 OneBot WS/HTTP 连接建立，状态变为“QQ 在线”。

## 无弹窗如何实现

Windows 版 QQ/NapCat 没有官方 headless 模式，鲸鲸采用组合策略：

- 子进程使用 windowsHide:true 启动，stdio 管道收集日志；
- 启动后运行隐藏的 PowerShell 窗口守护，持续对进程名匹配 ^(QQ|QQNT|NapCat|NapCatWinBootMain|NapCatInstaller)$ 的主窗口调用 ShowWindowAsync(SW_HIDE)；
- 二维码从 NapCat 日志/安装目录递归捕获，显示在应用内；WebUI 通过应用内 iframe/内嵌入口打开；
- 所有控制台命令、日志、状态、配置均通过应用内 IPC 完成，不打开系统终端；
- 首次启动 OS 可能会有一瞬窗口创建，守护会尽快隐藏；这是 Windows QQ 客户端的限制，无法 100% 从协议层消除。

## OneBot 配置

应用默认约定：

- HTTP: http://127.0.0.1:3000
- WebSocket Server: ws://127.0.0.1:3001
- 应用反向 WS 监听: 127.0.0.1:3002
- WebUI: http://127.0.0.1:6099/webui

启动前若已知机器人 QQ 号，会尝试写入 napcat/config/onebot11_<uin>.json，同时启用 HTTP、WS Server、反向 WS。若 NapCat 已运行，配置可能需要重启后生效，可以在控制台输入“重启”或点击重启按钮。

## 控制台命令

页面快捷命令：登录信息、状态、帮助、重载配置、清屏。

- “登录信息”：调用 OneBot get_login_info
- “状态”：显示进程/QQ/OneBot/运行时长
- “帮助”：命令列表
- “重载配置”：请求 OneBot 重载；不可用时提示重启
- 其他输入会转发到 NapCat 进程 stdin；也可在控制台输入 api <action> <json> 直接调用 OneBot 接口。

## 常见问题

- **端口被占用**：设置页可修改 HTTP/WS/反向 WS 端口，确认 NapCat 与鲸鲸一致。
- **二维码不出现**：查看日志是否有二维码路径；NapCat 版本/安装目录可能不同。打开内嵌 WebUI 也可扫码登录。
- **找不到启动器**：目录下应有 launcher.bat / napcat.bat / bootmain/napcat.bat / napcat/launcher.bat；使用“已有目录”选择正确层级。
- **安装器无响应**：OneKey 为官方 GUI 安装器，可能被安全软件拦截；允许运行或手动安装。
- **QQ 被挤下线/风控**：属于第三方协议端风险，请降低频率、避免营销/骚扰，遵守平台规则。
- **账号安全**：不要在不可信设备登录；NapCat 与本应用均只在本机运行，OneBot 端口仅绑定 127.0.0.1。

## 合规

NapCat 与 NTQQ 注入可能违反 QQ 用户协议；本项目仅用于个人学习、自动化研究与合规场景，不对账号封禁、数据损失或法律责任负责。请勿用于骚扰、诈骗、违法内容或未授权商业用途。
