# API 密钥与第三方服务

所有密钥集中放在 **设置 → API 密钥中心**，统一保存、加密存储、统一测试。不要在插件配置、README 或聊天中粘贴真实 Key。

| Key | 必填 | 用途 | 文档 |
|---|---|---|---|
| DeepSeek | 是（真实对话） | 聊天、人设、记忆抽取、日记、说说、学习总结 | https://api-docs.deepseek.com/ |
| BreezeBlue | 否（语音） | TTS、音色库同步、中文音频标签 | https://docs.breezeblue.ai/guides/audio-tags#simplified-chinese-zh |
| MiniMax | 否（图像/视频） | image-01 文生图、MiniMax-H3 / H3 Max 文生视频 | https://platform.minimax.io/docs |
| Suno | 否（音乐） | V6 音乐生成（sunoapi.org 网关） | https://docs.sunoapi.org/ |
| Serper | 否（搜索/学习） | Google 搜索、B 站/学习补充 | https://serper.dev/ |

## 模型版本（2026-10 官方）

| 服务 | 当前官方模型 / 配置 |
|---|---|
| DeepSeek | deepseek-v4-pro（DeepSeek-V4-Pro-0813）、deepseek-flash（DeepSeek-V4.1-Flash-1017）；thinking.type=enabled/disabled，reasoning_effort=low/high/max；1M 上下文、最大 384K 输出 |
| MiniMax 图像 | image-01 |
| MiniMax 视频 | MiniMax-H3、MiniMax-H3-Max、MiniMax-H3-Highspeed、MiniMax-H3-Lite；V2 接口；H3 2K/768P、4–15s；H3 Max 480P/768P、5–15s；H3 Highspeed 768P；H3 Lite 480P/768P |
| BreezeBlue | breeze-tts-2-multilingual（最新多语言模型） |
| Suno | V6 / V6_WILD / V6_MINI（当前 V6 系列） |
| Serper | 无模型版本，Google 搜索接口 |

## DeepSeek

- 默认 Base URL：https://api.deepseek.com
- 模型：deepseek-flash（默认，V4.1 Flash，速度快、便宜）/ deepseek-v4-pro（V4 Pro，旗舰，更贵）；支持 thinking 与 reasoning_effort=low/high/max
- 可在设置页调整 temperature 与 maxTokens；V4 思考模式下 temperature 不生效，maxTokens 同时包含思考与正文，默认 8192（官方上限 384K）。
- JSON 任务（记忆抽取、日记、学习）使用 json_object 模式；reasoner 会自动规避不支持参数。

## BreezeBlue

- 基础地址：https://api.breeze.blue，鉴权头 xi-api-key。
- 音色库：GET /v1/voices，自动翻页，按 created_at_unix 找最新音色；设置页可手动同步。
- 合成：POST /v1/text-to-speech/{voiceId}?output_format=mp3，body { text, model_id, instructions, voice_settings:{guidance_scale} }。
- 中文标签用方括号：[轻笑] [叹气] [吸气] [低声] 等，来自官方 51 语言标签表；标签是表演提示，不保证每次完全一致。
- 语音发送到 QQ 依赖 NapCat/FFmpeg 对 mp3→silk 的转换；失败时仅本地可听并记录日志。

## MiniMax

- 基础：https://api.minimax.io，Authorization: Bearer <key>。
- 图像：POST /v1/image_generation，模型 image-01，支持 aspect_ratio、n、prompt_optimizer、response_format；URL 24 小时过期，应用会落盘。
- 搜索/抓取：DeepSeek 官方 `POST /v1/tools/search` 与 `POST /v1/tools/fetch`；搜索提供方可在设置中选择「自动 / DeepSeek / Serper」。
- 余额：`GET /user/balance`（费用账本会实时查询并显示）。
- 视频（最新 H3）：POST /v2/video_generation（MiniMax-H3 / MiniMax-H3-Max / MiniMax-H3-Highspeed / MiniMax-H3-Lite），GET /v2/query/video_generation/{task_id} 轮询，成功直接使用 task.content.url 下载；H3 支持 4–15 秒、768P/2K（子模型能力不同）。旧 Hailuo/T2V 仍走 /v1 接口。生成可能需要数分钟。
- 模型、分辨率、时长可在设置页或创作工坊选择。

## 供应商余额

费用账本会实时查询各供应商余额/额度：

| 供应商 | 接口 | 展示 |
|---|---|---|
| DeepSeek | GET /user/balance | CNY 总余额、赠金、充值余额 |
| BreezeBlue | GET /v1/balance | 积分余额 |
| Suno | GET /api/v1/get-credits | credits |
| Serper | 最近一次搜索响应的 credits | 剩余 credits（无独立余额接口） |
| MiniMax | 官方暂未公开余额 API | 显示控制台入口，不伪造余额 |

## Suno

- 默认网关：https://sunoapiorg.redpandaai.co，Authorization: Bearer <key>。
- POST /api/v1/generate，必填 customMode、instrumental、callBackUrl、model；应用用占位 callback 并轮询 GET /api/v1/generate/record-info?taskId=。
- 默认模型 V6，支持 V6_WILD / V6_MINI；支持器乐/演唱、歌词、风格。
- 音频链接可能过期，应用会下载到媒体库。

## Serper

- POST https://google.serper.dev/search，X-API-KEY。
- 用于聊天中的实时信息检索、自主学习；每次 testConnection 会消耗一次额度。

## 安全建议

- 只在本机使用；不要分享包含密钥的截图。
- 定期在服务商后台轮换 Key；在设置页重新填写即可热更新集成容器。
- 账号密码、Cookie（B 站）不进入插件配置；B 站 Cookie 仅用于公开 API 风控，保存在设置中，可在 UI 清除。
- 若怀疑泄漏，清除 Key 并重置；应用不发送遥测。
