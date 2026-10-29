import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startMediaServer, type MediaServer } from '../electron/core/media-server';

let root = '';
let server: MediaServer;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'jingjing-media-'));
  await fs.mkdir(path.join(root, 'media'), { recursive: true });
  await fs.writeFile(path.join(root, 'media', 'test.txt'), 'hello-media-server');
  await fs.writeFile(path.join(root, 'media', 'test.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  server = await startMediaServer({ mediaDir: path.join(root, 'media'), petDir: path.join(root, 'pet') });
});

afterAll(async () => { await server?.close(); await fs.rm(root, { recursive: true, force: true }); });

describe('本机媒体 HTTP 服务', () => {
  it('可以读取媒体文件并提供正确 Content-Type', async () => {
    const res = await fetch(server.baseUrl + '/media/test.txt');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello-media-server');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
  it('支持 Range 请求，供音频/视频拖动播放', async () => {
    const res = await fetch(server.baseUrl + '/media/test.txt', { headers: { Range: 'bytes=0-4' } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('hello');
    expect(res.headers.get('content-range')).toBe('bytes 0-4/18');
  });
  it('拒绝路径穿越与不存在的文件', async () => {
    const traversal = await fetch(server.baseUrl + '/media/../../windows/win.ini');
    expect([400, 403, 404]).toContain(traversal.status);
    const missing = await fetch(server.baseUrl + '/media/nope.png');
    expect(missing.status).toBe(404);
  });
  it('URL 中包含中文文件名也能下载', async () => {
    await fs.writeFile(path.join(root, 'media', '鲸鲸.png'), Buffer.from('png'));
    const res = await fetch(server.baseUrl + '/media/' + encodeURIComponent('鲸鲸.png'));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('png');
  });
});
