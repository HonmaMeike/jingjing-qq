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
    const state = data.byPersona[personaId] ?? this.fresh();
    return { ...state, dailyEvent: state.dailyEvent || this.dailyEvent(personaId) };
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


  /** 每天固定生成一件小事；同一天、同一人设结果稳定。 */
  dailyEvent(personaId: string): string {
    const date = new Date().toISOString().slice(0, 10);
    const events = [
      '今天窗外的云压得很低，像要下雨，空气里有潮湿的咸味。',
      '今天整理旧物时翻到一张很久以前的便签，愣了一会儿。',
      '今天泡的茶有点苦，喝到一半才想起来忘了放糖。',
      '今天楼下有一只猫蹲在台阶上，看了我很久。',
      '今天路过一家小店，闻到刚出炉的面包味，站了一会儿。',
      '今天把桌面收拾干净了，心情莫名轻了一点。',
      '今天听到一首旧歌，想起一个很久没联系的人。',
      '今天有点困，趴在窗边看光一点点挪过去。',
    ];
    let hash = 0;
    for (const ch of personaId + '|' + date) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return events[hash % events.length];
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
    next.dailyEvent = this.dailyEvent(personaId);
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
