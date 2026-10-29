# dsh-pet 素材包（鲸鲸）

从 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 抽取并转码的透明动画、GIF 和表情包，供 ChatBot / 桌宠 / QQ 机器人使用。

## 内容

| 目录 | 数量 | 说明 |
|---|---|---|
| `animations/` | 106 | 原始 VP9-alpha WebM，透明背景，浏览器/桌面直接播放 |
| `gifs/` | 106 | 由 WebM 转码的透明 GIF（320px、12fps），QQ/微信可用 |
| `memes/` | 27 | PNG 表情包，含中文语境描述 |
| `manifest.json` | 1 | 清单：文件名、描述、对应 GIF/WebM |
| `LICENSE` | 1 | 上游 MIT 许可证 |

## 用法

- **QQ / 微信**：直接发 `gifs/吃白饭.gif` 或 `memes/吃白饭的大肥鱼.png`
- **网页 / Electron**：用 `animations/xxx.webm`，透明背景，循环播放
- **机器人素材库**：用 `manifest.json` 建立名称→描述→文件路径的映射（表情包 desc 可直接喂给模型选图）

## 格式说明

- WebM 必须是 VP9 Alpha；普通编码会出现黑底。
- GIF 透明边缘可能有轻微锯齿（GIF 格式限制），需要更干净可用 WebM。
- 文件名保留原始中文名，引用时 URL 编码即可。

## 许可

素材与动画来自 dsh-pet，MIT License，详见 `LICENSE`。二次分发请保留本文件与许可证。
