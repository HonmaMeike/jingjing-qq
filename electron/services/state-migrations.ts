import fs from 'node:fs/promises';
import path from 'node:path';

const VERSIONS: Record<string, number> = {
  'emotion.json': 2,
  'conversations.json': 2,
  'growth.json': 2,
  'stickers.json': 2,
};

/** 给旧 JSON 状态补版本号；升级前备份一次，避免格式迁移不可逆。 */
export async function migrateStateFiles(dataDir: string, logger?: { info: (msg: string) => void; warn: (msg: string) => void }): Promise<void> {
  const backupDir = path.join(dataDir, 'backups', 'state-' + new Date().toISOString().slice(0, 10));
  for (const [file, version] of Object.entries(VERSIONS)) {
    const full = path.join(dataDir, file);
    try {
      const raw = await fs.readFile(full, 'utf8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const current = Number(data.version ?? 0);
      if (current >= version) continue;
      await fs.mkdir(backupDir, { recursive: true });
      await fs.writeFile(path.join(backupDir, file), raw, 'utf8');
      data.version = version;
      await fs.writeFile(full + '.tmp', JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(full + '.tmp', full);
      logger?.info('state-migrations: ' + file + ' ' + current + ' → ' + version);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger?.warn('state-migrations: ' + file + ' 迁移失败：' + (error as Error).message);
    }
  }
}
