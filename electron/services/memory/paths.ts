// 路径与文档 id：所有落盘路径都必须经过这里，保证安全与隔离。
import path from 'node:path';
import { PathSafetyError } from './types';
import { sha1Short } from './fsutil';
import type { MemoryScopeKind } from './types';

/** Windows 保留设备名：即便在非 Windows 平台也规避，保证记忆目录可迁移。 */
const WINDOWS_RESERVED = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const ILLEGAL_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const COLLAPSE = /[^\p{L}\p{N}._-]+/gu;
const MAX_SEGMENT_LENGTH = 64;

/**
 * 把任意外部 id（QQ 号、群号、昵称）变成安全文件名片段。
 *
 * 规则：
 * - 去掉路径分隔符、控制字符、Windows 非法字符；
 * - 去掉首尾点/空格，保留 Unicode 字母（中文昵称可用），其余折叠为 _；
 * - 规避 Windows 保留名；
 * - 只要清洗或大小写归一改变了原文，就追加原文短哈希，避免 "a/b" 与 "a_b"
 *   这类清洗后碰撞导致不同联系人记忆串档。
 */
export function safeSegment(raw: unknown, platform: string = process.platform): string {
  const source = raw === undefined || raw === null ? '' : String(raw);
  if (source.includes('\u0000')) {
    throw new PathSafetyError('标识包含空字节，拒绝生成路径');
  }
  const maxLength = MAX_SEGMENT_LENGTH;
  let segment = source.normalize('NFKC');
  segment = segment.replace(ILLEGAL_CHARS, '_');
  // 点号全部折成下划线：既避免 ".." 残留在文件名中，也避免 Windows 的尾点问题。
  segment = segment.replace(/\./g, '_');
  segment = segment.replace(COLLAPSE, '_');
  segment = segment.replace(/^[.\s]+/u, '').replace(/[.\s]+$/u, '');
  segment = segment.replace(/_+/g, '_');

  let changed = segment !== source;
  if (platform === 'win32' || platform === 'darwin') {
    const lowered = segment.toLowerCase();
    if (lowered !== segment) {
      segment = lowered;
      changed = true;
    }
  }
  if (segment.length === 0) {
    segment = 'x';
    changed = true;
  }
  const stem = segment.split('.')[0] ?? segment;
  if (WINDOWS_RESERVED.has(stem.toLowerCase())) {
    segment = `_${segment}`;
    changed = true;
  }
  if (segment.length > maxLength) {
    segment = segment.slice(0, maxLength);
    changed = true;
  }
  if (changed) {
    segment = `${segment}-${sha1Short(source)}`;
  }
  return segment;
}

/**
 * 解析 rootDir 内的绝对路径，并校验没有越界（`..`、绝对路径、符号链接逃逸由调用方另行处理）。
 */
export function resolveInside(rootDir: string, ...parts: string[]): string {
  const rootAbs = path.resolve(rootDir);
  const target = path.resolve(rootAbs, ...parts);
  const relative = path.relative(rootAbs, target);
  if (relative.length === 0) {
    throw new PathSafetyError('路径解析为目标根目录本身，拒绝写入');
  }
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new PathSafetyError(`路径越界：${target}`);
  }
  return target;
}

export function isInside(rootDir: string, candidate: string): boolean {
  const rootAbs = path.resolve(rootDir);
  const target = path.resolve(candidate);
  const relative = path.relative(rootAbs, target);
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// ---------------------------------------------------------------------------
// 文档 id 与存储布局
//   <root>/users/<safeQQ>.md                          私聊联系人（集中存放）
//   <root>/groups/<safeGroupId>/group.md              群记忆
//   <root>/groups/<safeGroupId>/members/<safeQQ>.md   群内成员记忆
//   <root>/global/self.md                             全局自我记忆
//   <root>/summaries/<docId>/<timestamp>.json         版本化摘要
//   <root>/archive/<docId>/<timestamp>.json           原始消息归档（只增不删）
// ---------------------------------------------------------------------------

export function userDocId(userId: string, platform?: string): string {
  return `user_${safeSegment(userId, platform)}`;
}

export function groupDocId(groupId: string, platform?: string): string {
  return `group_${safeSegment(groupId, platform)}`;
}

export function memberDocId(groupId: string, userId: string, platform?: string): string {
  return `${groupDocId(groupId, platform)}__user_${safeSegment(userId, platform)}`;
}

export function docIdFor(scope: MemoryScopeKind, externalId: string, groupId?: string, platform?: string): string {
  switch (scope) {
    case 'group':
      return groupDocId(externalId, platform);
    case 'user':
      return groupId ? memberDocId(groupId, externalId, platform) : userDocId(externalId, platform);
    case 'global':
      return 'global_self';
    case 'persona':
      return `persona_${safeSegment(externalId, platform)}`;
    default:
      throw new PathSafetyError(`未知记忆作用域：${String(scope)}`);
  }
}

export function userDocPath(rootDir: string, userId: string, platform?: string): string {
  return resolveInside(rootDir, 'users', `${safeSegment(userId, platform)}.md`);
}

export function groupDocPath(rootDir: string, groupId: string, platform?: string): string {
  return resolveInside(rootDir, 'groups', safeSegment(groupId, platform), 'group.md');
}

export function memberDocPath(rootDir: string, groupId: string, userId: string, platform?: string): string {
  return resolveInside(rootDir, 'groups', safeSegment(groupId, platform), 'members', `${safeSegment(userId, platform)}.md`);
}

export function globalDocPath(rootDir: string): string {
  return resolveInside(rootDir, 'global', 'self.md');
}

export function docFilePath(
  rootDir: string,
  input: { scope: MemoryScopeKind; externalId: string; groupId?: string; platform?: string },
): string {
  const { scope, externalId, groupId, platform } = input;
  if (scope === 'user') {
    return groupId ? memberDocPath(rootDir, groupId, externalId, platform) : userDocPath(rootDir, externalId, platform);
  }
  if (scope === 'group') return groupDocPath(rootDir, externalId, platform);
  if (scope === 'global') return globalDocPath(rootDir);
  return resolveInside(rootDir, 'users', `persona_${safeSegment(externalId, platform)}.md`);
}

export function summariesDir(rootDir: string, docId: string, platform?: string): string {
  return resolveInside(rootDir, 'summaries', safeSegment(docId, platform));
}

export function summaryFilePath(rootDir: string, docId: string, stamp: string, platform?: string): string {
  return resolveInside(summariesDir(rootDir, docId, platform), `${stamp}.json`);
}

export function archiveDir(rootDir: string, docId: string, platform?: string): string {
  return resolveInside(rootDir, 'archive', safeSegment(docId, platform));
}

export function archiveFilePath(rootDir: string, docId: string, stamp: string, platform?: string): string {
  return resolveInside(archiveDir(rootDir, docId, platform), `${stamp}.json`);
}

export const STORAGE_LAYOUT = {
  users: 'users',
  groups: 'groups',
  global: 'global',
  summaries: 'summaries',
  archive: 'archive',
} as const;
