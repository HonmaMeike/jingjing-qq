# 第三方 API 集成层 · 配置与验证说明

本目录（`electron/services/integrations/`）是主进程访问所有外部服务的唯一出口，**不依赖任何第三方 SDK**，只用 Node 内置 `fetch`、`fs/promises`、`path`、`os`（要求 Node 20+，项目实际为 Node 24）。

## 目录与职责

| 文件 | 职责 |
| --- | --- |
| `http.ts` | fetch 封装：超时、重试（指数退避）、JSON/文本/二进制解析、`IntegrationError` 归一化、媒体落盘工具、连通性测试包装 |
| `deepseek.ts` | OpenAI 兼容 `/chat/completions`，流式 SSE / 非流式 / JSON mode / reasoner，返回 content、reasoning、usage |
| `breezeblue.ts` | `/v1/models`、`/v1/voices`（自动翻页 + 最新声音）、`/v1/text-to-speech/{voiceId}`，支持中文音频标签 |
| `minimax.ts` | `/v1/image_generation`、`/v1/video_generation` + 轮询 + `/v1/files/retrieve` 下载 |
| `suno.ts` | `/api/v1/generate` + `/api/v1/generate/record-info` 轮询 + 音频/封面下载 |
| `serper.ts` | Google 搜索（search / news / images），返回 `SearchResultItem[]` |
| `bilibili.ts` | 排行榜、视频搜索、视频详情，可选 Cookie |
| `index.ts` | 统一导出 + `createIntegrationServices` / `createIntegrationsFromSettings` 服务容器工厂 |

## 通用约定

- **密钥只来自参数**：构造客户端时传入；不会写入日志、错误信息或磁盘。设置页负责加密存储，集成层不读文件。
- **未配置密钥也可构建实例**：调用对应方法时才抛出 `IntegrationError{ code: 'MISSING_API_KEY' }`，因此设置页保存后重建容器即可热生效。
- **所有错误统一类型**：

```ts
interface IntegrationError {
  name: 'IntegrationError';
  service: 'deepseek' | 'breezeblue' | 'minimax' | 'suno' | 'serper' | 'bilibili' | 'http';
  code: 'MISSING_API_KEY' | 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND'
      | 'RATE_LIMITED' | 'SERVER_ERROR' | 'TIMEOUT' | 'ABORTED' | 'NETWORK'
      | 'BAD_RESPONSE' | 'CONFIG' | 'UPSTREAM' | 'UNKNOWN';
  status: number;      // HTTP 状态码，0 表示没有拿到响应（网络/超时/取消）
  retryable: boolean;  // 网络错误、429、5xx、超时为 true
  message: string;     // 面向 UI 的中文文案
}
```

- **取消**：所有网络方法都接受 `signal?: AbortSignal`；视频/音乐轮询支持 `timeoutMs` + `signal`。
- **媒体落盘**：音频/图片/视频通过 `saveBinaryFile` / `createMediaFileName` 写入指定 `outDir`（默认系统临时目录 `jingjing-media/...`），文件名带时间戳与随机后缀。

## 主进程注入示例

```ts
import { createIntegrationsFromSettings, IntegrationError } from './services/integrations';

// settings / apiKeys 来自你的设置存储（apiKeys 为解密后的明文）
const integrations = createIntegrationsFromSettings(settings, apiKeys);

// 启动时探测全部服务（永不抛出，可直接写 IntegrationStatus[]）
const statuses = await integrations.probeAll();

// 对话
const reply = await integrations.deepseek.chat(
  [{ role: 'system', content: '你叫鲸鲸' }, { role: 'user', content: '在吗' }],
  { stream: true, onDelta: ({ content }) => void content },
);

// 语音（中文音频标签原样传递）
const voice = await integrations.breezeblue.synthesize({
  text: '[轻笑] 早上好呀，今天也要加油哦',
  outDir: settings.general.assetsPath,
  instructions: '温柔、亲近，语速稍慢',
  guidanceScale: 1.1,
});

// 音乐 / 视频 / 图片
const music = await integrations.suno.generateAndWait(
  { prompt: '夏天的海边，轻快的流行曲', style: 'city pop', title: '海风', customMode: true, instrumental: false },
  { pollIntervalMs: 10_000, timeoutMs: 6 * 60_000 },
);
const video = await integrations.minimax.generateVideo(
  { prompt: '鲸鱼在星空中游动，电影感', resolution: '768P', duration: 6 },
  { pollIntervalMs: 5_000, timeoutMs: 10 * 60_000 },
);
const image = await integrations.minimax.generateImage({ prompt: '水彩风格的白鲸', aspectRatio: '1:1', n: 1 });

// 搜索 / B 站
const results = await integrations.serper.search({ query: 'DeepSeek 最新模型', num: 5 });
const videos = await integrations.bilibili.searchByInterests(['人工智能', '海洋生物'], { total: 6 });
```

