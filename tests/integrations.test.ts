import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEEPSEEK_MODEL_IDS,
  DeepSeekClient,
  MINIMAX_H3_VIDEO_MODELS,
  MINIMAX_VIDEO_DEFAULTS,
  MinimaxClient,
  isH3VideoModel,
} from '../electron/services/integrations';

interface RecordedCall {
  url: string;
  method: string;
  body: any;
  headers: Record<string, string>;
}

type MockHandler = (call: RecordedCall) => Response | Promise<Response>;

/** 用假的 fetch 拦截全部请求，测试不联网。 */
function stubFetch(handler: MockHandler): { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const mockFetch = async (input: any, init?: any): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers ?? {};
    if (rawHeaders && typeof rawHeaders === 'object') {
      for (const [key, value] of Object.entries(rawHeaders)) headers[key.toLowerCase()] = String(value);
    }
    let body: any;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = {
      url,
      method: String(init?.method ?? 'GET').toUpperCase(),
      body,
      headers,
    };
    calls.push(call);
    return handler(call);
  };
  vi.stubGlobal('fetch', mockFetch);
  return { calls };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function binaryResponse(data: string, contentType = 'video/mp4'): Response {
  return new Response(data, { status: 200, headers: { 'content-type': contentType } });
}

function sseResponse(chunks: unknown[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode('data: ' + JSON.stringify(chunk) + '\n\n'));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const chatOk = (): Response =>
  jsonResponse({
    model: 'deepseek-v4-pro',
    choices: [{ message: { content: '你好' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
  });

const messages = [{ role: 'user' as const, content: '你好' }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DeepSeek 2026-10 模型适配', () => {
  it('默认模型为官方 deepseek-v4-pro，且模型 ID 列表不再含旧模型名', () => {
    const client = new DeepSeekClient({ apiKey: 'test-key' });
    expect(client.model).toBe('deepseek-v4-pro');
    expect(client.reasoningModel).toBe('deepseek-v4-pro');
    expect([...DEEPSEEK_MODEL_IDS]).toEqual(['deepseek-v4-pro', 'deepseek-flash']);
    expect(JSON.stringify([client.model, client.reasoningModel])).not.toContain('deepseek-chat');
    expect(JSON.stringify([client.model, client.reasoningModel])).not.toContain('deepseek-reasoner');
  });

  it('默认请求体包含 thinking + reasoning_effort，且不含旧默认模型名', async () => {
    const { calls } = stubFetch(() => chatOk());
    const client = new DeepSeekClient({ apiKey: 'test-key' });

    await client.chat(messages);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions');
    expect(calls[0].method).toBe('POST');
    const body = calls[0].body;
    expect(body.model).toBe('deepseek-v4-pro');
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('high');
    // 新模型支持 temperature（不再按旧 reasoner 规避）
    expect(body.temperature).toBe(0.8);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('deepseek-chat');
    expect(serialized).not.toContain('deepseek-reasoner');
  });

  it('thinking:false / reasoningEffort:max / JSON mode 对新模型同时生效', async () => {
    const { calls } = stubFetch(() => chatOk());
    const client = new DeepSeekClient({ apiKey: 'test-key' });

    await client.chat(messages, {
      thinking: false,
      reasoningEffort: 'max',
      jsonMode: true,
      temperature: 0.2,
    });

    const body = calls[0].body;
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.reasoning_effort).toBe('max');
    expect(body.temperature).toBe(0.2);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('旧模型名保留兼容逻辑：deepseek-chat 不发明 thinking；deepseek-reasoner 仍规避 temperature/JSON', async () => {
    const { calls } = stubFetch(() => chatOk());
    const client = new DeepSeekClient({ apiKey: 'test-key' });

    await client.chat(messages, { model: 'deepseek-chat' });
    const legacyChatBody = calls[0].body;
    expect(legacyChatBody.model).toBe('deepseek-chat');
    expect(legacyChatBody).not.toHaveProperty('thinking');
    expect(legacyChatBody).not.toHaveProperty('reasoning_effort');
    expect(legacyChatBody.temperature).toBe(0.8);

    await client.chat(messages, { model: 'deepseek-reasoner', jsonMode: true, temperature: 0.3 });
    const legacyReasonerBody = calls[1].body;
    expect(legacyReasonerBody.model).toBe('deepseek-reasoner');
    expect(legacyReasonerBody).not.toHaveProperty('thinking');
    expect(legacyReasonerBody).not.toHaveProperty('reasoning_effort');
    expect(legacyReasonerBody).not.toHaveProperty('temperature');
    expect(legacyReasonerBody).not.toHaveProperty('response_format');
  });

  it('流式 reasoning_content 与 usage 统计保持兼容', async () => {
    const { calls } = stubFetch(() =>
      sseResponse([
        { model: 'deepseek-v4-pro', choices: [{ delta: { content: '你' } }] },
        { model: 'deepseek-v4-pro', choices: [{ delta: { reasoning_content: '思考中' } }] },
        {
          model: 'deepseek-v4-pro',
          choices: [{ delta: { content: '好' }, finish_reason: 'stop' }],
        },
        {
          model: 'deepseek-v4-pro',
          choices: [],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
            completion_tokens_details: { reasoning_tokens: 6 },
          },
        },
      ]),
    );
    const client = new DeepSeekClient({ apiKey: 'test-key' });
    const deltas: Array<{ content: string; reasoning: string }> = [];

    const result = await client.chat(messages, {
      stream: true,
      onDelta: (delta) => deltas.push(delta),
    });

    expect(result.content).toBe('你好');
    expect(result.reasoning).toBe('思考中');
    expect(result.usage?.totalTokens).toBe(30);
    expect(result.usage?.reasoningTokens).toBe(6);
    expect(result.finishReason).toBe('stop');
    expect(deltas.map((delta) => delta.content || delta.reasoning)).toEqual(['你', '思考中', '好']);
    // 流式同样带上新模型参数
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].body.thinking).toEqual({ type: 'enabled' });
    expect(calls[0].body.reasoning_effort).toBe('high');
  });

  it('testConnection 基于 /models 且不依赖旧模型名', async () => {
    const { calls } = stubFetch((call) => {
      if (call.url.endsWith('/models')) {
        return jsonResponse({
          data: [{ id: 'deepseek-v4-pro' }, { id: 'deepseek-flash' }],
        });
      }
      return jsonResponse({});
    });
    const client = new DeepSeekClient({ apiKey: 'test-key' });

    const result = await client.testConnection();

    expect(calls[0].url).toBe('https://api.deepseek.com/models');
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('deepseek-v4-pro');
    expect(result.detail).toContain('deepseek-flash');
    expect(result.detail).not.toContain('deepseek-chat');
    expect(result.detail).not.toContain('deepseek-reasoner');
  });
});

describe('MiniMax H3（V2）视频适配', () => {
  it('默认模型/分辨率/时长/比例均为 2026-10 最新值', () => {
    const client = new MinimaxClient({ apiKey: 'test-key' });
    expect(client.models.video).toBe('MiniMax-H3');
    expect([...MINIMAX_H3_VIDEO_MODELS]).toEqual([
      'MiniMax-H3',
      'MiniMax-H3-Highspeed',
      'MiniMax-H3-Lite',
      'MiniMax-H3-Max',
    ]);
    expect(MINIMAX_VIDEO_DEFAULTS).toEqual({
      model: 'MiniMax-H3',
      resolution: '2K',
      duration: 6,
      aspectRatio: '16:9',
    });
    expect(isH3VideoModel('MiniMax-H3-Max')).toBe(true);
    expect(isH3VideoModel('MiniMax-Hailuo-2.3')).toBe(false);
  });

  it('H3 创建任务走 /v2/video_generation，body 为 content + ratio', async () => {
    const { calls } = stubFetch(() => jsonResponse({ task_id: 'h3-task-1' }));
    const client = new MinimaxClient({ apiKey: 'test-key' });

    const taskId = await client.createVideoTask({ prompt: '鲸鱼在星空中游动' });

    expect(taskId).toBe('h3-task-1');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.minimax.io/v2/video_generation');
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['authorization']).toBe('Bearer test-key');
    expect(calls[0].body).toEqual({
      model: 'MiniMax-H3',
      content: [{ type: 'text', text: '鲸鱼在星空中游动' }],
      resolution: '2K',
      duration: 6,
      ratio: '16:9',
    });
  });

  it('H3 创建响应兼容 task.id，并支持自定义 ratio/resolution/时长', async () => {
    const { calls } = stubFetch(() => jsonResponse({ task: { id: 'h3-task-2' } }));
    const client = new MinimaxClient({ apiKey: 'test-key' });

    const taskId = await client.createVideoTask({
      prompt: '竖屏视频',
      aspectRatio: '9:16',
      resolution: '768P',
      duration: 10,
    });

    expect(taskId).toBe('h3-task-2');
    expect(calls[0].body.ratio).toBe('9:16');
    expect(calls[0].body.resolution).toBe('768P');
    expect(calls[0].body.duration).toBe(10);
  });

  it('H3 参数校验与收敛：2K 仅 MiniMax-H3 支持、Max 时长收敛到 5s、ratio 不能 adaptive、暂不支持首尾帧', async () => {
    const calls: RecordedCall[] = [];
    stubFetch((call) => {
      calls.push(call);
      return jsonResponse({ task_id: 'h3-ok' });
    });

    const highspeed = new MinimaxClient({ apiKey: 'test-key', videoModel: 'MiniMax-H3-Highspeed' });
    await expect(
      highspeed.createVideoTask({ prompt: 'x', resolution: '2K' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    // 未显式指定分辨率时，Highspeed 的默认 2K 自动回退 768P 而不是报错
    await highspeed.createVideoTask({ prompt: 'x' });
    expect(calls[0].body.resolution).toBe('768P');

    // H3-Max 的最短时长为 5s，settings 可能给出 4s → 收敛而不是失败
    const max = new MinimaxClient({ apiKey: 'test-key', videoModel: 'MiniMax-H3-Max' });
    await max.createVideoTask({ prompt: 'x', duration: 4 });
    expect(calls[1].body.duration).toBe(5);
    expect(calls[1].body.resolution).toBe('768P');

    // H3-Lite 支持 480P（与 settings.ts 白名单一致）
    const lite = new MinimaxClient({ apiKey: 'test-key', videoModel: 'MiniMax-H3-Lite' });
    await lite.createVideoTask({ prompt: 'x', resolution: '480P' });
    expect(calls[2].body.resolution).toBe('480P');

    const client = new MinimaxClient({ apiKey: 'test-key' });
    await expect(
      client.createVideoTask({ prompt: 'x', aspectRatio: 'adaptive' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      client.createVideoTask({ prompt: 'x', firstFrameImage: 'https://img.local/a.png' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('H3 查询走 /v2/query/video_generation/{id}，状态映射与 url/usage 解析正确', async () => {
    const responses = [
      jsonResponse({ task: { id: 'h3-1', status: 'queued' } }),
      jsonResponse({ task: { id: 'h3-1', status: 'running' } }),
      jsonResponse({
        task: {
          id: 'h3-1',
          status: 'succeeded',
          content: { url: 'http://mock.local/v.mp4' },
          usage: { output_seconds: 6 },
        },
      }),
    ];
    let index = 0;
    const { calls } = stubFetch(() => responses[index++]);
    const client = new MinimaxClient({ apiKey: 'test-key' });

    const queued = await client.queryVideoTask('h3-1', { model: 'MiniMax-H3' });
    expect(queued.status).toBe('Queueing');
    expect(queued.rawStatus).toBe('queued');

    const running = await client.queryVideoTask('h3-1');
    expect(running.status).toBe('Processing');
    expect(running.rawStatus).toBe('running');

    const succeeded = await client.queryVideoTask('h3-1');
    expect(succeeded.status).toBe('Success');
    expect(succeeded.downloadUrl).toBe('http://mock.local/v.mp4');
    expect(succeeded.outputSeconds).toBe(6);

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.method).toBe('GET');
      expect(call.url).toBe('https://api.minimax.io/v2/query/video_generation/h3-1');
    }
  });

  it('H3 failed/cancelled 归一化为 Fail，并带出错误信息', async () => {
    stubFetch(() =>
      jsonResponse({ task: { id: 'h3-f', status: 'failed', error: '内容不符合安全规范' } }),
    );
    const client = new MinimaxClient({ apiKey: 'test-key' });

    const failed = await client.queryVideoTask('h3-f', { model: 'MiniMax-H3' });
    expect(failed.status).toBe('Fail');
    expect(failed.rawStatus).toBe('failed');
    expect(failed.statusMessage).toBe('内容不符合安全规范');

    await expect(
      client.waitForVideoTask('h3-f', { pollIntervalMs: 1, timeoutMs: 2000 }),
    ).rejects.toMatchObject({ code: 'UPSTREAM' });
  });

  it('H3 generateVideo 直接用 task.content.url 下载，不调用 files/retrieve，fileId 用 taskId 占位', async () => {
    let queryCount = 0;
    const { calls } = stubFetch((call) => {
      if (call.url.endsWith('/v2/video_generation')) return jsonResponse({ task_id: 'h3-full' });
      if (call.url.includes('/v2/query/video_generation/h3-full')) {
        if (queryCount === 0) {
          queryCount += 1;
          return jsonResponse({ task: { id: 'h3-full', status: 'running' } });
        }
        return jsonResponse({
          task: {
            id: 'h3-full',
            status: 'succeeded',
            content: { url: 'http://mock.local/out.mp4' },
            usage: { output_seconds: 8 },
          },
        });
      }
      if (call.url === 'http://mock.local/out.mp4') return binaryResponse('h3-video-bytes');
      throw new Error('unexpected url: ' + call.url);
    });

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jingjing-h3-'));
    try {
      const client = new MinimaxClient({ apiKey: 'test-key' });
      const result = await client.generateVideo(
        { prompt: '鲸鱼在星空中游动' },
        { pollIntervalMs: 1, timeoutMs: 5000 },
        { outDir: dir },
      );

      expect(result.taskId).toBe('h3-full');
      expect(result.fileId).toBe('h3-full');
      expect(result.status).toBe('Success');
      expect(result.downloadUrl).toBe('http://mock.local/out.mp4');
      expect(result.outputSeconds).toBe(8);
      expect(result.filePath).toBeTruthy();
      expect(await fs.readFile(result.filePath as string, 'utf8')).toBe('h3-video-bytes');
      expect(calls.some((call) => call.url.includes('/v1/files/retrieve'))).toBe(false);
      expect(calls.filter((call) => call.url.includes('/v2/'))).toHaveLength(3);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('旧 Hailuo 任务继续走 V1 创建/查询/files-retrieve 全流程，默认分辨率自动回退', async () => {
    let queryCount = 0;
    const { calls } = stubFetch((call) => {
      if (call.url.endsWith('/v1/video_generation')) {
        return jsonResponse({ task_id: 'legacy-1', base_resp: { status_code: 0 } });
      }
      if (call.url.includes('/v1/query/video_generation')) {
        const processing = queryCount === 0;
        queryCount += 1;
        return jsonResponse({
          data: {
            task_id: 'legacy-1',
            status: processing ? 'Processing' : 'Success',
            file_id: 'file-9',
          },
          base_resp: { status_code: 0 },
        });
      }
      if (call.url.includes('/v1/files/retrieve')) {
        return jsonResponse({
          file: { file_id: 'file-9', download_url: 'http://mock.local/legacy.mp4' },
          base_resp: { status_code: 0 },
        });
      }
      if (call.url === 'http://mock.local/legacy.mp4') return binaryResponse('legacy-video-bytes');
      throw new Error('unexpected url: ' + call.url);
    });

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jingjing-legacy-'));
    try {
      const client = new MinimaxClient({
        apiKey: 'test-key',
        videoModel: 'MiniMax-Hailuo-2.3',
      });
      const result = await client.generateVideo(
        {
          prompt: '旧模型图生视频',
          firstFrameImage: 'https://img.local/first.png',
        },
        { pollIntervalMs: 1, timeoutMs: 5000 },
        { outDir: dir },
      );

      expect(result.fileId).toBe('file-9');
      expect(result.status).toBe('Success');
      expect(await fs.readFile(result.filePath as string, 'utf8')).toBe('legacy-video-bytes');
      expect(calls[0].url).toBe('https://api.minimax.io/v1/video_generation');
      expect(calls[0].body.model).toBe('MiniMax-Hailuo-2.3');
      expect(calls[0].body.prompt).toBe('旧模型图生视频');
      expect(calls[0].body.resolution).toBe('768P'); // 客户端默认 2K 不适用于旧模型
      expect(calls[0].body.first_frame_image).toBe('https://img.local/first.png');
      expect(calls.some((call) => call.url.includes('/v2/'))).toBe(false);
      expect(calls.some((call) => call.url.includes('/v1/files/retrieve'))).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('V2 响应缺少 base_resp 时不误判为业务错误', async () => {
    const { calls } = stubFetch(() => jsonResponse({ task: { id: 'h3-noBaseResp', status: 'queued' } }));
    const client = new MinimaxClient({ apiKey: 'test-key' });

    const taskId = await client.createVideoTask({ prompt: '无 base_resp' });
    expect(taskId).toBe('h3-noBaseResp');
    expect(calls[0].body.model).toBe('MiniMax-H3');
  });
});
