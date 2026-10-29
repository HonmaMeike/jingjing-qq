import { safeStorage } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { ApiKeys, ApiKeyStatus } from '../../shared/types';

const EMPTY: ApiKeys = { deepseek: '', breezeblue: '', minimax: '', suno: '', serper: '' };

export class SecretsVault {
  private keys: ApiKeys = { ...EMPTY };
  private usePlain = false;

  constructor(private file: string) {
    fsSync.mkdirSync(path.dirname(file), { recursive: true });
  }

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const envelope = JSON.parse(raw) as { encrypted?: boolean; payload?: string };
      if (!envelope.payload) return;
      let text: string;
      if (envelope.encrypted) {
        if (!safeStorage.isEncryptionAvailable()) { this.usePlain = true; return; }
        text = safeStorage.decryptString(Buffer.from(envelope.payload, 'base64'));
      } else {
        this.usePlain = true;
        text = Buffer.from(envelope.payload, 'base64').toString('utf8');
      }
      this.keys = { ...EMPTY, ...(JSON.parse(text) as Partial<ApiKeys>) };
    } catch { /* first run */ }
  }

  private async save(): Promise<void> {
    const text = JSON.stringify(this.keys);
    const encrypted = safeStorage.isEncryptionAvailable();
    const payload = encrypted ? safeStorage.encryptString(text).toString('base64') : Buffer.from(text).toString('base64');
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ encrypted, payload, version: 1 }, null, 2), 'utf8');
    await fs.rename(tmp, this.file);
  }

  get(): ApiKeys { return { ...this.keys }; }
  getStatus(): ApiKeyStatus {
    return { deepseek: !!this.keys.deepseek, breezeblue: !!this.keys.breezeblue, minimax: !!this.keys.minimax, suno: !!this.keys.suno, serper: !!this.keys.serper };
  }
  has(id: keyof ApiKeys): boolean { return !!this.keys[id]; }
  async set(patch: Partial<ApiKeys>): Promise<ApiKeyStatus> {
    for (const [key, value] of Object.entries(patch)) {
      if (key in this.keys && typeof value === 'string') this.keys[key as keyof ApiKeys] = value.trim();
    }
    await this.save();
    return this.getStatus();
  }
  async clear(id?: keyof ApiKeys): Promise<ApiKeyStatus> {
    if (id) this.keys[id] = ''; else this.keys = { ...EMPTY };
    await this.save();
    return this.getStatus();
  }
  mask(id: keyof ApiKeys): string {
    const value = this.keys[id];
    if (!value) return '';
    if (value.length <= 8) return '••••••••';
    return `${value.slice(0, 4)}••••••••${value.slice(-3)}`;
  }
  isPlainFallback(): boolean { return this.usePlain; }
}