构建容器时也可直接传覆盖项（不依赖设置对象）：

```ts
const services = createIntegrationServices({
  apiKeys: { deepseek: 'sk-...', breezeblue: 'bb-...', minimax: '...', suno: '...', serper: '...' },
  endpoints: { deepseekBaseUrl: 'https://api.deepseek.com', breezeblueBaseUrl: 'https://api.breeze.blue' },
  models: { deepseekChat: 'deepseek-v4-pro', breezeTts: 'breeze-tts-2-multilingual', suno: 'V6' },
  bilibili: { cookie: 'SESSDATA=...; buvid3=...' },
});
```

---

## 1. DeepSeek 对话

**配置项**（设置 → API 密钥 / 模型）

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeys.deepseek` | — | 必填，`sk-` 开头 |
| `endpoints.deepseekBaseUrl` | `https://api.deepseek.com` | 可带 `/v1` |
| `models.deepseekChat` | `deepseek-v4-pro` | 日常对话（也可选 deepseek-flash） |
| `models.deepseekReasoning` | `deepseek-v4-pro` | 兼容字段；V4 用 thinking 控制 |
| `deepseek.temperature` | `0.8` | 推理模型自动忽略该参数 |
| `deepseek.maxTokens` | `4096` | 单次上限 |
| `deepseek.timeoutMs` | `120000` | 非流式整体超时 |

**验证**

```bash
curl https://api.deepseek.com/models -H "Authorization: Bearer $DEEPSEEK_KEY"
```

或用代码：

```ts
const result = await integrations.deepseek.testConnection();
// { ok: true, detail: '连接正常，可用模型 2 个：deepseek-v4-pro / deepseek-flash', latencyMs: 812 }
```

**要点**
- `chat()` 支持 `stream: true` + `onDelta` 自动走 SSE；也可直接 `streamChat(messages, options, onDelta)`。
- 流式返回 `content` / `reasoning`（reasoner 的思维链）；最后一帧 usage 通过 `stream_options.include_usage` 获取。
- 流式读取有**空闲超时**（默认 60s），长时间无数据会抛 `TIMEOUT`（可重试）。
- `chatJson<T>()` 自动剥离 `\`\`\`json` 围栏并容错前后缀；解析失败抛 `BAD_RESPONSE`。
- 对话默认不自动重试（避免重复计费），需要时显式传 `retries: 1`。

**常见错误**：`401 UNAUTHORIZED` → 密钥错误/未生效；`429 RATE_LIMITED` → 限流；`402` 余额不足会归入 `UPSTREAM`，message 中含上游原文。

---

## 2. Breeze 语音（TTS）

**配置项**

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeys.breezeblue` | — | 必填 |
| `endpoints.breezeblueBaseUrl` | `https://api.breeze.blue` | |
| `models.breezeTts` | — | TTS 模型 ID，由 `listModels()` 获取 |
| `models.breezeVoiceId` | — | 声音 ID，由 `syncVoices()` 同步后选择 |
| `tts.outputFormat` | `mp3` | 请求参数 `output_format` |
| `tts.guidanceScale` | `1` | `voice_settings.guidance_scale`，越大越贴合情绪指令 |

**接口细节**

- 鉴权头：`xi-api-key`（不是 Bearer）。
- 声音列表：`GET /v1/voices?page_size=100&next_page_token=...`，客户端自动翻页、按 `created_at_unix` 降序，最新声音 `isLatest = true`。
- 合成：`POST /v1/text-to-speech/{voiceId}?output_format=mp3`
  body：`{ text, model_id, instructions, voice_settings: { guidance_scale } }`；返回音频二进制。
