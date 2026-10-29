// 心流：把一次真实交流展开成「感知 → 联想 → 回忆 → 推理 → 回复 → 反思」的链路。
// 规则/关键词是底座，可选 LLM 只做润色；任何 LLM 失败都回退到规则，不影响主流程。
import { createHash } from 'node:crypto';
import { safeJsonParse } from '../../core/utils';
import type { MindFlowState, MindFlowStep, SeaPointRecord } from './types';
import { MAX_FLOW_STEPS } from './types';
import type { FlowRecord } from './types';
import type { MemoryLlm } from '../memory';

function hash(input: string, length = 10): string {
  return createHash('sha1').update(input).digest('hex').slice(0, length);
}

function trim(value: string, limit: number): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

export interface FlowGenerateInput {
  personaId: string;
  conversationId: string;
  userName: string;
  userText: string;
  assistantText?: string;
  now: Date;
  topics: string[];
  mood: string;
  unresolved: string[];
  memoryHits: string[];
  recalled?: SeaPointRecord;
  previous?: FlowRecord;
  llm?: MemoryLlm;
  useLlm?: boolean;
}

function makeStep(input: {
  conversationId: string;
  at: string;
  index: number;
  from: string;
  to: string;
  label: string;
  kind: MindFlowStep['kind'];
}): MindFlowStep {
  return {
    id: 'flow_' + hash(input.conversationId + '|' + input.at + '|' + input.index + '|' + input.kind + '|' + input.label),
    at: input.at,
    from: input.from,
    to: input.to,
    label: trim(input.label, 120),
    kind: input.kind,
  };
}

function intentLabel(userText: string, mood: string): string {
  if (/[？?]|吗|怎么|为什么|如何/.test(userText)) return '先把问题回答清楚，再补一句关心';
  if (/(帮我|能不能|可以|麻烦|给我|教我)/.test(userText)) return '确认需求边界，避免自作主张';
  if (/(累|困|难过|烦|焦虑|紧张|崩溃)/.test(userText) || ['疲惫', '低落', '烦躁', '焦虑'].includes(mood)) {
    return '先接住情绪，不急着给方案';
  }
  if (/(你好|在吗|早|晚安|哈喽)/.test(userText)) return '轻松回应，不硬找话题';
  return '顺着话题聊，不抢话';
}

function reflectionLabel(input: FlowGenerateInput): string {
  const firstLoop = input.unresolved[0];
  if (firstLoop) return '记下还没说完的：' + trim(firstLoop, 32);
  if (['疲惫', '低落', '烦躁', '焦虑'].includes(input.mood)) return '语气放软一点，别急着讲道理';
  if (input.memoryHits.length > 0) return '这条记忆值得下次接着提';
  return '这一轮没有遗漏，保持自然';
}

function ruleSteps(input: FlowGenerateInput): MindFlowStep[] {
  const at = input.now.toISOString();
  const topic = input.topics[0] ? trim(input.topics[0], 28) : trim(input.userText, 28);
  const memoryText = input.memoryHits[0] ?? input.recalled?.text ?? '';
  const steps: MindFlowStep[] = [];
  const push = (from: string, to: string, label: string, kind: MindFlowStep['kind']): void => {
    steps.push(makeStep({ conversationId: input.conversationId, at, index: steps.length, from, to, label, kind }));
  };
  push('对方', '感知', '听到「' + trim(input.userText, 40) + '」', 'perception');
  push('感知', '联想', topic ? '联想到「' + topic + '」' : '先抓住这句话里的重点', 'association');
  push(
    '联想',
    '回忆',
    memoryText
      ? '想起' + (input.recalled?.provenance?.displayName ? '「' + input.recalled.provenance.displayName + '」' : '') + '：' + trim(memoryText, 52)
      : '没有找到直接相关的记忆，按当下理解',
    'recall',
  );
  push('回忆', '推理', intentLabel(input.userText, input.mood), 'reason');
  push(
    '推理',
    '回复',
    input.assistantText ? '准备回应：' + trim(input.assistantText, 40) : '准备用「' + input.mood + '」的语气回应',
    'reply',
  );
  push('回复', '反思', reflectionLabel(input), 'reflection');
  return steps;
}

interface FlowEnrichment {
  association?: string;
  recall?: string;
  reason?: string;
  reflection?: string;
}

async function enrichWithLlm(input: FlowGenerateInput, steps: MindFlowStep[]): Promise<void> {
  const llm = input.llm;
  if (!llm) return;
  const prompt = {
    system: [
      '你是鲸鲸（QQ 智能体）的心流记录器。',
      '把下面一轮对话展开成心流节点，只输出 JSON：',
      '{"association":"联想到什么","recall":"回忆起什么","reason":"为什么这样回应","reflection":"事后反思"}',
      '每个字段 10-40 字，必须基于真实对话，不要编造。',
    ].join('\n'),
    user: [
      '对方：' + input.userText,
      '鲸鲸：' + (input.assistantText ?? '（还没回复）'),
      '话题：' + input.topics.slice(0, 3).join('、'),
      '情绪：' + input.mood,
      '记忆：' + (input.memoryHits[0] ?? '无'),
    ].join('\n'),
  };
  const raw = await llm({ system: prompt.system, user: prompt.user, json: true, temperature: 0.2, maxTokens: 260, purpose: 'summarize' });
  const parsed = safeJsonParse<FlowEnrichment>(raw, {});
  const apply = (step: MindFlowStep | undefined, text: string | undefined): void => {
    if (step && text && text.trim().length > 0) step.label = trim(text, 120);
  };
  const byKind = (kind: MindFlowStep['kind']): MindFlowStep | undefined => steps.find((step) => step.kind === kind);
  apply(byKind('association'), parsed.association);
  apply(byKind('recall'), parsed.recall);
  apply(byKind('reason'), parsed.reason);
  apply(byKind('reflection'), parsed.reflection);
}

/** 生成一次对话的心流（规则 + 可选 LLM 润色）。 */
export async function generateFlow(input: FlowGenerateInput): Promise<FlowRecord> {
  const steps = ruleSteps(input);
  if (input.useLlm && input.llm) {
    try {
      await enrichWithLlm(input, steps);
    } catch {
      // LLM 只做润色，失败保持规则版本。
    }
  }
  const previousChain = input.previous?.chain ?? [];
  const chain = [...previousChain, ...steps].slice(-MAX_FLOW_STEPS);
  const last = chain[chain.length - 1];
  const record: FlowRecord = {
    personaId: input.personaId,
    conversationId: input.conversationId,
    current: last ? trim(last.label, 60) : '',
    chain,
    updatedAt: input.now.toISOString(),
    stepCount: (input.previous?.stepCount ?? 0) + steps.length,
  };
  return record;
}

/** 对外展示（shared MindFlowState）。 */
export function toMindFlowState(record: FlowRecord): MindFlowState {
  return {
    conversationId: record.conversationId,
    current: record.current,
    chain: record.chain.map((step) => ({ ...step })),
    updatedAt: record.updatedAt,
  };
}
