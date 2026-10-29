import type { EmotionState } from '../../shared/types';
import { JsonStore } from '../core/json-store';
import { clamp, nowIso } from '../core/utils';
import { DEFAULT_EMOTION } from '../config/defaults';
import type { EventBus } from '../core/event-bus';

interface EmotionData { byPersona: Record<string, EmotionState>; log: { at: string; mood: string; reason: string }[] }

const MOOD_EMOJI: Record<string, string> = {
  开心: '😊', 兴奋: '✨', 期待: '🐋', 温柔: '🫧', 平静: '🌊', 害羞: '😳', 傲娇: '😤', 得意: '😏',
  心疼: '🥺', 担心: '😟', 难过: '🌧️', 委屈: '🥹', 生气: '😠', 吃醋: '🍋', 困倦: '😴', 好奇: '👀', 认真: '🎯',
};

export class EmotionService {
  private constructor(private store: JsonStore<EmotionData>, private events: EventBus) {}

  static async create(file: string, events: EventBus): Promise<EmotionService> {
    const store = await JsonStore.open<EmotionData>(file, { byPersona: {}, log: [] });
    return new EmotionService(store, events);
  }

  get(personaId: string): EmotionState {
    const data = this.store.get();
    return data.byPersona[personaId] ?? this.fresh();
  }

  private fresh(): EmotionState {
    return { ...DEFAULT_EMOTION, moodEmoji: MOOD_EMOJI[DEFAULT_EMOTION.mood] ?? '🐋', updatedAt: nowIso(), reason: '刚从鲸落海醒来' };
  }

  private label(valence: number, arousal: number, affection: number, patience: number): { mood: string; emoji: string } {
    if (patience < 0.25 && valence < 0) return { mood: '生气', emoji: '😠' };
    if (valence > 0.55 && arousal > 0.6) return { mood: '兴奋', emoji: '✨' };
    if (valence > 0.45 && affection > 0.7) return { mood: '开心', emoji: '😊' };
    if (valence > 0.3) return { mood: '温柔', emoji: '🫧' };
    if (valence < -0.4) return { mood: '难过', emoji: '🌧️' };
    if (valence < -0.15) return { mood: '有点委屈', emoji: '🥹' };
    return { mood: '平静', emoji: '🌊' };
  }

  async apply(personaId: string, delta: Partial<EmotionState> & { mood?: string; reason?: string }, source = 'chat'): Promise<EmotionState> {
    const data = this.store.get();
    const current = data.byPersona[personaId] ?? this.fresh();
    const valence = clamp(current.valence + (delta.valence ?? 0), -1, 1);
    const arousal = clamp(current.arousal + (delta.arousal ?? 0), 0, 1);
    const energy = clamp(current.energy + (delta.energy ?? -0.015), 0.15, 1);
    const affection = clamp(current.affection + (delta.affection ?? 0.005), 0, 1);
    const patience = clamp(current.patience + (delta.patience ?? 0), 0.05, 1);
    const jealousy = clamp(current.jealousy + (delta.jealousy ?? -0.01), 0, 1);
    const pride = clamp(current.pride + (delta.pride ?? 0), 0, 1);
    const auto = this.label(valence, arousal, affection, patience);
    const mood = delta.mood?.trim() || auto.mood;
    const next: EmotionState = {
      mood, moodEmoji: MOOD_EMOJI[mood] ?? delta.moodEmoji ?? auto.emoji,
      valence, arousal, energy, affection, patience, jealousy, pride,
      updatedAt: nowIso(), reason: delta.reason || current.reason,
    };
    data.byPersona[personaId] = next;
    data.log = [...data.log.slice(-300), { at: next.updatedAt, mood, reason: `${source}: ${next.reason}` }];
    await this.store.set(data);
    this.events.emit('emotion:change', { personaId, emotion: next });
    return next;
  }

  async decay(personaId: string): Promise<EmotionState> {
    const current = this.get(personaId);
    const hours = Math.max(0, (Date.now() - new Date(current.updatedAt).getTime()) / 3_600_000);
    if (hours < 1) return current;
    const valence = current.valence * 0.96 + 0.05;
    const arousal = current.arousal * 0.94;
    const energy = clamp(current.energy + hours * 0.018, 0.15, 1);
    return this.apply(personaId, { valence: valence - current.valence, arousal: arousal - current.arousal, energy: energy - current.energy, jealousy: -hours * 0.01, reason: '时间慢慢抚平了情绪' }, 'decay');
  }
}
