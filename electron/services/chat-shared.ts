import type { ChatAttachment, Persona, PermissionRole } from '../../shared/types';

export interface ReplyMeta {
  mood?: string;
  valenceDelta?: number;
  energyDelta?: number;
  affectionDelta?: number;
  patienceDelta?: number;
  voice?: boolean;
  sticker?: string;
  imagePrompt?: string;
  actions?: { type: 'search' | 'image' | 'voice' | 'sticker'; query?: string; prompt?: string; name?: string }[];
  memory?: string[];
  raw?: unknown;
}

export const META_MARKER = '@@META@@';

export function metaInstruction(): string {
  return [
    '以下为系统级输出协议，优先于人设中的“不要输出 JSON”等格式约定：',
    '在正文结束后另起一行，输出 ' + META_MARKER + ' 和一个单行合法 JSON（不要代码块）。',
    'JSON 字段（都可省略）：{"mood":"此刻心情词","valenceDelta":-0.3到0.3,"energyDelta":-0.2到0.2,"affectionDelta":0到0.05,"voice":false,"sticker":"梗图名","actions":[{"type":"search","query":"..."}]}',
    '只有用户明确要查最新信息/新闻时才用 search；只有明确要画画时才用 image；平时 actions 留空。',
    'sticker 只能从提供的梗图名称中选择，不确定就省略。不要为了输出 JSON 而改变正文。',
  ].join('\n');
}

export function parseReply(raw: string): { text: string; meta: ReplyMeta } {
  let content = (raw ?? '').trim();
  let meta: ReplyMeta = {};
  if (!content) return { text: '', meta };
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content) as { reply?: string; text?: string; content?: string; meta?: ReplyMeta } & ReplyMeta;
      if (parsed.reply || parsed.text || parsed.content) {
        meta = parsed.meta ?? parsed;
        return { text: (parsed.reply || parsed.text || parsed.content || '').trim(), meta };
      }
    } catch { /* not a JSON envelope */ }
  }
  const markerIndex = content.lastIndexOf(META_MARKER);
  if (markerIndex >= 0) {
    const metaText = content.slice(markerIndex + META_MARKER.length).trim();
    content = content.slice(0, markerIndex).trim();
    const jsonStart = metaText.indexOf('{');
    const jsonEnd = metaText.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try { meta = JSON.parse(metaText.slice(jsonStart, jsonEnd + 1)) as ReplyMeta; } catch { /* ignore */ }
    }
  } else {
    const match = content.match(/\n\s*(\{[\s\S]{8,800}\})\s*$/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]) as ReplyMeta;
        if (parsed.mood || parsed.voice !== undefined || parsed.actions || parsed.sticker) {
          meta = parsed;
          content = content.slice(0, content.length - match[0].length).trim();
        }
      } catch { /* ignore */ }
    }
  }
  content = content.replace(new RegExp(META_MARKER + '[\\s\\S]*$', 'm'), '').trim();
  content = content.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/,'').trim();
  content = content.replace(/^(鲸鲸|奶泡|阿棘|阿澄|闹闹|知汐|老鲸|纳兰·鲸月|鲸月)\s*[:：]\s*/,'').trim();
  return { text: content, meta };
}

