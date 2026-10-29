import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'screenshots');
await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
const dataDir = path.join(root, '.data-shot');
await fs.rm(dataDir, { recursive: true, force: true });

const env = { ...process.env, JINGJING_SCREENSHOT_DIR: outDir, JINGJING_DATA_DIR: dataDir, JINGJING_TEST_LOG: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const electron = (await import('electron')).default;
const child = spawn(electron, ['.'], { cwd: root, env, stdio: 'inherit' });
let finished = false;
child.on('close', (code) => { finished = true; console.log('screenshot process exit', code); process.exit(code ?? 0); });
setTimeout(() => { if (!finished) { console.log('screenshot timeout, killing app'); child.kill(); setTimeout(() => process.exit(1), 1200); } }, 90000);
