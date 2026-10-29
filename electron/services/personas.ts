import fs from 'node:fs/promises';
import type { Persona, PersonaSettings } from '../../shared/types';
import { BUILTIN_PERSONAS } from '../../shared/personas';
import { JsonStore } from '../core/json-store';
import { EventBus } from '../core/event-bus';
import { nowIso, uid } from '../core/utils';

interface PersonaStoreShape { overrides: Record<string, Persona>; custom: Persona[] }

export class PersonaService {
  private store!: JsonStore<PersonaStoreShape>;

  private constructor(private file: string, private events: EventBus, private getActiveId: () => string, private logger: { info: (s: string, ...a: unknown[]) => void }) {}

  static async create(opts: { file: string; events: EventBus; getActiveId: () => string; logger: { info: (s: string, ...a: unknown[]) => void } }): Promise<PersonaService> {
    const svc = new PersonaService(opts.file, opts.events, opts.getActiveId, opts.logger);
    svc.store = await JsonStore.open<PersonaStoreShape>(opts.file, { overrides: {}, custom: [] });
    return svc;
  }

  list(): Persona[] {
    const data = this.store.get();
    const activeId = this.getActiveId();
    const builtins = BUILTIN_PERSONAS.map((p) => {
      const overridden = data.overrides[p.id];
      return { ...p, ...(overridden ?? {}), isActive: p.id === activeId };
    });
    const custom = data.custom.map((p) => ({ ...p, isActive: p.id === activeId }));
    return [...builtins, ...custom];
  }

  get(id: string): Persona | undefined {
    return this.list().find((p) => p.id === id);
  }

  active(): Persona {
    return this.get(this.getActiveId()) ?? this.list()[0];
  }

  async setActive(id: string): Promise<Persona> {
    const persona = this.get(id);
    if (!persona) throw new Error('人设不存在');
    this.events.emit('persona:change', { personaId: id });
    this.logger.info('persona', '切换人设:', persona.name);
    return persona;
  }

  async save(input: Partial<Persona> & { name: string }): Promise<Persona> {
    await fs.mkdir(this.file.replace(/[/\\][^/\\]+$/, ''), { recursive: true });
    const data = this.store.get();
    const builtin = input.id ? BUILTIN_PERSONAS.find((p) => p.id === input.id) : undefined;
    if (builtin) {
      const merged: Persona = { ...builtin, ...data.overrides[builtin.id], ...input, id: builtin.id, isBuiltin: true, updatedAt: nowIso() };
      data.overrides[builtin.id] = merged;
      await this.store.set(data);
      return merged;
    }
    const existingIndex = input.id ? data.custom.findIndex((p) => p.id === input.id) : -1;
    if (existingIndex >= 0) {
      data.custom[existingIndex] = { ...data.custom[existingIndex], ...input, updatedAt: nowIso() };
      await this.store.set(data);
      return data.custom[existingIndex];
    }
    const base = BUILTIN_PERSONAS.find((p) => p.id === (input.baseTemplateId ?? 'jingjing')) ?? BUILTIN_PERSONAS[0];
    const persona: Persona = {
      ...base,
      ...input,
      id: input.id ?? uid('persona-'),
      isBuiltin: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      baseTemplateId: input.baseTemplateId ?? base.id,
      name: input.name,
      nickname: input.nickname ?? input.name,
    };
    data.custom.push(persona);
    await this.store.set(data);
    this.events.emit('persona:change', { personaId: persona.id });
    return persona;
  }

  async remove(id: string): Promise<void> {
    const data = this.store.get();
    data.custom = data.custom.filter((p) => p.id !== id);
    delete data.overrides[id];
    await this.store.set(data);
  }

  async resetBuiltin(id: string): Promise<Persona> {
    const data = this.store.get();
    delete data.overrides[id];
    await this.store.set(data);
    const persona = this.get(id);
    if (!persona) throw new Error('人设不存在');
    return persona;
  }

  activeSettings(): PersonaSettings { return { activeId: this.getActiveId(), allowAutoSwitch: false, evolveEnabled: true, growthIntensity: 'normal', replyLength: 'natural' }; }
}
