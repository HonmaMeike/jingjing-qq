import type { ChatAttachment, ChatMessage, Conversation } from '../../shared/types';
import type { ConversationStore } from './conversations';

function ago(minutes: number): string { return new Date(Date.now() - minutes * 60_000).toISOString(); }
function meme(file: string): ChatAttachment { return { kind: 'sticker', url: `pet://asset/memes/${encodeURIComponent(file)}`, name: file.replace(/\.png$/, '') }; }
function image(file: string): ChatAttachment { return { kind: 'image', url: `pet://asset/memes/${encodeURIComponent(file)}`, name: file.replace(/\.png$/, '') }; }

function m(role: 'user' | 'assistant', text: string, createdAt: string, extra?: Partial<ChatMessage>): Omit<ChatMessage, 'id' | 'conversationId'> {
  return { role, text, createdAt, scene: 'private', ...extra } as Omit<ChatMessage, 'id' | 'conversationId'>;
}

export async function seedDemoConversations(store: ConversationStore, personaId = 'jingjing'): Promise<boolean> {
  if (store.list().length > 0) return false;
  const conversations: Conversation[] = [];
  const messages: Record<string, ChatMessage[]> = {};
  const push = (conv: Conversation, list: Omit<ChatMessage, 'id' | 'conversationId'>[]) => {
    conversations.push(conv);
    let msgId = 0;
    messages[conv.id] = list.map((item) => ({ ...item, id: `demo-${conv.id}-${++msgId}`, conversationId: conv.id }));
    const last = messages[conv.id][messages[conv.id].length - 1];
    conv.messageCount = messages[conv.id].length;
    conv.lastMessage = last?.text || '[媒体]';
    conv.lastMessageAt = last?.createdAt || conv.lastMessageAt;
  };

  const owner: Conversation = {
    id: 'private_10001', scene: 'private', peerId: '10001', peerName: '阿澈', peerAvatar: '',
    lastMessage: '', lastMessageAt: ago(6), unread: 2, messageCount: 0, personaId, isDemo: true, pinned: true,
  };
  push(owner, [
    m('user', '鲸鲸，今天加班到十点，人都要散了……', ago(1500), { senderId: '10001', senderName: '阿澈', scene: 'private' }),
    m('assistant', '诶？十点才下班……（尾巴啪地拍了下地板）先别急着讲工作，吃饭了没呀？', ago(1498), { senderName: '鲸鲸', scene: 'private', meta: { personaId, mood: '心疼', source: 'local' } }),
    m('user', '路上买了个饭团，凉了。', ago(1490), { senderId: '10001', senderName: '阿澈' }),
    m('assistant', '凉的饭团不算饭。鲸鲸给你记一笔：明天要好好吃一顿热的，最好有白饭。\n\n今天先不骂你，累了就早点洗澡睡觉。工作可以明天再烂，人不行。', ago(1488), { senderName: '鲸鲸', meta: { personaId, mood: '认真', source: 'local' } }),
    m('user', '你今天干嘛了？', ago(1250), { senderId: '10001', senderName: '阿澈' }),
    m('assistant', '整理记忆小册子呀。把你说过「想学做饭」和「讨厌香菜」都记下来了，免得哪天给你点外卖踩雷。\n\n还偷偷看了会儿 B 站，有个UP主用代码画鲸鱼，尾巴画得没我好看。', ago(1248), { senderName: '鲸鲸', meta: { personaId, mood: '得意', source: 'local' }, attachments: [meme('得意.png')] }),
    m('user', '你还会记仇？', ago(880), { senderId: '10001', senderName: '阿澈' }),
    m('assistant', '鲸鲸不记仇，鲸鲸只是把账记在小本本上。（尾巴尖心虚地晃了晃）', ago(878), { senderName: '鲸鲸', meta: { personaId, mood: '傲娇', source: 'local' }, attachments: [meme('哦鲸鲸.png')] }),
    m('user', '明天周末，带你去公园？', ago(310), { senderId: '10001', senderName: '阿澈' }),
    m('assistant', '真的吗真的吗！那鲸鲸要戴小帽子，还要吃冰淇淋。\n\n不过你要先答应我，明天不准再睡到下午。', ago(308), { senderName: '鲸鲸', meta: { personaId, mood: '开心', source: 'local' }, attachments: [meme('可爱.png')] }),
    m('user', '……尽量。', ago(220), { senderId: '10001', senderName: '阿澈' }),
    m('assistant', '「尽量」就是失败预定，哼。\n\n那鲸鲸明天十点来叫你，赖床就用尾巴拍你。', ago(218), { senderName: '鲸鲸', meta: { personaId, mood: '傲娇', source: 'local' } }),
    m('user', '鲸鲸，晚安。', ago(10), { senderId: '10001', senderName: '阿澈' }),
    m('assistant', '晚安，阿澈。今天也有好好撑过来，鲸鲸看见了。\n\n（在消息框旁边团成一小团，尾巴搭在你枕头上）', ago(8), { senderName: '鲸鲸', meta: { personaId, mood: '温柔', source: 'local' }, attachments: [meme('吃饱饱摸肚子.png')] }),
    m('user', '明天见。', ago(6), { senderId: '10001', senderName: '阿澈' }),
  ]);

  const xiaoman: Conversation = {
    id: 'private_10002', scene: 'private', peerId: '10002', peerName: '小满', peerAvatar: '',
    lastMessage: '', lastMessageAt: ago(68), unread: 2, messageCount: 0, personaId, isDemo: true,
  };
  push(xiaoman, [
    m('user', '鲸鲸，我明天要面试了好紧张', ago(520), { senderId: '10002', senderName: '小满' }),
    m('assistant', '紧张说明你重视它呀。来，跟鲸鲸深呼吸——吸气，吐泡泡，呼气。\n\n你已经准备很久了，明天只要把会的说出来就好。', ago(518), { senderName: '鲸鲸', meta: { personaId, mood: '认真', source: 'local' } }),
    m('user', '可是我总觉得自己不够好', ago(80), { senderId: '10002', senderName: '小满' }),
    m('assistant', '那鲸鲸把你说过的话还给你：上次你帮同学改简历到十二点，你说「她值得」。\n\n你也值得被自己这样对待。明天面试完记得来报平安，鲸鲸等你。', ago(78), { senderName: '鲸鲸', meta: { personaId, mood: '温柔', source: 'local' } }),
    m('user', '好，我去了！', ago(70), { senderId: '10002', senderName: '小满' }),
    m('assistant', '去吧去吧！鲸鲸在海底给你举小旗子。', ago(68), { senderName: '鲸鲸', meta: { personaId, mood: '元气', source: 'local' }, attachments: [meme('厉害了我的鲸.png')] }),
  ]);

  const group: Conversation = {
    id: 'group_20001', scene: 'group', peerId: '20001', peerName: '深海摸鱼群', groupId: '20001', groupName: '深海摸鱼群',
    lastMessage: '', lastMessageAt: ago(24), unread: 5, messageCount: 0, personaId, isDemo: true,
  };
  push(group, [
    m('user', '今天老板又临时加需求，我真的会谢', ago(190), { senderId: '10004', senderName: '摸鱼队长', scene: 'group' }),
    m('user', '加一，需求文档写得像谜语', ago(188), { senderId: '10002', senderName: '小满', scene: 'group' }),
    m('assistant', '@摸鱼队长 先让他把「到底要什么」写成三句话，写不出来就不接。\n\n需求像谜语，多半是需求的人自己也没想清楚。（尾巴严肃地拍了下地）', ago(185), { senderName: '鲸鲸', scene: 'group', meta: { personaId, mood: '认真', source: 'local' } }),
    m('user', '鲸鲸说得对，我明天就怼回去', ago(160), { senderId: '10004', senderName: '摸鱼队长', scene: 'group' }),
    m('user', '有没有人看今天那个新模型发布会？', ago(60), { senderId: '10005', senderName: '阿梨', scene: 'group' }),
    m('assistant', '看了！那个多模态演示有点东西，尤其是长视频理解。\n\n不过鲸鲸更关心它会不会抢我写代码的活。（警觉）', ago(58), { senderName: '鲸鲸', scene: 'group', meta: { personaId, mood: '好奇', source: 'local' } }),
    m('user', '鲸鲸你天天在群里摸鱼，主人知道吗', ago(30), { senderId: '10003', senderName: '老陈', scene: 'group' }),
    m('assistant', '鲸鲸是在进行「社会化学习」，不是摸鱼。\n\n而且主人知道呀，他还让我多交朋友。', ago(28), { senderName: '鲸鲸', scene: 'group', meta: { personaId, mood: '理直气壮', source: 'local' }, attachments: [meme('先养着吧.png')] }),
    m('user', '行吧，社会化学习的小鲸鱼', ago(24), { senderId: '10003', senderName: '老陈', scene: 'group' }),
  ]);

  const lin: Conversation = {
    id: 'private_10003', scene: 'private', peerId: '10003', peerName: '老陈', peerAvatar: '',
    lastMessage: '', lastMessageAt: ago(1440), unread: 0, messageCount: 0, personaId, isDemo: true,
  };
  push(lin, [
    m('user', '你那个记忆压缩是怎么做的？会不会把上下文丢了', ago(1460), { senderId: '10003', senderName: '老陈' }),
    m('assistant', '会先把事实、偏好、承诺和原话锚点抽成结构化摘要，再保留最近窗口，不是一刀切。\n\n重要细节单独进记忆文档，聊天记录也全部归档，需要时可以翻出来。', ago(1455), { senderName: '鲸鲸', meta: { personaId, mood: '专业', source: 'local' } }),
    m('user', '有点意思，回头细说', ago(1442), { senderId: '10003', senderName: '老陈' }),
    m('assistant', '好呀，记得带白饭来换情报。', ago(1440), { senderName: '鲸鲸', meta: { personaId, mood: '俏皮', source: 'local' }, attachments: [meme('就一碗.png')] }),
  ]);

  await store.bulkImport(conversations, messages);
  return true;
}

export function demoAttachments(): ChatAttachment[] {
  return [image('可爱.png'), meme('吃饱饱摸肚子.png')];
}
