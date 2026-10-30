import { parseChatCommand, type ChatCommand } from './chat-commands';

export type RoutedIntent =
  | { kind: 'command'; command: ChatCommand }
  | { kind: 'balance' }
  | { kind: 'none' };

function clean(text: string): string {
  return text.trim().replace(/^[@＠]\S+\s*/, '').replace(/^(?:鲸鲸|小鲸鱼|鲸宝)[，,。.!！\s]*/, '').trim();
}

/** 快速、无额外费用的自然语言意图路由；模型动作仍负责更开放的说法。 */
export function routeIntent(raw: string): RoutedIntent {
  const text = clean(raw);
  if (!text) return { kind: 'none' };
  const command = parseChatCommand(text);
  if (command) return { kind: 'command', command };
  if (/(余额|钱包|零花|多少钱|剩多少|还剩|够不够花|多少额度)/.test(text)) return { kind: 'balance' };
  const image = text.match(/^(?:(?:给我|帮我|替我|来|整)\s*)?(?:画|整|搞)(?:一张|一个|张|个)?[\s:：]*(.{2,})$/);
  if (image) return { kind: 'command', command: { kind: 'image', prompt: image[1].trim() } };
  const video = text.match(/^(?:(?:给我|帮我|替我|来)\s*)?(?:拍|录|生成)(?:一段|一个|段|个)?(.*?)视频(?:[\s:：]*(.*))?$/);
  if (video) { const prompt = [video[1], video[2]].filter(Boolean).join(' ').trim(); if (prompt) return { kind: 'command', command: { kind: 'video', prompt } }; }
  const music = text.match(/^(?:放|来|整)(?:一首|一段|首|段)?(.*?)歌(?:[\s:：]*(.*))?$/);
  if (music) { const query = [music[1], music[2]].filter(Boolean).join(' ').trim(); return { kind: 'command', command: { kind: 'music', query, title: query || undefined } }; }
  return { kind: 'none' };
}