- 中文音频标签如 `[轻笑]`、`[叹气]`、`[低语]` 会**原样**传给模型演绎；`audioTagGuide()` 可把标签说明拼进人设提示词，`AUDIO_TAG_PRESETS` 为推荐标签。

**验证**

```bash
curl https://api.breeze.blue/v1/models -H "xi-api-key: $BREEZE_KEY"
curl "https://api.breeze.blue/v1/voices?page_size=5" -H "xi-api-key: $BREEZE_KEY"
curl -X POST "https://api.breeze.blue/v1/text-to-speech/VOICE_ID?output_format=mp3" \
  -H "xi-api-key: $BREEZE_KEY" -H "Content-Type: application/json" \
  -d '{"text":"[轻笑]你好呀","model_id":"YOUR_MODEL","instructions":"温柔","voice_settings":{"guidance_scale":1}}' \
  --output test.mp3
```

```ts
const { voices, latestVoiceId, total } = await integrations.breezeblue.syncVoices();
const tts = await integrations.breezeblue.synthesize({
  text: '[叹气] 今天好累呀……不过见到你就好啦',
  voiceId: latestVoiceId,
  outDir: assetsPath,
});
// tts.buffer / tts.filePath / tts.bytes
```

**要点**
- `prepareTtsText` 会压缩空白、保留标签、按 `maxChars`（设置项 `tts.maxChars`）在句子边界截断；纯标签文本抛 `BAD_REQUEST`。
- 超长文本用 `splitTtsText(text, maxChars)` 分段合成（QQ 建议分段发送）；`synthesizeLong()` 可合并为单条 MP3（MP3 帧拼接，兼容主流播放器）。
- 未选择声音时抛 `CONFIG`：请先 `syncVoices()` 再写回 `models.breezeVoiceId`。

---

## 3. MiniMax 图像 / 视频

**配置项**

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeys.minimax` | — | 必填 |
| `endpoints.minimaxBaseUrl` | `https://api.minimax.io` | 国际站 |
| `models.minimaxImage` | `image-01` | |
| `models.minimaxVideo` | `MiniMax-H3` | 可选 `MiniMax-H3-Max` / `MiniMax-H3-Highspeed` / `MiniMax-H3-Lite`；旧 Hailuo 仍兼容 |
| `models.minimaxVideoResolution` | `2K` | H3：`768P` / `2K`；H3 Max/Lite：`480P` / `768P`；旧 Hailuo：`512P` / `768P` / `1080P` |
| `models.minimaxVideoDuration` | `6` | 秒（Hailuo 常见 6 / 10） |

**接口流程**

1. `POST /v1/image_generation`：`{ model, prompt, aspect_ratio, n, response_format: 'url' | 'base64', prompt_optimizer, seed }`
   - `response_format: 'base64'`（默认）→ 自动解码落盘，返回 `files`；
   - `response_format: 'url'` → 返回 `urls`，传入 `outDir` 时同时下载到本地。
2. `POST /v1/video_generation`：`{ model, prompt, resolution, duration, prompt_optimizer, first_frame_image?, last_frame_image? }` → `task_id`
3. `GET /v1/query/video_generation?taskId=`：状态 `Queueing / Processing / Success / Fail`
4. `GET /v1/files/retrieve?file_id=`：取 `file.download_url`（已兼容顶层 `download_url` 等结构）
5. 下载视频到本地。

**验证**

```bash
curl -X POST https://api.minimax.io/v1/image_generation \
  -H "Authorization: Bearer $MINIMAX_KEY" -H "Content-Type: application/json" \
  -d '{"model":"image-01","prompt":"一只水彩白鲸","aspect_ratio":"1:1","response_format":"url","n":1}'
```

```ts
const image = await integrations.minimax.generateImage({
  prompt: '水彩风格的白鲸，星空背景',
  aspectRatio: '1:1',
  n: 1,
  outDir: assetsPath, // base64 模式必用；缺省写系统临时目录
});

const video = await integrations.minimax.generateVideo(
  { prompt: '鲸鱼在星空中缓缓游动，电影质感', resolution: '768P', duration: 6 },
  {
    pollIntervalMs: 5_000,
    timeoutMs: 10 * 60_000,
    onProgress: (status) => console.log(status.status),
  },
  { outDir: assetsPath },
);
// video.downloadUrl / video.filePath / video.elapsedMs
```

