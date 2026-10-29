# 插件制作教程（Agent 工具接入）

鲸鲸的插件中心支持两类插件：

1. 内置插件：由主程序提供能力（DeepSeek、NapCat、MiniMax、Suno、记忆等）。
2. 外部插件：放在数据目录的 `data/plugins/<plugin-id>/` 下，由 `plugin.json` 声明；Agent 工具或开发者可直接写入该目录，重启/刷新插件中心即可看到。

## 目录结构

```
data/plugins/
  my-plugin/
    plugin.json      # 必需
    README.md        # 可选
    assets/          # 可选
```

## plugin.json 最小示例

```json
{
  "id": "my-whale-tool",
  "name": "鲸鱼小工具",
  "version": "0.1.0",
  "description": "一个由 Agent 编写的外部插件示例",
  "category": "utility",
  "icon": "puzzle",
  "actions": [
    { "id": "hello", "label": "打个招呼", "description": "返回一条鲸鱼问候" }
  ],
  "configFields": [
    { "key": "greeting", "label": "问候语", "type": "text", "default": "你好呀" }
  ],
  "config": { "greeting": "你好呀" }
}
```

`category` 可选：`core` / `channel` / `creation` / `knowledge` / `autonomy` / `utility`。

## 安装/导入

### 方式 A：插件中心导入

插件中心 → **导入插件** → 选择 `plugin.json`。
文件会被复制到 `data/plugins/<id>/plugin.json` 并立即出现在列表中。

### 方式 B：Agent 工具直接写入

Agent 可以：

1. 读取 `app:info` 返回的数据目录；
2. 创建 `data/plugins/<id>/plugin.json`；
3. 调插件中心刷新（或重启应用）。

插件中心 → **导入目录** 会打开插件根目录，方便 Agent/开发者放入文件。

## 执行约定（当前版本）

当前公开版对外部插件采用**清单加载**：

- 插件会出现在插件中心，可查看名称、版本、描述、动作和配置字段；
- 外部插件动作点击后返回“由 Agent/宿主工具执行”，不会在宿主进程内执行未签名 JavaScript；
- 这是为了安全：插件市场开放前，不允许任意代码直接在鲸鲸主进程运行。

后续插件 SDK 会提供受控的 `run(pluginId, action, context)` 沙箱接口；文档会同步更新。

## 插件市场

插件中心已预留 **插件市场** 入口。开放后：

- 插件以 `plugin.json` + 可选资源包发布；
- 市场审核来源、权限与安全声明；
- 用户可一键安装/更新/卸载，数据目录结构保持兼容。

## 安全要求

- 不读取、上传用户记忆或密钥；
- 不执行系统命令、不下载可执行文件；
- 不冒充官方插件；
- 插件只能声明能力，实际执行必须经过宿主提供的受控 API。

## 给 Agent 的接入提示

- 通过 `app:info` 获取 `dataDir`；
- 通过 `plugins:open-folder` 打开目录；
- 通过 `plugins:import` 导入已有 `plugin.json`；
- 通过 `plugins:list` / `plugins:run` 查看与调用；
- 修改插件后刷新插件中心。
