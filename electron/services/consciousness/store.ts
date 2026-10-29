// 意识结构持久化：<dataDir>/consciousness/{sea,origin,attention,flow}.json
// - 每个文件内部按 personaId 分区，人设之间互不可见；
// - 全部写入都是「临时文件 + fsync + rename」的原子写，并按文件串行化；
// - 不往记忆 Markdown 里写任何意识数据。
import { createHash, randomBytes } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import {
  ATTENTION_FILE,
  CONSCIOUSNESS_VERSION,
  FLOW_FILE,
  ORIGIN_FILE,
  SEA_FILE,
} from './types';
import type {
  AttentionFile,
  AttentionRecord,
  ConsciousnessStats,
  FlowFile,
  FlowRecord,
  OriginData,
  OriginFile,
  SeaData,
  SeaDepth,
  SeaFile,
  SeaPointRecord,
} from './types';

const DEPTHS: SeaDepth[] = ['surface', 'shallow', 'deep', 'abyss'];

function nowIsoFrom(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const dir = path.dirname(file);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    '.' + path.basename(file) + '.' + process.pid + '.' + Date.now().toString(36) + '.' + randomBytes(4).toString('hex') + '.tmp',
  );
  const text = JSON.stringify(value, null, 2);
  let handle: Awaited<ReturnType<typeof fsp.open>> | undefined;
  try {
    handle = await fsp.open(tmp, 'w');
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
  try {
    await fsp.rename(tmp, file);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readJson<T>(file: string, fallback: T, logger?: { warn: (scope: string, ...args: unknown[]) => void }): Promise<T> {
  try {
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as T;
    return fallback;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return fallback;
    // 文件损坏：保留一份 .corrupt 备份，再从空数据继续，避免意识服务整体起不来。
    try {
      const backup = file + '.corrupt-' + Date.now() + '.json';
      await fsp.rename(file, backup);
      logger?.warn('consciousness', '意识数据文件损坏，已备份为 ' + backup);
    } catch {
      // ignore
    }
    return fallback;
  }
}

function emptySea(): SeaFile {
  return { version: CONSCIOUSNESS_VERSION, updatedAt: new Date(0).toISOString(), byPersona: {} };
}
function emptyOrigin(): OriginFile {
  return { version: CONSCIOUSNESS_VERSION, updatedAt: new Date(0).toISOString(), byPersona: {} };
}
function emptyAttention(): AttentionFile {
  return { version: CONSCIOUSNESS_VERSION, updatedAt: new Date(0).toISOString(), byPersona: {} };
}
function emptyFlow(): FlowFile {
  return { version: CONSCIOUSNESS_VERSION, updatedAt: new Date(0).toISOString(), byPersona: {} };
}

export class ConsciousnessStore {
  private sea: SeaFile = emptySea();
  private originFile: OriginFile = emptyOrigin();
  private attentionFile: AttentionFile = emptyAttention();
  private flowFile: FlowFile = emptyFlow();
  private readonly chains = new Map<string, Promise<unknown>>();

  private constructor(
    readonly dir: string,
    private readonly now: () => Date,
    private readonly logger?: { warn: (scope: string, ...args: unknown[]) => void },
  ) {}

  static async create(
    dataDir: string,
    options: { now?: () => Date; logger?: { warn: (scope: string, ...args: unknown[]) => void } } = {},
  ): Promise<ConsciousnessStore> {
    const dir = path.join(dataDir, 'consciousness');
    await fsp.mkdir(dir, { recursive: true });
    const store = new ConsciousnessStore(dir, options.now ?? (() => new Date()), options.logger);
    await store.load();
    return store;
  }

  private get seaPath(): string { return path.join(this.dir, SEA_FILE); }
  private get originPath(): string { return path.join(this.dir, ORIGIN_FILE); }
  private get attentionPath(): string { return path.join(this.dir, ATTENTION_FILE); }
  private get flowPath(): string { return path.join(this.dir, FLOW_FILE); }

  async load(): Promise<void> {
    this.sea = await readJson<SeaFile>(this.seaPath, emptySea(), this.logger);
    this.originFile = await readJson<OriginFile>(this.originPath, emptyOrigin(), this.logger);
    this.attentionFile = await readJson<AttentionFile>(this.attentionPath, emptyAttention(), this.logger);
    this.flowFile = await readJson<FlowFile>(this.flowPath, emptyFlow(), this.logger);
    this.sea.byPersona ??= {};
    this.originFile.byPersona ??= {};
    this.attentionFile.byPersona ??= {};
    this.flowFile.byPersona ??= {};
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(key) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    this.chains.set(key, run.then(() => undefined, () => undefined));
    return run;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }

  // -------------------------------------------------------------------------
  // 读取（返回克隆，防止外部改内存）
  // -------------------------------------------------------------------------

  seaPoints(personaId: string): SeaPointRecord[] {
    return clone(this.sea.byPersona[personaId]?.points ?? []);
  }

  seaUpdatedAt(personaId: string): string | undefined {
    return this.sea.byPersona[personaId]?.updatedAt;
  }

  origin(personaId: string): OriginData | undefined {
    const found = this.originFile.byPersona[personaId];
    return found ? clone(found) : undefined;
  }

  attention(personaId: string, conversationId: string): AttentionRecord | undefined {
    const found = this.attentionFile.byPersona[personaId]?.[conversationId];
    return found ? clone(found) : undefined;
  }

  attentionList(personaId: string): AttentionRecord[] {
    const bucket = this.attentionFile.byPersona[personaId] ?? {};
    return Object.values(bucket).map(clone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  flow(personaId: string, conversationId: string): FlowRecord | undefined {
    const found = this.flowFile.byPersona[personaId]?.[conversationId];
    return found ? clone(found) : undefined;
  }

  flowList(personaId: string): FlowRecord[] {
    const bucket = this.flowFile.byPersona[personaId] ?? {};
    return Object.values(bucket).map(clone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  personas(): string[] {
    return [...new Set([
      ...Object.keys(this.sea.byPersona),
      ...Object.keys(this.originFile.byPersona),
      ...Object.keys(this.attentionFile.byPersona),
      ...Object.keys(this.flowFile.byPersona),
    ])].sort();
  }

  // -------------------------------------------------------------------------
  // 写入（原子 + 串行）
  // -------------------------------------------------------------------------

  async saveSea(personaId: string, data: SeaData): Promise<void> {
    this.sea.byPersona[personaId] = clone({ points: data.points, updatedAt: data.updatedAt });
    this.sea.updatedAt = nowIsoFrom(this.now);
    await this.enqueue('sea', () => writeJsonAtomic(this.seaPath, this.sea));
  }

  async saveOrigin(data: OriginData): Promise<void> {
    this.originFile.byPersona[data.personaId] = clone(data);
    this.originFile.updatedAt = nowIsoFrom(this.now);
    await this.enqueue('origin', () => writeJsonAtomic(this.originPath, this.originFile));
  }

  async saveAttention(record: AttentionRecord): Promise<void> {
    const bucket = this.attentionFile.byPersona[record.personaId] ?? {};
    bucket[record.conversationId] = clone(record);
    this.attentionFile.byPersona[record.personaId] = bucket;
    this.attentionFile.updatedAt = nowIsoFrom(this.now);
    await this.enqueue('attention', () => writeJsonAtomic(this.attentionPath, this.attentionFile));
  }

  async saveFlow(record: FlowRecord): Promise<void> {
    const bucket = this.flowFile.byPersona[record.personaId] ?? {};
    bucket[record.conversationId] = clone(record);
    this.flowFile.byPersona[record.personaId] = bucket;
    this.flowFile.updatedAt = nowIsoFrom(this.now);
    await this.enqueue('flow', () => writeJsonAtomic(this.flowPath, this.flowFile));
  }

  stats(): ConsciousnessStats {
    let seaPoints = 0;
    const depth: Record<SeaDepth, number> = { surface: 0, shallow: 0, deep: 0, abyss: 0 };
    const conversations = new Set<string>();
    for (const data of Object.values(this.sea.byPersona)) {
      seaPoints += data.points.length;
      for (const point of data.points) {
        if (DEPTHS.includes(point.depth)) depth[point.depth] += 1;
      }
    }
    for (const bucket of Object.values(this.attentionFile.byPersona)) {
      for (const conversationId of Object.keys(bucket)) conversations.add(conversationId);
    }
    return {
      personas: this.personas().length,
      conversations: conversations.size,
      seaPoints,
      depth,
      files: [this.seaPath, this.originPath, this.attentionPath, this.flowPath],
    };
  }

  /** 供测试/诊断：文件名哈希，用于确认没有跨 persona 混写。 */
  static hash(input: string): string {
    return createHash('sha1').update(input).digest('hex').slice(0, 12);
  }
}
