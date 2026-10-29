import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

export interface AppPaths {
  dataDir: string;
  settingsFile: string;
  secretsFile: string;
  conversationsDir: string;
  memoriesDir: string;
  diaryDir: string;
  activityDir: string;
  mediaDir: string;
  qzoneDir: string;
  logsDir: string;
  pluginsDir: string;
  napcatDir: string;
  bundledPetDir: string;
  defaultExternalPetDir: string;
}

export function resolvePaths(): AppPaths {
  const dataDir = process.env.JINGJING_DATA_DIR
    ? path.resolve(process.env.JINGJING_DATA_DIR)
    : path.join(app.getPath('userData'), 'data');
  const dirs = {
    dataDir,
    conversationsDir: path.join(dataDir, 'conversations'),
    memoriesDir: path.join(dataDir, 'memories'),
    diaryDir: path.join(dataDir, 'diary'),
    activityDir: path.join(dataDir, 'activity'),
    mediaDir: path.join(dataDir, 'media'),
    qzoneDir: path.join(dataDir, 'qzone'),
    logsDir: path.join(dataDir, 'logs'),
    pluginsDir: path.join(dataDir, 'plugins'),
    napcatDir: path.join(dataDir, 'napcat'),
  };
  for (const d of Object.values(dirs)) {
    try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ }
  }
  const bundledPetDir = app.isPackaged
    ? path.join(process.resourcesPath, 'pet')
    : path.join(app.getAppPath(), 'public', 'pet');
  const defaultExternalPetDir = app.isPackaged ? path.join(process.resourcesPath, 'pet') : path.join(app.getAppPath(), 'dsh-pet-assets');
  return {
    ...dirs,
    settingsFile: path.join(dataDir, 'settings.json'),
    secretsFile: path.join(dataDir, 'secrets.enc.json'),
    bundledPetDir,
    defaultExternalPetDir,
  };
}
