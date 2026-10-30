import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Persona } from '../../shared/types';
import type { IntegrationHub } from './integration-hub';

export interface LocalSingInput {
  lyrics: string;
  outDir: string;
  persona: Persona;
  hub: IntegrationHub;
  ffmpegPath?: string;
  maxChars?: number;
}

function run(cmd: string, args: string[], timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } reject(new Error('ffmpeg 超时')); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('ffmpeg 退出码 ' + code)); });
  });
}

function resolveFfmpeg(input?: string): string {
  if (input && input.trim()) return input.trim();
  const candidates = [path.join(process.cwd(), 'resources', 'ffmpeg.exe'), path.join(process.resourcesPath || '', 'ffmpeg.exe'), 'ffmpeg'];
  return candidates.find((item) => item === 'ffmpeg' || require('node:fs').existsSync(item)) ?? 'ffmpeg';
}

/** 把歌词逐字用角色本人的 TTS 音色唱出来；没有 ffmpeg 时返回失败。 */
export async function localSing(input: LocalSingInput): Promise<{ ok: boolean; filePath?: string; error?: string }> {
  const chars = Array.from(input.lyrics).filter((ch) => /[\u4e00-\u9fff]/.test(ch)).slice(0, input.maxChars ?? 28);
  if (chars.length < 4) return { ok: false, error: '歌词太短' };
  const ffmpeg = resolveFfmpeg(input.ffmpegPath);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jingjing-sing-'));
  try {
    const notes = [0, 2, 4, 7, 9, 12, 9, 7, 4, 2];
    const parts: string[] = [];
    for (let i = 0; i < chars.length; i += 1) {
      const tts = await input.hub.synthesize(chars[i], input.persona);
      if (!tts.ok || !tts.filePath) continue;
      const ratio = Math.pow(2, notes[i % notes.length] / 12);
      const wav = path.join(tmp, 'part-' + i + '.wav');
      try {
        await run(ffmpeg, ['-y', '-i', tts.filePath, '-ar', '44100', '-af', 'asetrate=44100*' + ratio.toFixed(4) + ',atempo=' + (1 / ratio).toFixed(4) + ',apad=pad_dur=0.06', '-ac', '1', wav], 30_000);
        parts.push(wav);
      } catch { /* skip broken char */ }
    }
    if (parts.length === 0) return { ok: false, error: '逐字语音合成失败' };
    const list = path.join(tmp, 'list.txt');
    await fs.writeFile(list, parts.map((p) => "file '" + p.replace(/\\/g, '/') + "'").join('\n'), 'utf8');
    await fs.mkdir(input.outDir, { recursive: true });
    const out = path.join(input.outDir, 'sing-' + Date.now().toString(36) + '.mp3');
    await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-q:a', '4', out], 120_000);
    return { ok: true, filePath: out };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
