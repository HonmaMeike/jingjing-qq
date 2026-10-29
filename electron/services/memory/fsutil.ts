// 文件系统小工具：原子写、按需读、目录遍历。
import { createHash, randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

export async function ensureDir(dir: string): Promise<void> {
  await fsp.mkdir(dir, { recursive: true });
}

/**
 * 原子写：同目录临时文件 -> fsync -> rename。
 * 崩溃或并发下读到的永远是完整内容，不会出现半截 Markdown。
 */
export async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureDir(dir);
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now().toString(36)}.${randomBytes(4).toString('hex')}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
  try {
    handle = await fsp.open(tmp, 'w');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }
  try {
    await fsp.rename(tmp, filePath);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fsp.readFile(filePath, 'utf8');
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
}

export async function fileSizeIfExists(filePath: string): Promise<number> {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile() ? stat.size : 0;
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return 0;
    throw error;
  }
}

export async function removeIfExists(target: string, options: { recursive?: boolean } = {}): Promise<void> {
  await fsp.rm(target, { force: true, recursive: options.recursive ?? false });
}

export function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

export function sha1Short(input: string, length = 8): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}

/** 列出目录下所有文件（递归，返回绝对路径），目录不存在时返回空数组。 */
export async function walkFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/** 文件名排序稳定的时间戳（用于摘要/归档文件名）。 */
export function fileTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