**要点**
- MiniMax 业务错误常以 **HTTP 200 + `base_resp.status_code`** 返回；本模块已统一校验：
  `1004` → `UNAUTHORIZED`，`1002` → `RATE_LIMITED`，`1008` → `UPSTREAM`（余额不足），`1026/1027` → 内容安全 `BAD_REQUEST`。
- 视频轮询可传入 `signal` 取消；超时抛 `TIMEOUT`（message 里带 taskId，可稍后凭 taskId 继续查）。
- `testConnection()` 用 `files/retrieve` 探测，**不消耗生成额度**：鉴权失败才判失败，参数类错误视为连通。

---

## 4. Suno 音乐

**配置项**

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeys.suno` | — | 必填 |
| `endpoints.sunoBaseUrl` | `https://sunoapiorg.redpandaai.co` | |
| `models.suno` | `V6` | 也可填 V5 / V4_5 / V4 / V3_5 |
| `suno.callBackUrl` | `https://example.com/callback` | 轮询模式占位地址，不会被真正访问 |

**接口细节**

- 鉴权：`Authorization: Bearer <key>`。
- 生成：`POST {baseUrl}/api/v1/generate`
  必填 `customMode`、`instrumental`、`callBackUrl`、`model`；可选 `prompt`（customMode=true 时为歌词，false 时为描述）、`style`、`title`、`negativeTags`、`vocalGender`、`duration`、`personaId`、`styleWeight`、`weirdnessConstraint`、`audioWeight`。
- 轮询：`GET {baseUrl}/api/v1/generate/record-info?taskId=`
  状态：`PENDING → TEXT_SUCCESS → FIRST_SUCCESS → SUCCESS`；失败态：`CREATE_TASK_FAILED` / `GENERATE_AUDIO_FAILED` / `CALLBACK_EXCEPTION` / `SENSITIVE_WORD_ERROR`。
- 音频地址：优先 `data.response.sunoData[].audioUrl`，兼容 `data.data` 与 snake_case（`audio_url` / `image_url`）。

**验证**

```bash
curl -X POST https://sunoapiorg.redpandaai.co/api/v1/generate \
  -H "Authorization: Bearer $SUNO_KEY" -H "Content-Type: application/json" \
  -d '{"prompt":"夏天的海风","customMode":true,"instrumental":false,"style":"city pop","title":"海风","callBackUrl":"https://example.com/callback","model":"V6"}'
# 记下 taskId
curl "https://sunoapiorg.redpandaai.co/api/v1/generate/record-info?taskId=TASK_ID" \
  -H "Authorization: Bearer $SUNO_KEY"
```

```ts
const record = await integrations.suno.generateAndWait(
  { prompt: '夏天的海风', style: 'city pop', title: '海风', customMode: true, instrumental: false },
  { pollIntervalMs: 10_000, timeoutMs: 6 * 60_000 },
  { audioDir: musicDir, coverDir: musicDir },
);
// record.tracks[].audioUrl / audioPath / coverUrl / coverPath / durationSec
```

**要点**
- 一律走**轮询模式**（`callBackUrl` 只是占位符），不依赖公网回调。
- `testConnection()` 优先查额度（`/api/v1/get-credits`），接口不存在时回退任务查询探测，不消耗生成额度。
- 轮询超时默认 8 分钟；超时错误里带 taskId，可调用 `getRecord(taskId)` 续查。
- 音频/封面下载失败：音频失败即抛错；封面失败仅跳过（`coverPath` 为 undefined），不影响主流程。

---

## 5. Serper 搜索

**配置项**

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| `apiKeys.serper` | — | 必填（serper.dev 控制台获取） |
| `endpoints.serperBaseUrl` | `https://google.serper.dev` | |

**接口细节**

