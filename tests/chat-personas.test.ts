import { describe, expect, it } from 'vitest';
import { parseReply, splitReply, shouldRespond, resolveRole, simulateReply } from '../electron/services/chat-shared';
import { BUILTIN_PERSONAS } from '../shared/personas';
import { buildPersonaSystemPrompt, buildTtsInstruction, toTtsText } from '../shared/persona-prompts';

describe('回复协议解析', () => {
  it('解析 @@META@@ 并移除元数据', () => {
    const result = parseReply('我在呢～（尾巴拍拍）\n@@META@@{"mood":"开心","voice":true,"sticker":"可爱","actions":[{"type":"search","query":"今天新闻"}]}');
    expect(result.text).toBe('我在呢～（尾巴拍拍）');
    expect(result.meta.mood).toBe('开心');
    expect(result.meta.voice).toBe(true);
    expect(result.meta.actions?.[0].query).toBe('今天新闻');
  });

  it('兼容末尾单独 JSON 行与角色前缀', () => {
    const result = parseReply('鲸鲸：今天也要好好吃饭。\n{"mood":"温柔","voice":false}');
    expect(result.text).toBe('今天也要好好吃饭。');
    expect(result.meta.mood).toBe('温柔');
  });

  it('没有元数据时保持原文', () => {
    const result = parseReply('晚安，明天见。');
    expect(result.text).toBe('晚安，明天见。');
    expect(result.meta).toEqual({});
  });

  it('空内容不报错', () => {
    expect(parseReply('').text).toBe('');
  });
});

describe('回复拆分', () => {
  it('按段落拆分，最多三部分', () => {
    const parts = splitReply('第一段。\n\n第二段。\n\n第三段。\n\n第四段。', 3);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('第一段');
  });
  it('长文本按句号拆分', () => {
    const text = '这是一句很长的话，用来测试拆分逻辑。'.repeat(12);
    const parts = splitReply(text, 2);
    expect(parts.length).toBeLessThanOrEqual(2);
    expect(parts.join('').length).toBeGreaterThan(80);
  });
});

describe('权限引擎', () => {
  const baseSettings = {
    permissions: { owners: ['10001'], admins: ['10002'], whitelist: ['10003'], groupWhitelist: [], allowStrangers: true, requireAtInGroup: true, replyToOwnerAlways: true, blacklist: [], sensitiveWords: ['禁词'] },
    napcat: { groupWakeWords: ['鲸鲸'], privateWakeWords: [] },
  };
  it('角色判定优先级', () => {
    expect(resolveRole('10001', baseSettings.permissions)).toBe('owner');
    expect(resolveRole('10002', baseSettings.permissions)).toBe('admin');
    expect(resolveRole('10003', baseSettings.permissions)).toBe('whitelist');
    expect(resolveRole('99999', baseSettings.permissions)).toBe('guest');
  });
  it('群聊需要 @ 或唤醒词，主人不受限', () => {
    expect(shouldRespond({ scene: 'group', userId: '99999', text: '随便聊聊', mentioned: false, settings: baseSettings }).ok).toBe(false);
    expect(shouldRespond({ scene: 'group', userId: '99999', text: '鲸鲸在吗', mentioned: false, settings: baseSettings }).ok).toBe(false);
    expect(shouldRespond({ scene: 'group', userId: '99999', text: '鲸鲸在吗', mentioned: true, settings: baseSettings }).ok).toBe(true);
    expect(shouldRespond({ scene: 'group', userId: '10001', text: '随便聊聊', mentioned: false, settings: baseSettings }).ok).toBe(true);
  });
  it('黑名单与敏感词阻断', () => {
    const blocked = { ...baseSettings, permissions: { ...baseSettings.permissions, blacklist: ['99999'] } };
    expect(shouldRespond({ scene: 'private', userId: '99999', text: '你好', mentioned: false, settings: blocked }).ok).toBe(false);
    expect(shouldRespond({ scene: 'private', userId: '99999', text: '禁词', mentioned: false, settings: baseSettings }).ok).toBe(false);
  });
});

describe('12 个人设与提示词', () => {
  it('内置人设完整且彼此不同', () => {
    expect(BUILTIN_PERSONAS).toHaveLength(12);
    const names = new Set(BUILTIN_PERSONAS.map((p) => p.name));
    expect(names.size).toBe(12);
    for (const persona of BUILTIN_PERSONAS) {
      expect(persona.corePrompt.length).toBeGreaterThan(80);
      expect(persona.catchphrases.length).toBeGreaterThanOrEqual(5);
      expect(persona.quirks.length).toBeGreaterThanOrEqual(5);
      expect(persona.examples.length).toBeGreaterThanOrEqual(2);
      expect(persona.tts.tags.length).toBeGreaterThanOrEqual(1);
      expect(persona.isBuiltin).toBe(true);
    }
  });
  it('System Prompt 注入人设与场景，且不包含其他用户记忆', () => {
    const persona = BUILTIN_PERSONAS[0];
    const prompt = buildPersonaSystemPrompt({
      persona, scene: 'private', userName: '阿澈', userRole: 'owner',
      emotion: { mood: '开心', moodEmoji: '😊', valence: 0.6, arousal: 0.5, energy: 0.8, affection: 0.7, patience: 0.8, jealousy: 0.1, pride: 0.4, updatedAt: new Date().toISOString(), reason: '被夸了' },
      growth: { level: 8, xp: 3600, nextXp: 6000, stage: 'close', stageName: '默契', stageProgress: 60, traits: { 温柔: 80 }, habits: ['整理记忆'], selfImage: '一条小鲸鱼', evolutionNotes: [], reflections: [], totalMessages: 100, totalDays: 30, streakDays: 8, lastGrownAt: '', personalityDrift: [] },
      memoryFacts: ['阿澈喜欢下雨天', '阿澈喝咖啡会胃疼'], now: new Date('2026-10-29T03:00:00+01:00'),
    });
    expect(prompt).toContain('阿澈');
    expect(prompt).toContain('阿澈喜欢下雨天');
    expect(prompt).toContain('默契');
    expect(prompt).toContain('开心');
    expect(prompt).not.toContain('另一个联系人的私密暗号');
  });
  it('TTS 指令包含中文标签且清洗动作描写', () => {
    const persona = BUILTIN_PERSONAS[0];
    const tts = buildTtsInstruction(persona);
    expect(tts.text).toContain('音色');
    expect(toTtsText('（尾巴拍拍）你好呀 🐳[轻笑]')).not.toContain('尾巴拍拍');
    expect(simulateReply(persona, '今天好累').length).toBeGreaterThan(5);
  });
});
