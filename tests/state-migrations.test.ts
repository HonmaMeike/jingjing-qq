import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { migrateStateFiles } from '../electron/services/state-migrations';

describe('状态文件迁移', () => {
  it('补版本号并备份旧文件', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jj-state-test-'));
    await fs.writeFile(path.join(dir, 'emotion.json'), JSON.stringify({ byPersona: {}, log: [] }), 'utf8');
    await migrateStateFiles(dir, { info: () => undefined, warn: () => undefined });
    const saved = JSON.parse(await fs.readFile(path.join(dir, 'emotion.json'), 'utf8')) as { version?: number };
    expect(saved.version).toBe(2);
    const backups = await fs.readdir(path.join(dir, 'backups'));
    expect(backups.length).toBeGreaterThan(0);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
