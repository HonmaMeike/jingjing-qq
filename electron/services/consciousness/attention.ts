// 心光：每个会话的注意力状态（focus / topics / unresolved / mood / intensity）。
// 由最近用户消息 + 回忆到的记忆片段 + 未完成话题共同更新，每次对话后 observeExchange 调用。
import type { AttentionState } from './types';
import {
  MAX_ATTENTION_HISTORY,
  MAX_ATTENTION_TOPICS,
  MAX_UNRESOLVED,
} from './types';
import type { AttentionRecord } from './types';

const CLAUSE_SPLIT = /[。！？!?；;\n，,、]/;
const RESOLVED_PATTERN = /(搞定|解决了|解决啦|完成|不用了|没事了|已经|好了|结束了|改好了|不用做|取消了)/;
const UNRESOLVED_PATTERN = /(明天|明早|今晚|下次|回头|等会|待会|稍后|晚点|之后|还没|帮我|记得|答应|再说|回来|计划|安排|要不要|怎么办)/;

const MOOD_RULES: { mood: string; pattern: RegExp }[] = [
  { mood: '开心', pattern: /(开心|高兴|哈哈|笑死|太好了|好耶|喜欢|爱你|爽|值得)/ },
  { mood: '疲惫', pattern: /(累|困|熬夜|加班|没睡|好忙|撑不住)/ },
  { mood: '低落', pattern: /(难过|伤心|想哭|失落|委屈|崩溃|emo|不开心)/ },
  { mood: '烦躁', pattern: /(烦|生气|气死|讨厌|无语|受不了|别烦|恶心)/ },
  { mood: '焦虑', pattern: /(焦虑|紧张|害怕|担心|面试|考试|deadline|来不及|压力)/ },
  { mood: '期待', pattern: /(期待|好想|迫不及待|准备|盼着)/ },
];

function clamp(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function trim(value: string, limit: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

export function splitClauses(text: string): string[] {
  return String(text ?? '')
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}

function cleanClause(clause: string): string {
  return clause
    .replace(/^@\S+\s*/, '')
    .replace(/^(鲸鲸|小鲸鱼)[,，:：\s]*/, '')
    .replace(/[吗呢啊吧呀哦啦哈嘛]+$/u, '')
    .trim();
}

/** 抽取话题：短句优先，保证至少有一个可展示的话题。 */
export function extractTopics(text: string, limit = MAX_ATTENTION_TOPICS): string[] {
  const topics: string[] = [];
  for (const raw of splitClauses(text)) {
    const clause = cleanClause(raw);
    if (clause.length >= 2 && clause.length <= 24) topics.push(clause);
  }
  const unique = [...new Set(topics)];
  if (unique.length === 0) {
    const fallback = cleanClause(trim(text, 24));
    if (fallback) unique.push(fallback);
  }
  return unique.slice(0, limit);
}

/** 当前心光聚焦：第一句短句（去掉 @ 与昵称前缀）。 */
export function extractFocus(userText: string, userName?: string): string {
  const first = splitClauses(userText)[0] ?? userText;
  let focus = first.replace(/^@\S+\s*/, '').trim();
  if (userName) {
    const escaped = userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    focus = focus.replace(new RegExp('^' + escaped + '[,，:：\\s]*'), '');
  }
  return trim(focus, 46);
}

export function detectMood(text: string, fallback = '平静'): string {
  for (const rule of MOOD_RULES) {
    if (rule.pattern.test(text)) return rule.mood;
  }
  return fallback;
}

function sharesKeyword(left: string, right: string): boolean {
  const leftText = left.toLowerCase();
  const rightText = right.toLowerCase();
  for (let index = 0; index + 1 < rightText.length; index += 1) {
    const bigram = rightText.slice(index, index + 2);
    if (leftText.includes(bigram)) return true;
  }
  return false;
}

/** 识别未完成话题：带着「明天/帮我/回头」等钩子的短句；遇到「搞定了」则移除旧项。 */
export function detectUnresolved(text: string, previous: readonly string[] = []): string[] {
  const result = [...previous];
  for (const raw of splitClauses(text)) {
    const clause = cleanClause(raw);
    if (!clause) continue;
    if (RESOLVED_PATTERN.test(clause)) {
      for (let index = result.length - 1; index >= 0; index -= 1) {
        const item = result[index];
        if (!item) continue;
        if (sharesKeyword(item, clause) || clause.includes(item.slice(0, 4))) result.splice(index, 1);
      }
      continue;
    }
    if (UNRESOLVED_PATTERN.test(clause)) {
      const item = trim(clause, 40);
      if (item && !result.includes(item)) result.push(item);
    }
  }
  return result.slice(-MAX_UNRESOLVED);
}

export interface AttentionUpdateInput {
  personaId: string;
  conversationId: string;
  userName?: string;
  userText: string;
  now: Date;
  memoryHits?: number;
  topics?: string[];
  previous?: AttentionRecord;
}

/** 更新心光：话题合并、未完成事项增删、情绪与强度随时间/回忆变化。 */
export function updateAttention(input: AttentionUpdateInput): AttentionRecord {
  const { now, previous } = input;
  const topics = input.topics ?? extractTopics(input.userText);
  const mergedTopics = [...new Set([...topics, ...(previous?.topics ?? [])])].slice(0, MAX_ATTENTION_TOPICS);
  const unresolved = detectUnresolved(input.userText, previous?.unresolved ?? []);
  const focus = extractFocus(input.userText, input.userName) || previous?.focus || '和你说说话';
  const mood = detectMood(input.userText, previous?.mood ?? '平静');
  const memoryHits = Math.max(0, input.memoryHits ?? 0);
  const question = /[？?]|吗/.test(input.userText);
  let intensity =
    0.4 +
    Math.min(0.25, input.userText.length / 400) +
    Math.min(0.15, memoryHits * 0.04) +
    Math.min(0.1, unresolved.length * 0.03) +
    (question ? 0.05 : 0);
  if (previous) {
    const gapHours = (now.getTime() - Date.parse(previous.updatedAt)) / 3_600_000;
    if (Number.isFinite(gapHours) && gapHours > 6) intensity = Math.min(intensity, 0.55);
    intensity = intensity * 0.6 + previous.intensity * 0.4;
  }
  const history = previous?.history ? [...previous.history] : [];
  if (focus && focus !== previous?.focus) {
    history.push({ at: now.toISOString(), focus });
    if (history.length > MAX_ATTENTION_HISTORY) history.splice(0, history.length - MAX_ATTENTION_HISTORY);
  }
  const record: AttentionRecord = {
    personaId: input.personaId,
    conversationId: input.conversationId,
    focus,
    topics: mergedTopics,
    unresolved,
    mood,
    intensity: Math.round(clamp(intensity, 0.1, 1) * 100) / 100,
    updatedAt: now.toISOString(),
    recallCount: (previous?.recallCount ?? 0) + memoryHits,
    history,
    lastUserText: trim(input.userText, 500),
  };
  const name = input.userName ?? previous?.lastUserName;
  if (name) record.lastUserName = name;
  return record;
}

/** 对外展示（shared AttentionState）。 */
export function toAttentionState(record: AttentionRecord): AttentionState {
  return {
    conversationId: record.conversationId,
    focus: record.focus,
    topics: [...record.topics],
    unresolved: [...record.unresolved],
    mood: record.mood,
    intensity: record.intensity,
    updatedAt: record.updatedAt,
  };
}
