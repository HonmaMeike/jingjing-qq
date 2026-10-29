import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.webm': 'video/webm', '.gif': 'image/gif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
};

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export interface MediaServer {
  baseUrl: string;
  close: () => Promise<void>;
}

/** 本机媒体文件 HTTP 服务：绕过 Chromium 自定义协议在中文路径/请求头上的兼容问题，并支持 Range。 */
export async function startMediaServer(options: { mediaDir: string; petDir: string; externalPetDir?: string; preferredPort?: number }): Promise<MediaServer> {
  const mediaDir = path.resolve(options.mediaDir);
  const petDirs = [path.resolve(options.petDir), ...(options.externalPetDir ? [path.resolve(options.externalPetDir)] : [])];
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const pathname = decodeURIComponent(url.pathname);
      let file = '';
      if (pathname.startsWith('/media/')) {
        const candidate = path.resolve(mediaDir, pathname.slice('/media/'.length));
        if (isInside(mediaDir, candidate)) file = candidate;
      } else if (pathname.startsWith('/pet/')) {
        const rel = pathname.slice('/pet/'.length);
        for (const root of petDirs) {
          const candidate = path.resolve(root, rel);
          if (isInside(root, candidate) && fs.existsSync(candidate)) { file = candidate; break; }
        }
      }
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
      const stat = await fsp.stat(file);
      const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
      const range = req.headers.range;
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', type);
      if (range) {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        if (match) {
          let start = match[1] ? Number(match[1]) : 0;
          let end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
          if (Number.isNaN(start) || start < 0) start = 0;
          if (end < start) end = stat.size - 1;
          res.writeHead(206, { 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size, 'Content-Length': end - start + 1 });
          if (req.method === 'HEAD') { res.end(); return; }
          fs.createReadStream(file, { start, end }).pipe(res);
          return;
        }
      }
      res.writeHead(200, { 'Content-Length': stat.size });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end('Bad request');
    }
  });
  const listen = (port: number) => new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => { server.removeListener('listening', onListening); reject(error); };
    const onListening = () => { server.removeListener('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
  try {
    await listen(options.preferredPort ?? 47821);
  } catch {
    await listen(0);
  }
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    baseUrl: 'http://127.0.0.1:' + port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