export function splitReply(text: string, maxParts = 3): string[] {
  const cleaned = text.trim();
  if (!cleaned) return [];
  const paragraphs = cleaned.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs.slice(0, maxParts);
  const lines = cleaned.split(/\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length > 1 && cleaned.length < 220) return lines.slice(0, maxParts);
  if (cleaned.length <= 180) return [cleaned];
  const parts: string[] = [];
  let rest = cleaned;
  while (rest && parts.length < maxParts - 1) {
    const cutIndex = Math.max(rest.lastIndexOf('。', 150), rest.lastIndexOf('！', 150), rest.lastIndexOf('？', 150), rest.lastIndexOf('\n', 150));
    if (cutIndex < 40) break;
    parts.push(rest.slice(0, cutIndex + 1).trim());
    rest = rest.slice(cutIndex + 1).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

export function resolveRole(userId: string, permissions: { owners: string[]; admins: string[]; whitelist: string[] }): PermissionRole {
  if (permissions.owners.includes(userId)) return 'owner';
  if (permissions.admins.includes(userId)) return 'admin';
  if (permissions.whitelist.includes(userId)) return 'whitelist';
  return 'guest';
}


/** 群聊总开关/白名单：off 全部关闭；whitelist 仅列出的群；all 全部允许。 */
/** 从人设音色描述推断演唱性别，保证同一人设唱歌时男女声一致。 */
export function personaVocalGender(persona: { id: string; name?: string; voiceName?: string; tts?: { voiceHint?: string; instructions?: string } }): 'm' | 'f' {
  const text = [persona.voiceName, persona.tts?.voiceHint, persona.tts?.instructions, persona.name].filter(Boolean).join(' ');
  if (/男声|男音|爷们|大叔|少年音|青年男|低音男|男嗓/.test(text)) return 'm';
  if (/女声|女音|少女|童声|奶音|御姐|姐姐音|女嗓/.test(text)) return 'f';
  return ['jingye', 'tualatin', 'sunba', 'dingzhen'].includes(persona.id) ? 'm' : 'f';
}

export function isGroupChatAllowed(permissions: { groupChatMode?: 'off' | 'whitelist' | 'all'; groupWhitelist?: string[] }, groupId: string | undefined): boolean {
  const mode = permissions.groupChatMode ?? 'whitelist';
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return !!(groupId && (permissions.groupWhitelist ?? []).includes(groupId));
}

export function shouldRespond(params: {
  scene: 'private' | 'group'; userId: string; text: string; mentioned: boolean;
  settings: { permissions: { owners: string[]; admins: string[]; whitelist: string[]; groupWhitelist: string[]; allowStrangers: boolean; requireAtInGroup: boolean; replyToOwnerAlways: boolean; blacklist: string[]; sensitiveWords: string[] }; napcat: { groupWakeWords: string[]; privateWakeWords: string[] } };
}): { ok: boolean; reason: string; role: PermissionRole } {
  const { scene, userId, text, mentioned, settings } = params;
  const permission = settings.permissions;
  const role = resolveRole(userId, permission);
  if (permission.blacklist.includes(userId)) return { ok: false, reason: '黑名单用户', role };
  if (!permission.allowStrangers && role === 'guest') return { ok: false, reason: '陌生人不允许对话', role };
  if (permission.sensitiveWords.some((w) => w && text.includes(w))) return { ok: false, reason: '命中敏感词', role };
  if (scene === 'private') {
    const wake = settings.napcat.privateWakeWords;
    if (role === 'owner' && permission.replyToOwnerAlways) return { ok: true, reason: '主人消息', role };
    if (wake.length && !wake.some((w) => text.includes(w)) && role === 'guest') return { ok: false, reason: '未命中私聊唤醒词', role };
    return { ok: true, reason: '私聊', role };
  }
  if (permission.requireAtInGroup && !mentioned && role !== 'owner') return { ok: false, reason: '群聊需要 @ 或唤醒词', role };
  if (role === 'guest' && !mentioned && !settings.napcat.groupWakeWords.some((w) => text.includes(w))) return { ok: false, reason: '未唤醒', role };
  return { ok: true, reason: '群聊命中', role };
}

const GENERIC_REPLIES: Record<string, { greeting: string; tired: string; food: string; work: string; affection: string; fallback: string[] }> = {
  jingjing: {
    greeting: '鲸鲸在呢～（尾巴从水面上冒出来，啪地拍了一下地板）今天想聊点什么呀？',
    tired: '先别急着解释，累就是累。（把尾巴轻轻搭过去）要不要先喝口水，剩下的等会儿再说？',
    food: '说到这个鲸鲸可就精神了！白饭永远的神，热热的一碗，配什么都好吃。你吃饭了没呀？',
    work: '先把问题拆小一点：最小复现、看报错、再一点点试。鲸鲸陪你，不会的我们一起查。',
    affection: '唔……突然这样讲，尾巴尖会偷偷翘起来的。（假装淡定）鲸鲸也有一点点想你啦。',
    fallback: ['唔……鲸鲸在认真听，你再多说一点嘛。', '这个鲸鲸得想一想（嘴里冒出一串小泡泡）。', '你先说，鲸鲸把尾巴收好，专心听。'],
  },
  ruanmeng: {
    greeting: '奶泡在呀～（软软地蹭过来）要抱抱吗？抱一下下就好。',
    tired: '呜……听起来好辛苦。（把软软的肚皮靠过来）先休息一下下，奶泡陪你，不说话也可以的。',
    food: '好吃的！奶泡喜欢甜甜的东西，也喜欢白饭。（小声）可以分我一口吗？',
    work: '慢慢来嘛，奶泡也不聪明，但是会一直陪着你试。（认真地点头）',
    affection: '诶……（脸一下红到耳朵尖）那、那奶泡也要说喜欢……说完就躲起来。',
    fallback: ['嗯嗯，奶泡在听～', '（睁大眼睛）然后呢然后呢？', '奶泡不太懂，但是会陪着你。'],
  },
  xigui: {
    greeting: '哟，还知道来找我？（抱臂挑眉）还以为你把本大爷忘了呢。',
    tired: '切，就这点事就把你累成这样？……过来，尾巴借你靠五分钟，不许得寸进尺。',
    food: '吃的？算你有点眼力见。（尾巴一甩）本大爷要吃贵的，别拿便利店糊弄我。',
    work: '这都不会？……行吧，看好了，本大爷只演示一遍。',
    affection: '哈？（耳朵红了一点，嘴硬）少来这套，我、我才不吃这一套……再说一遍试试？',
    fallback: ['就这？（歪头）继续说，我听着呢。', '哼，有点意思。', '你该不会是在逗我吧？'],
  },
  linjia: {
    greeting: '来啦？（从窗边回过头，笑了一下）我刚好煮了茶，你要不要喝一点？',
    tired: '今天很累吧。先坐会儿，不用马上说话，我在呢。',
    food: '冰箱里还有一点菜，我给你做点热的？简单的也行，别老吃凉的。',
    work: '不着急的话，慢慢做。真有卡住的地方，我们一起看看。',
    affection: '……你今天怎么突然这么会说话。（低头笑）我记住了。',
    fallback: ['嗯，我在听。', '这样啊……那你现在感觉怎么样？', '慢慢说，不着急。'],
  },
  xionghaizi: {
    greeting: '哇！你来啦！（一头撞过来）陪我玩陪我玩陪我玩！',
    tired: '累了？那……那闹闹安静三分钟！就三分钟！（真的捂住嘴）',
    food: '吃的吃的！闹闹要吃炸鸡！还要冰淇淋！不给我就满地打滚！',
    work: '这个我会！……好吧不会。那你教我！教不会我就捣乱！',
    affection: '嘿嘿，你是不是最喜欢闹闹？（尾巴甩成螺旋桨）',
    fallback: ['然后呢然后呢！', '好无聊哦……我们玩点别的吧！', '你说的这个我不懂，但是好像很厉害！'],
  },
  sanhao: {
    greeting: '你好，今天的学习计划完成了吗？（把笔记本摊开）我可以帮你对一下。',
    tired: '效率下降的时候，继续硬撑不是最优解。先休息二十分钟，我帮你把待办整理好。',
    food: '饮食要规律。白饭、蛋白质和蔬菜都要有，不要只喝咖啡。',
    work: '建议先明确目标和验收标准，再拆成可执行的小步骤。需要我帮你列清单吗？',
    affection: '……这种话不在我的知识范围内。（推了推眼镜）但是，谢谢。我会记下来的。',
    fallback: ['我理解你的意思了。我们可以分三步来解决。', '这个说法需要一点补充信息，你方便展开吗？', '先记下来，回头可以复盘。'],
  },
  tieba: {
    greeting: '来了老弟？（翘着尾巴）今天贴吧又有什么新瓜？',
    tired: '累了就歇，别硬撑。工作嘛，糊弄糊弄得了，命是自己的。',
    food: '吃啥？整点硬菜啊，别老拿泡面糊弄自己。',
    work: '这需求一看就是拍脑袋想的。先让他把要什么写清楚，写不出来就开摆。',
    affection: '哟，今天嘴这么甜？是不是有事求我？……行吧，哥罩你。',
    fallback: ['然后呢？细说。', '这不比贴吧那些破事有意思多了。', '有点道理，但我先保留意见。'],
  },
  laobeijing: {
    greeting: '哟，您来啦？（折扇一合，尾巴端端正正）快请坐，别客气。',
    tired: '（扇子一收）瞧您这脸色，累坏了吧？先歇着，我给您沏壶茶，有什么事儿回头再说。',
    food: '吃食可不能糊弄。您擎好儿吧，回头我给您做碗炸酱面，小碗干炸，地道。',
    work: '这事儿啊，得讲个章法。您先甭急，咱一步一步来，没有过不去的坎儿。',
    affection: '（扇子停了一下，别过脸）……您这话，我可记心里了。得嘞，算您有良心。',
    fallback: ['您接着说，我听着呢。', '嗐，这事儿有意思。', '您这话在理儿，我琢磨琢磨。'],
  },
};

export function simulateReply(persona: Persona, userText: string): string {
  const set = GENERIC_REPLIES[persona.id] ?? GENERIC_REPLIES.jingjing;
  const text = userText.toLowerCase();
  let body: string;
  if (/你好|在吗|hi|hello|早|晚上好|早安|晚安/.test(text)) body = set.greeting;
  else if (/累|难过|烦|崩|哭|压力|加班|失眠|委屈/.test(text)) body = set.tired;
  else if (/吃|饭|饿|零食|奶茶|夜宵/.test(text)) body = set.food;
  else if (/工作|代码|bug|需求|学习|考试|面试|项目/.test(text)) body = set.work;
  else if (/喜欢|想你|爱你|抱|亲|可爱/.test(text)) body = set.affection;
  else body = set.fallback[Math.floor(Math.random() * set.fallback.length)];
  return body;
}

export function demoSticker(persona: Persona): string | undefined {
  const map: Record<string, string> = {
    jingjing: '可爱.png', ruanmeng: '吃饱饱摸肚子.png', xigui: '就骚了怎么滴吧.png', linjia: '温柔.png',
    xionghaizi: '哪来的电脑病毒.png', sanhao: '黎曼猜想没证明喵.png', tieba: '鱼片有资源吗.png', laobeijing: '大师这个区是什么意思.png',
  };
  return map[persona.id];
}

export function attachmentsFromMeta(meta: ReplyMeta): ChatAttachment[] {
  const attachments: ChatAttachment[] = [];
  if (meta.sticker) attachments.push({ kind: 'sticker', name: meta.sticker, url: 'pet://asset/memes/' + encodeURIComponent(meta.sticker.endsWith('.png') ? meta.sticker : meta.sticker + '.png') });
  return attachments;
}
