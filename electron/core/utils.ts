import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';

export function uid(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

export function nowIso(): string { return new Date().toISOString(); }

export function sanitizeId(input: string, fallback = 'unknown'): string {
  const cleaned = String(input ?? '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return cleaned || fallback;
}

export function clamp(num: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(num) ? num : min));
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const other = text.length - chinese;
  return Math.ceil(chinese * 1.15 + other / 3.6);
}

export function containsWakeWord(text: string, words: string[]): boolean {
  return words.some((w) => w && text.includes(w));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  if (!text) return fallback;
  const candidates = [text];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const start = text.indexOf('{'); const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate) as T; } catch { /* next */ }
  }
  return fallback;
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function safeFileName(input: string): string {
  return String(input).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 120) || 'untitled';
}

export function resolveInside(root: string, ...parts: string[]): string {
  const resolved = path.resolve(root, ...parts);
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes root');
  return resolved;
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分 ${sec} 秒`;
  return `${sec} 秒`;
}
