import type { GrowthState, GrowthStage } from '../../shared/types';
import { JsonStore } from '../core/json-store';
import { nowIso } from '../core/utils';
import { GROWTH_STAGES } from '../config/defaults';
import type { EventBus } from '../core/event-bus';

interface GrowthData { byPersona: Record<string, GrowthState & { foundedAt: string }> }

function stageFor(xp: number): { stage: GrowthStage; progress: number } {
  let stage = GROWTH_STAGES[0];
  for (const item of GROWTH_STAGES) if (xp >= item.minXp) stage = item;
  const idx = GROWTH_STAGES.findIndex((s) => s.key === stage.key);
  const next = GROWTH_STAGES[idx + 1];
  const progress = next ? (xp - stage.minXp) / (next.minXp - stage.minXp) : 1;
  return { stage, progress: Math.max(0, Math.min(1, progress)) };
}

export class GrowthService {
  private constructor(private store: JsonStore<GrowthData>, private events: EventBus) {}

  static async create(file: string, events: EventBus): Promise<GrowthService> {
    const store = await JsonStore.open<GrowthData>(file, { byPersona: {} });
    return new GrowthService(store, events);
  }

  get(personaId: string): GrowthState {
    const data = this.store.get();
    const found = data.byPersona[personaId];
    if (found) return this.decorate(found);
    return this.fresh();
  }

  private fresh(): GrowthState {
    return this.decorate({ level: 1, xp: 0, nextXp: 800, stage: 'stranger', stageName: '初见', stageProgress: 0, traits: { 温柔: 62, 好奇: 80, 粘人: 58, 毒舌: 12, 可靠: 55 }, habits: ['每天整理一次记忆小册子'], selfImage: '一条还在学习如何陪伴人类的小鲸鱼。', evolutionNotes: [], reflections: [], totalMessages: 0, totalDays: 1, streakDays: 1, lastGrownAt: nowIso(), personalityDrift: [], foundedAt: nowIso() });
  }

  private decorate(state: GrowthState & { foundedAt?: string }): GrowthState {
    const { stage, progress } = stageFor(state.xp);
    const next = GROWTH_STAGES.find((s) => s.minXp > state.xp)?.minXp ?? state.xp + 10000;
    return {
      ...state,
      stage: stage.key,
      stageName: stage.name,
      stageProgress: Math.round(progress * 100),
      nextXp: next,
      level: Math.max(1, Math.floor(state.xp / 500) + 1),
      personalityDrift: Object.entries(state.traits).slice(0, 6).map(([key, value]) => ({ key, label: key, value })),
    };
  }

  async seedDemoStats(personaId: string, stats: { totalMessages: number; totalDays: number; streakDays: number; selfImage: string }): Promise<GrowthState> {
    return this.mutate(personaId, (state) => {
      state.totalMessages = stats.totalMessages;
      state.totalDays = stats.totalDays;
      state.streakDays = stats.streakDays;
      state.selfImage = stats.selfImage;
    });
  }

  async addXp(personaId: string, amount: number, reason = '互动'): Promise<GrowthState> {
    const data = this.store.get();
    const current = data.byPersona[personaId] ?? ({ ...this.get(personaId), foundedAt: nowIso() } as GrowthState & { foundedAt: string });
    current.xp += Math.max(0, Math.round(amount));
    current.totalMessages += reason.includes('消息') ? 1 : 0;
    current.lastGrownAt = nowIso();
    current.totalDays = Math.max(1, Math.ceil((Date.now() - new Date(current.foundedAt).getTime()) / 86_400_000));
    current.streakDays = Math.max(1, current.streakDays);
    data.byPersona[personaId] = current;
    await this.store.set(data);
    const decorated = this.get(personaId);
    this.events.emit('growth:change', { personaId, growth: decorated });
    return decorated;
  }

  async addHabit(personaId: string, habit: string): Promise<GrowthState> {
    return this.mutate(personaId, (state) => {
      if (!state.habits.includes(habit)) state.habits.push(habit);
    });
  }

  async addEvolutionNote(personaId: string, note: string): Promise<GrowthState> {
    return this.mutate(personaId, (state) => {
      state.evolutionNotes = [...state.evolutionNotes.slice(-40), note];
    });
  }

  async addReflection(personaId: string, reflection: string): Promise<GrowthState> {
    return this.mutate(personaId, (state) => {
      state.reflections = [...state.reflections.slice(-30), reflection];
    });
  }

  async setSelfImage(personaId: string, image: string): Promise<GrowthState> {
    return this.mutate(personaId, (state) => { state.selfImage = image; });
  }

  async adjustTrait(personaId: string, trait: string, delta: number): Promise<GrowthState> {
    return this.mutate(personaId, (state) => {
      state.traits[trait] = Math.max(0, Math.min(100, (state.traits[trait] ?? 50) + delta));
    });
  }

  private async mutate(personaId: string, fn: (state: GrowthState & { foundedAt: string }) => void): Promise<GrowthState> {
    const data = this.store.get();
    const current = data.byPersona[personaId] ?? ({ ...this.get(personaId), foundedAt: nowIso() } as GrowthState & { foundedAt: string });
    fn(current);
    current.lastGrownAt = nowIso();
    data.byPersona[personaId] = current;
    await this.store.set(data);
    const decorated = this.get(personaId);
    this.events.emit('growth:change', { personaId, growth: decorated });
    return decorated;
  }
}
