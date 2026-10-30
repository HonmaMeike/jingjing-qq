import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { localSing } from '../electron/services/local-sing';

function wav(seconds = 0.12): Buffer {
  const rate = 44100;
  const samples = Math.max(1, Math.floor(rate * seconds));
  const data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples * 2, 4); data.write('WAVE', 8);
  data.write('fmt ', 12); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) data.writeInt16LE(Math.round(Math.sin((i / rate) * 440 * Math.PI * 2) * 8000), 44 + i * 2);
  return data;
}

describe('本地逐字演唱', () => {
  it('把多个 TTS 片段拼接为 mp3', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jj-sing-test-'));
    const file = path.join(dir, 'note.wav');
    await fs.writeFile(file, wav());
    const fakeHub = { synthesize: async () => ({ ok: true, filePath: file, url: '' }) } as never;
    const result = await localSing({ lyrics: '白饭真好吃呀真好吃', outDir: path.join(dir, 'out'), persona: {} as never, hub: fakeHub as never });
    expect(result.ok).toBe(true);
    expect(result.filePath && (await fs.stat(result.filePath)).size).toBeGreaterThan(1000);
    await fs.rm(dir, { recursive: true, force: true });
  }, 120000);
});
