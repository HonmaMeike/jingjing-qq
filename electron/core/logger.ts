import fs from 'node:fs';
import path from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  private file: string;
  private listeners = new Set<(line: string, level: Level) => void>();

  constructor(logDir: string) {
    fs.mkdirSync(logDir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    this.file = path.join(logDir, `jingjing-${day}.log`);
  }

  private write(level: Level, scope: string, args: unknown[]): string {
    const time = new Date().toISOString();
    const text = args.map((a) => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    const line = `[${time}] [${level.toUpperCase()}] [${scope}] ${text}`;
    try { fs.appendFileSync(this.file, line + '\n', 'utf8'); } catch { /* ignore */ }
    for (const listener of this.listeners) { try { listener(line, level); } catch { /* ignore */ } }
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    return line;
  }

  debug(scope: string, ...args: unknown[]) { return this.write('debug', scope, args); }
  info(scope: string, ...args: unknown[]) { return this.write('info', scope, args); }
  warn(scope: string, ...args: unknown[]) { return this.write('warn', scope, args); }
  error(scope: string, ...args: unknown[]) { return this.write('error', scope, args); }
  subscribe(fn: (line: string, level: Level) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get logFile() { return this.file; }
}