- `POST /search`（新闻 `/news`、图片 `/images`、视频 `/videos`、地点 `/places`）
- 鉴权头：`X-API-KEY`
- body：`{ q, num, page?, gl?, hl?, location?, tbs? }`
- 返回：`organic[]` / `news[]` / `images[]`，另有 `answerBox`、`knowledgeGraph`、`relatedSearches`、`credits`。
- 图片结果的 `url` 为**可直接下载的图片地址**，`source` 为来源站点；其它类型 `url` 为页面链接。

**验证**

```bash
curl -X POST https://google.serper.dev/search \
  -H "X-API-KEY: $SERPER_KEY" -H "Content-Type: application/json" \
  -d '{"q":"DeepSeek","num":3}'
```

```ts
const results = await integrations.serper.search({ query: 'DeepSeek 最新模型', num: 5, gl: 'cn', hl: 'zh-cn' });
const detailed = await integrations.serper.searchDetailed({ query: 'AI 新闻', type: 'news', tbs: 'qdr:d' });
const images = await integrations.serper.images({ query: '鲸鱼', num: 3 });
```

**要点**：`testConnection()` 会真实发送一次最小搜索（`num: 1`，**消耗 1 次额度**），只建议在设置页手动点击「测试连接」时调用。

---

## 6. 哔哩哔哩（公开 API）

**配置项**

| 项目 | 默认值 | 说明 |
| --- | --- | --- |
| `bilibili.cookie` | 空 | 可选；搜索/详情在部分网络环境需要 `SESSDATA`、`buvid3` 等 |
| `bilibili.enabled` / `interests` / `fetchLimit` | 设置页控制 | 集成层只负责取数，筛选与点评由自主行为层处理 |

**接口细节**

- 排行榜：`GET /x/web-interface/ranking/v2?rid=0&type=all`
- 搜索：`GET /x/web-interface/search/type?search_type=video&keyword=...&page=1&order=totalrank`
- 详情：`GET /x/web-interface/view?bvid=...`（支持 aid）
- 请求头：浏览器 UA + `Referer: https://www.bilibili.com/`，无 Key。
- 输出 `BiliVideo`：`bvid / title / cover / url / upName / play / danmaku / duration / durationSec / pubdate / desc`。
- 搜索标题中的 `<em class="keyword">` 会被剥离；封面 `//i0.hdslb.com/...` 会补全为 https。

**验证**

```bash
curl "https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all" \
  -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)" -H "Referer: https://www.bilibili.com/"
```

```ts
const ranking = await integrations.bilibili.getRanking({ limit: 10 });
const found = await integrations.bilibili.searchVideos('人工智能', { limit: 5, order: 'click' });
const info = await integrations.bilibili.getVideoInfo('BV1xx411c7mD');
const forAutonomy = await integrations.bilibili.searchByInterests(['人工智能', '海洋生物'], { total: 6 });
```

**常见错误**
- `-412` / `-799` / `-352` → 风控（`FORBIDDEN`），提示配置 Cookie 后重试；HTTP `412` 同样处理。
- `-101` → 未登录（`UNAUTHORIZED`），搜索接口通常需要 Cookie。
- `searchByInterests` 会吞掉单个兴趣的失败（风控/无结果），只透传取消信号，适合自主行为批处理。

---

## 7. 自检清单（上线前）

1. `npx tsc --noEmit -p tsconfig.json` 通过（本目录在 `include` 内）。
2. 设置页 save 后调用 `integrations.probeAll()`：`configured` 与 `connected` 均符合预期。
3. DeepSeek 流式：`onDelta` 能收到增量，最终 `content` 与直接 `chat()` 一致。
4. 语音：带 `[轻笑]` 的文本能合成且时长正常；超长文本按 `maxChars` 分段。
5. 图像：base64 模式在 `assetsPath` 下生成文件；视频任务用 `signal` 取消后不再轮询。
6. 音乐：生成成功后有本地 `audioPath`；失败态能正确抛出中文错误。
7. 搜索：`SearchResultItem[]` 的 `title/url/snippet` 非空；图片结果 `url` 可直接下载。
8. B 站：无 Cookie 时排行榜可用；搜索报风控时错误文案提示配置 Cookie。
9. 确认日志/错误信息中**不出现任何密钥**（本层已保证，但调用方不要打印 `apiKeys` 对象）。
