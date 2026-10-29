import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import { build } from 'esbuild';

const server = await createServer({ server: { port: 5273, strictPort: true } });
await server.listen();
console.log('[dev] renderer http://127.0.0.1:5273');

await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outdir: 'dist-electron', outExtension: { '.js': '.cjs' },
  external: ['electron'], sourcemap: 'inline', logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify('development') },
});

const electron = (await import('electron')).default;
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5273', NODE_ENV: 'development' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env });
child.on('close', async (code) => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', () => { child.kill(); server.close(); });
