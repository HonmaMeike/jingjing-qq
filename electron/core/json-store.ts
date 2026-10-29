import fs from 'node:fs/promises';
import path from 'node:path';
import fsSync from 'node:fs';

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (Array.isArray(base) || Array.isArray(patch) || typeof base !== 'object' || typeof patch !== 'object') {
    return patch as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key];
    if (current && typeof current === 'object' && !Array.isArray(current) && value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

export class JsonStore<T extends object> {
  private cache: T;
  private initial: T;
  private writeChain: Promise<void> = Promise.resolve();

  private constructor(private file: string, defaults: T) {
    this.cache = structuredClone(defaults);
    this.initial = structuredClone(defaults);
    fsSync.mkdirSync(path.dirname(file), { recursive: true });
  }

  static async open<T extends object>(file: string, defaults: T): Promise<JsonStore<T>> {
    const store = new JsonStore<T>(file, defaults);
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      this.cache = deepMerge(structuredClone(this.defaults()), parsed);
    } catch {
      await this.persist();
    }
  }

  private defaults(): T {
    return this.initial;
  }

  async persist(): Promise<void> {
    const snapshot = JSON.stringify(this.cache, null, 2);
    const task = async () => {
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(tmp, snapshot, 'utf8');
      await fs.rename(tmp, this.file);
    };
    this.writeChain = this.writeChain.then(task, task);
    return this.writeChain;
  }

  get(): T { return structuredClone(this.cache); }
  set(value: T): Promise<void> { this.cache = structuredClone(value); return this.persist(); }
  async update(mutator: (draft: T) => T | void): Promise<T> {
    const draft = structuredClone(this.cache);
    const result = mutator(draft) ?? draft;
    this.cache = structuredClone(result);
    await this.persist();
    return this.get();
  }
  patch(patch: unknown): Promise<T> {
    return this.update((draft) => deepMerge(draft, patch));
  }
  get filePath() { return this.file; }
}

export { deepMerge };
