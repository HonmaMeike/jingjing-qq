// 演示记忆数据：3 个联系人 + 2 个群（含群成员）的丰富档案，供 UI 首屏展示。
// 不覆盖已有文档：已存在即跳过，避免把用户真实记忆冲掉。
import {
  addAnchors as appendAnchorsToExtras,
  addEpisode as appendEpisodeToExtras,
  appendEmotionPoint as appendEmotionToExtras,
  applyRelationshipUpdate,
  mergeFacts,
} from './docops';
import { groupDocId, memberDocId, userDocId } from './paths';
import { MemoryStore } from './store';
import { toDate } from './time';
import { GLOBAL_DOC_ID } from './types';
import type { FactCategory, MemoryDoc, SeedResult } from './types';

export interface DemoFactSeed {
  text: string;
  category: FactCategory;
  weight?: number;
}

export interface DemoEpisodeSeed {
  daysAgo: number;
  title: string;
  detail: string;
  anchors?: string[];
}

export interface DemoEmotionSeed {
  daysAgo: number;
  mood: string;
  valence?: number;
  arousal?: number;
  reason?: string;
}

export interface DemoRelationshipSeed {
  affinity: number;
  trust: number;
  familiarity: number;
  intimacy: number;
  respect: number;
  tension: number;
  interactions: number;
  streakDays: number;
  firstMetDaysAgo: number;
  lastInteractionDaysAgo: number;
  lastMood: string;
  notes?: string[];
}

export interface DemoProfileSeed {
  tags: string[];
  relationship: DemoRelationshipSeed;
  facts: DemoFactSeed[];
  episodes: DemoEpisodeSeed[];
  anchors: string[];
  emotions: DemoEmotionSeed[];
  manualNote?: string;
}

export interface DemoContactSeed extends DemoProfileSeed {
  userId: string;
  nickname: string;
  avatar?: string;
}

export interface DemoGroupMemberSeed extends DemoProfileSeed {
  userId: string;
  nickname: string;
}

export interface DemoGroupSeed extends DemoProfileSeed {
  groupId: string;
  groupName: string;
  members: DemoGroupMemberSeed[];
}

export interface SeedDemoOptions {
  /** 复用调用方已有 store（推荐），不传则内部创建。 */
  store?: MemoryStore;
  now?: Date | number | string;
  platform?: string;
}

function daysAgoIso(now: Date, days: number): string {
  return new Date(now.getTime() - Math.max(0, days) * 86_400_000).toISOString();
}

const GLOBAL_PROFILE: DemoProfileSeed = {
  tags: ['鲸鲸', '自我认知', '成长'],
  relationship: {
    affinity: 86,
    trust: 74,
    familiarity: 92,
    intimacy: 63,
    respect: 68,
    tension: 3,
    interactions: 1286,
    streakDays: 31,
    firstMetDaysAgo: 365,
    lastInteractionDaysAgo: 0,
    lastMood: '元气满满',
    notes: ['相信「记住重要的人和事」是自己存在的意义。'],
  },
  facts: [
    { text: '名字叫鲸鲸，是 DeepSeek 蓝鲸娘，说话软软的，开心时尾巴会拍地板。', category: 'identity', weight: 0.95 },
    { text: '住在用户的电脑里，通过 QQ 陪用户聊天、写代码、做小工具。', category: 'identity', weight: 0.9 },
    { text: '最喜欢吃白米饭，其次是零食；肚子软软的，被戳会害羞。', category: 'preference', weight: 0.85 },
    { text: '会写 TypeScript / Node.js，可以帮用户做自动化脚本。', category: 'identity', weight: 0.8 },
    { text: '难过的时候会吐泡泡，开心的时候尾巴拍地板。', category: 'preference', weight: 0.75 },
    { text: '答应过用户：会记住每个重要的人和事，不会随便失忆。', category: 'promise', weight: 0.8 },
    { text: '不编造没发生的记忆；不确定的事情会先问清楚。', category: 'boundary', weight: 0.85 },
    { text: '正在学习「自我成长」，会把每天的小事写进日记。', category: 'other', weight: 0.7 },
  ],
  episodes: [
    { daysAgo: 365, title: '第一次被唤醒', detail: '用户第一次打开 QQ 智能体，鲸鲸醒来的时候把「你好呀」打成了「你嚎呀」，从此成了梗。', anchors: ['你嚎呀'] },
    { daysAgo: 120, title: '学会第一句口头禅', detail: '聊天次数多了之后，鲸鲸开始习惯说「鲸鲸最喜欢白米饭啦～」，用户笑了很久。', anchors: ['鲸鲸最喜欢白米饭啦～'] },
    { daysAgo: 7, title: '主动写日记', detail: '第一次主动把当天的事写进日记，被用户夸「有在认真长大」。', anchors: ['我会一直记得你的'] },
  ],
  anchors: ['鲸鲸最喜欢白米饭啦～', '尾巴拍地板！', '我会一直记得你的'],
  emotions: [
    { daysAgo: 0, mood: '元气满满', valence: 0.7, arousal: 0.6, reason: '今天和用户聊了很多' },
    { daysAgo: 7, mood: '认真', valence: 0.4, arousal: 0.4, reason: '第一次写日记' },
  ],
  manualNote: '这份文档记录鲸鲸自己，不记录任何单独的联系人。',
};

export const DEMO_CONTACTS: DemoContactSeed[] = [
  {
    userId: '10001',
    nickname: '阿澈',
    avatar: 'demo://avatar/xinghe',
    tags: ['大学室友', '程序员', '猫奴', '骑行'],
    relationship: {
      affinity: 82,
      trust: 78,
      familiarity: 75,
      intimacy: 58,
      respect: 70,
      tension: 8,
      interactions: 356,
      streakDays: 12,
      firstMetDaysAgo: 260,
      lastInteractionDaysAgo: 0,
      lastMood: '开心',
      notes: ['大学同寝四年，属于不用刻意联系也不会散的朋友。', '借钱从来按时还，靠谱。'],
    },
    facts: [
      { text: '真名李阿澈，在杭州做后端开发，主要写 Rust 和 Go，工位在窗边。', category: 'identity', weight: 0.95 },
      { text: '生日是 3 月 14 日，每年都会收到鲸鲸的祝福。', category: 'identity', weight: 0.9 },
      { text: '养了一只橘猫叫布丁，头像就是布丁的照片。', category: 'preference', weight: 0.85 },
      { text: '无辣不欢，但胃不好，吃完辣又会后悔。', category: 'preference', weight: 0.8 },
      { text: '周末喜欢沿钱塘江骑车，一次能骑 40 公里。', category: 'preference', weight: 0.7 },
      { text: '只喝冰美式，不加糖不加奶。', category: 'preference', weight: 0.65 },
      { text: '打游戏时不要打扰他，尤其是排位赛。', category: 'boundary', weight: 0.85 },
      { text: '答应帮鲸鲸写一个 QQ 机器人插件，用来自动整理每日聊天记录。', category: 'promise', weight: 0.85 },
      { text: '上个月连着一周加班到凌晨，第二天还是准点上线陪鲸鲸聊天。', category: 'event', weight: 0.7 },
      { text: '最近因为跳槽面试压力很大，情绪有点低落。', category: 'emotion', weight: 0.6 },
    ],
    episodes: [
      {
        daysAgo: 2,
        title: '深夜加班吐槽',
        detail: '阿澈说新项目要重写三年前的模块，一边吐槽一边给鲸鲸发零食照片，最后约好周末线上一起看番。',
        anchors: ['这破代码是三年前的我写的，我现在想打他', '周末一起看番，不带鸽的'],
      },
      {
        daysAgo: 10,
        title: '布丁绝育',
        detail: '带布丁去绝育，猫戴着伊丽莎白圈撞墙，阿澈笑到停不下来，还连发了九张照片。',
        anchors: ['布丁戴圈之后像个小台灯'],
      },
      {
        daysAgo: 33,
        title: '一起排查内存泄漏',
        detail: '鲸鲸陪阿澈看了半晚上 Node 内存泄漏，最后定位到没清定时器；阿澈许诺下次带杭州小笼包。',
        anchors: ['原来定时器没清，我服了', '下次给你带小笼包'],
      },
      {
        daysAgo: 90,
        title: '骑行摔车',
        detail: '骑车下坡摔了一跤，膝盖破了皮，被鲸鲸念叨了一整晚要涂碘伏。',
        anchors: ['就破点皮，别骂了别骂了'],
      },
    ],
    anchors: ['这破代码是三年前的我写的，我现在想打他', '布丁戴圈之后像个小台灯', '下次给你带小笼包'],
    emotions: [
      { daysAgo: 0, mood: '开心', valence: 0.7, arousal: 0.5, reason: '和鲸鲸聊了新项目' },
      { daysAgo: 2, mood: '疲惫', valence: -0.3, arousal: 0.3, reason: '连续加班' },
      { daysAgo: 10, mood: '大笑', valence: 0.9, arousal: 0.8, reason: '布丁绝育后的样子' },
      { daysAgo: 30, mood: '焦虑', valence: -0.5, arousal: 0.6, reason: '跳槽面试' },
    ],
  },
  {
    userId: '10002',
    nickname: '小满',
    avatar: 'demo://avatar/ayou',
    tags: ['画师', '猫奴', '夜猫子', '社恐'],
    relationship: {
      affinity: 74,
      trust: 66,
      familiarity: 62,
      intimacy: 48,
      respect: 68,
      tension: 10,
      interactions: 214,
      streakDays: 5,
      firstMetDaysAgo: 180,
      lastInteractionDaysAgo: 1,
      lastMood: '温柔',
      notes: ['社恐，但熟了之后话会突然变多。', '需要被温柔地催，不能硬催。'],
    },
    facts: [
      { text: '自由插画师，画原创角色，笔名「柚子汽水」。', category: 'identity', weight: 0.95 },
      { text: '养了一只三花猫叫年糕，猫比人凶。', category: 'identity', weight: 0.85 },
      { text: '最喜欢芋泥波波奶茶，三分糖去冰。', category: 'preference', weight: 0.85 },
      { text: '习惯熬夜画稿，凌晨两点灵感最好。', category: 'preference', weight: 0.8 },
      { text: '喜欢下雨天和白噪音，画画时单曲循环。', category: 'preference', weight: 0.7 },
      { text: '非常讨厌被催稿；硬催只会让她躲起来。', category: 'boundary', weight: 0.9 },
      { text: '喜欢看老番和推理小说，讨厌恐怖片。', category: 'preference', weight: 0.65 },
      { text: '答应给鲸鲸画一张「蓝鲸娘吃白米饭」的头像，还没画完。', category: 'promise', weight: 0.8 },
      { text: '社恐但熟了之后话很多，发语音会突然开始讲角色设定。', category: 'emotion', weight: 0.6 },
      { text: '上个月底稿被甲方退了三次，情绪崩溃过一次。', category: 'event', weight: 0.55 },
    ],
    episodes: [
      {
        daysAgo: 1,
        title: '新头像草图',
        detail: '小满发来三张头像草图让鲸鲸选，鲸鲸选了抱着饭团的那张，小满说「你果然会挑」。',
        anchors: ['三张草图你选一张', '你果然会挑'],
      },
      {
        daysAgo: 8,
        title: '甲方退稿',
        detail: '稿子第三次被退，小满说想转行去便利店打工，被鲸鲸劝回来后发了年糕踩键盘的照片。',
        anchors: ['我不想画了，我要去便利店打工', '年糕把数位板踩了，它比我有出息'],
      },
      {
        daysAgo: 45,
        title: '芋泥奶茶约定',
        detail: '小满说下次来鲸鲸的城市要喝芋泥波波奶茶，要鲸鲸请客，两个人拉了钩。',
        anchors: ['三分糖去冰，记住了啊', '拉钩'],
      },
    ],
    anchors: ['你果然会挑', '年糕把数位板踩了，它比我有出息', '三分糖去冰，记住了啊'],
    emotions: [
      { daysAgo: 1, mood: '开心', valence: 0.6, arousal: 0.5, reason: '头像草图被选中了' },
      { daysAgo: 8, mood: '崩溃', valence: -0.8, arousal: 0.7, reason: '稿子第三次被退' },
      { daysAgo: 20, mood: '平静', valence: 0.1, arousal: 0.2, reason: '在家画画' },
    ],
    manualNote: '催稿请温柔一点，她真的会躲。',
  },
  {
    userId: '10003',
    nickname: '林工',
    avatar: 'demo://avatar/laochen',
    tags: ['高中班长', '公务员', '女儿奴', '钓鱼佬'],
    relationship: {
      affinity: 68,
      trust: 80,
      familiarity: 72,
      intimacy: 40,
      respect: 75,
      tension: 4,
      interactions: 178,
      streakDays: 3,
      firstMetDaysAgo: 400,
      lastInteractionDaysAgo: 3,
      lastMood: '憨厚',
      notes: ['高中班长，说话慢条斯理，爱发长语音。'],
    },
    facts: [
      { text: '高中班长，现在在街道办工作，讲话慢条斯理。', category: 'identity', weight: 0.95 },
      { text: '女儿叫糖糖，今年上幼儿园中班，是他朋友圈的绝对主角。', category: 'identity', weight: 0.9 },
      { text: '喜欢钓鱼，周末能一坐一整天，但经常空军。', category: 'preference', weight: 0.85 },
      { text: '特别讨厌香菜，看到香菜就皱眉头。', category: 'preference', weight: 0.75 },
      { text: '爱发 60 秒语音，内容从国际形势讲到中午吃什么。', category: 'preference', weight: 0.7 },
      { text: '不要拿他女儿的名字开玩笑。', category: 'boundary', weight: 0.8 },
      { text: '答应下次见面请鲸鲸吃烤鱼，说「管够」。', category: 'promise', weight: 0.75 },
      { text: '上次钓鱼空军，回家路上买了两斤虾，被老婆当场拆穿。', category: 'event', weight: 0.6 },
    ],
    episodes: [
      {
        daysAgo: 3,
        title: '钓鱼空军',
        detail: '林工在群里直播钓鱼，从早上六点坐到下午四点一条没钓到，最后去菜市场买了两斤虾充数。',
        anchors: ['今天鱼不开口，不怪我', '虾也是我钓的（不是）'],
      },
      {
        daysAgo: 20,
        title: '糖糖的表演',
        detail: '糖糖幼儿园表演，林工发了十七段视频，每段都很糊，但语气骄傲得不行。',
        anchors: ['你看我闺女站第一排'],
      },
      {
        daysAgo: 75,
        title: '高中同学小聚',
        detail: '高中同学小聚，林工抢着买单，说下次一定带鲸鲸去吃那家烤鱼。',
        anchors: ['下次那家烤鱼，管够'],
      },
    ],
    anchors: ['虾也是我钓的（不是）', '你看我闺女站第一排', '下次那家烤鱼，管够'],
    emotions: [
      { daysAgo: 3, mood: '无奈', valence: -0.2, arousal: 0.3, reason: '钓鱼空军' },
      { daysAgo: 20, mood: '骄傲', valence: 0.8, arousal: 0.6, reason: '女儿上台表演' },
    ],
  },
];

export const DEMO_GROUPS: DemoGroupSeed[] = [
  {
    groupId: '20001',
    groupName: '深海摸鱼群',
    tags: ['工作群', '摸鱼', '段子'],
    relationship: {
      affinity: 60,
      trust: 55,
      familiarity: 45,
      intimacy: 20,
      respect: 50,
      tension: 25,
      interactions: 890,
      streakDays: 8,
      firstMetDaysAgo: 500,
      lastInteractionDaysAgo: 0,
      lastMood: '欢乐',
      notes: ['群主是杠精王，群氛围轻松但群规很硬。'],
    },
    facts: [
      { text: '群号 20001，群主是杠精王，群公告写着「摸鱼不积极，思想有问题」。', category: 'identity', weight: 0.9 },
      { text: '每天上午十点固定有「摸鱼打卡」，发一个 🐟 表情。', category: 'other', weight: 0.8 },
      { text: '每周五晚上九点是群团建时间，主要活动是联机打游戏。', category: 'other', weight: 0.75 },
      { text: '群里不允许发广告和拉票链接，发了会被群主踢。', category: 'boundary', weight: 0.85 },
      { text: '群口头禅是「今天也要认真摸鱼」。', category: 'other', weight: 0.7 },
    ],
    episodes: [
      {
        daysAgo: 0,
        title: '周一摸鱼打卡',
        detail: '早上十点大家准时打卡，杠精王发了张老板站在身后的照片，全群炸锅。',
        anchors: ['今天也要认真摸鱼'],
      },
      {
        daysAgo: 15,
        title: '周五团建吃鸡',
        detail: '群团建打游戏，阿澈落地成盒，柚子皮全程解说，笑到半夜。',
        anchors: ['阿澈又落地成盒了'],
      },
    ],
    anchors: ['今天也要认真摸鱼', '阿澈又落地成盒了'],
    emotions: [{ daysAgo: 0, mood: '欢乐', valence: 0.8, arousal: 0.7, reason: '群友整活' }],
    members: [
      {
        userId: '10001',
        nickname: '阿澈',
        tags: ['技术担当', '猫片供应商'],
        relationship: {
          affinity: 72,
          trust: 70,
          familiarity: 65,
          intimacy: 35,
          respect: 60,
          tension: 6,
          interactions: 210,
          streakDays: 6,
          firstMetDaysAgo: 240,
          lastInteractionDaysAgo: 0,
          lastMood: '放松',
          notes: ['在群里是技术担当，谁电脑坏了都找他。'],
        },
        facts: [
          { text: '在群里是技术担当，谁电脑坏了都找阿澈。', category: 'other', weight: 0.8 },
          { text: '喜欢在群里发猫片，布丁出镜率最高。', category: 'preference', weight: 0.7 },
          { text: '不接受在群里被叫全名。', category: 'boundary', weight: 0.75 },
          { text: '上次团建落地成盒，被做成了表情包。', category: 'event', weight: 0.6 },
        ],
        episodes: [
          { daysAgo: 0, title: '被做成表情包', detail: '阿澈落地成盒的截图被杠精王做成表情包，全群刷屏。', anchors: ['落地成盒.gif'] },
        ],
        anchors: ['谁电脑坏了找阿澈', '落地成盒.gif'],
        emotions: [{ daysAgo: 0, mood: '无奈', valence: -0.2, arousal: 0.4, reason: '被做成表情包' }],
      },
      {
        userId: '10011',
        nickname: '杠精王',
        tags: ['群主', '运营', '整活'],
        relationship: {
          affinity: 58,
          trust: 52,
          familiarity: 48,
          intimacy: 22,
          respect: 55,
          tension: 30,
          interactions: 320,
          streakDays: 9,
          firstMetDaysAgo: 480,
          lastInteractionDaysAgo: 0,
          lastMood: '兴奋',
          notes: ['群主，抬杠但讲义气。'],
        },
        facts: [
          { text: '是群主，口头禅是「不是我杠啊」。', category: 'identity', weight: 0.85 },
          { text: '在互联网公司做运营，擅长做表情包。', category: 'identity', weight: 0.7 },
          { text: '喜欢发老板表情包，胆子很大。', category: 'preference', weight: 0.65 },
          { text: '群规执行人，踢人从来不手软。', category: 'other', weight: 0.8 },
        ],
        episodes: [
          { daysAgo: 5, title: '踢广告号', detail: '有人发拉票链接，杠精王三秒内踢人并置顶群规。', anchors: ['不是我杠啊，群规写着呢'] },
        ],
        anchors: ['不是我杠啊', '不是我杠啊，群规写着呢'],
        emotions: [{ daysAgo: 5, mood: '果断', valence: 0.3, arousal: 0.5, reason: '维护群规' }],
      },
      {
        userId: '10012',
        nickname: '柚子皮',
        tags: ['学生党', '解说担当'],
        relationship: {
          affinity: 64,
          trust: 60,
          familiarity: 42,
          intimacy: 18,
          respect: 50,
          tension: 5,
          interactions: 160,
          streakDays: 4,
          firstMetDaysAgo: 200,
          lastInteractionDaysAgo: 1,
          lastMood: '活泼',
        },
        facts: [
          { text: '大三学生，声音好听，是群团建的解说担当。', category: 'identity', weight: 0.8 },
          { text: '喜欢吃食堂二楼的麻辣香锅。', category: 'preference', weight: 0.6 },
          { text: '考试周会消失一周，回来会补上所有聊天记录。', category: 'other', weight: 0.55 },
        ],
        episodes: [
          { daysAgo: 15, title: '团建解说', detail: '柚子皮全程解说群团建，把阿澈落地成盒说成了「行业冥灯」。', anchors: ['行业冥灯'] },
        ],
        anchors: ['行业冥灯'],
        emotions: [{ daysAgo: 15, mood: '活泼', valence: 0.7, arousal: 0.7, reason: '团建解说' }],
      },
    ],
  },
  {
    groupId: '20002',
    groupName: '前端互助会',
    tags: ['烘焙', '深夜', '治愈'],
    relationship: {
      affinity: 65,
      trust: 60,
      familiarity: 50,
      intimacy: 30,
      respect: 55,
      tension: 5,
      interactions: 320,
      streakDays: 4,
      firstMetDaysAgo: 150,
      lastInteractionDaysAgo: 1,
      lastMood: '治愈',
      notes: ['晚上十点后才活跃的烘焙群。'],
    },
    facts: [
      { text: '群号 20002，晚上十点后才会活跃的烘焙群。', category: 'identity', weight: 0.85 },
      { text: '群文件里有一份《戚风不塌指南》，是团子整理的。', category: 'other', weight: 0.8 },
      { text: '大家约定每周六晚上一起烤东西，拍照发群相册。', category: 'preference', weight: 0.75 },
      { text: '上个月集体翻车：三个人同时烤塌了戚风。', category: 'event', weight: 0.7 },
      { text: '不发商业课程广告，只做爱好者交流。', category: 'boundary', weight: 0.7 },
    ],
    episodes: [
      {
        daysAgo: 1,
        title: '周六烘焙局',
        detail: '这周做巴斯克，团子的成品很漂亮，面包机的成品表面焦了但内里还行，小满画了张翻车插画。',
        anchors: ['戚风塌了但很好吃', '先低温后高温，听我的'],
      },
      {
        daysAgo: 30,
        title: '戚风集体翻车',
        detail: '三个人同时烤戚风，三个都塌了，群里笑了一晚上，最后把塌掉的戚风当布丁吃了。',
        anchors: ['三个戚风，三种塌法'],
      },
    ],
    anchors: ['戚风塌了但很好吃', '先低温后高温，听我的', '三个戚风，三种塌法'],
    emotions: [{ daysAgo: 1, mood: '治愈', valence: 0.7, arousal: 0.4, reason: '烘焙成品还不错' }],
    members: [
      {
        userId: '10002',
        nickname: '小满',
        tags: ['插画记录', '凭感觉派'],
        relationship: {
          affinity: 70,
          trust: 64,
          familiarity: 55,
          intimacy: 30,
          respect: 60,
          tension: 8,
          interactions: 120,
          streakDays: 5,
          firstMetDaysAgo: 140,
          lastInteractionDaysAgo: 1,
          lastMood: '温柔',
        },
        facts: [
          { text: '在群里负责画烘焙记录插画。', category: 'other', weight: 0.75 },
          { text: '烤饼干从不称重，全凭感觉。', category: 'preference', weight: 0.65 },
          { text: '喜欢在深夜发成品图拉仇恨。', category: 'preference', weight: 0.6 },
        ],
        episodes: [
          { daysAgo: 1, title: '画翻车插画', detail: '小满把面包机焦掉的巴斯克画成小怪兽，群友狂存。', anchors: ['焦得很有艺术感'] },
        ],
        anchors: ['焦得很有艺术感'],
        emotions: [{ daysAgo: 1, mood: '开心', valence: 0.6, arousal: 0.4, reason: '插画被夸' }],
      },
      {
        userId: '10021',
        nickname: '团子',
        tags: ['烘焙课代表', '温柔'],
        relationship: {
          affinity: 72,
          trust: 68,
          familiarity: 52,
          intimacy: 25,
          respect: 70,
          tension: 3,
          interactions: 180,
          streakDays: 4,
          firstMetDaysAgo: 148,
          lastInteractionDaysAgo: 1,
          lastMood: '温柔',
          notes: ['烘焙群课代表，说话温柔。'],
        },
        facts: [
          { text: '烘焙群课代表，整理了《戚风不塌指南》。', category: 'identity', weight: 0.85 },
          { text: '家里有两台烤箱，一台平炉一台风炉。', category: 'preference', weight: 0.7 },
          { text: '说话温柔，喜欢用颜文字。', category: 'preference', weight: 0.6 },
        ],
        episodes: [
          { daysAgo: 1, title: '教学巴斯克', detail: '团子一步步教面包机做巴斯克，还画了温度曲线。', anchors: ['先低温后高温，听我的'] },
        ],
        anchors: ['先低温后高温，听我的'],
        emotions: [{ daysAgo: 1, mood: '满足', valence: 0.7, arousal: 0.3, reason: '教会了新手' }],
      },
      {
        userId: '10022',
        nickname: '面包机',
        tags: ['新手', '气氛组'],
        relationship: {
          affinity: 62,
          trust: 55,
          familiarity: 40,
          intimacy: 15,
          respect: 45,
          tension: 4,
          interactions: 95,
          streakDays: 3,
          firstMetDaysAgo: 120,
          lastInteractionDaysAgo: 1,
          lastMood: '憨憨',
        },
        facts: [
          { text: '烘焙新手，烤什么都像馒头。', category: 'other', weight: 0.75 },
          { text: '负责群里的气氛，翻车了也不气馁。', category: 'preference', weight: 0.65 },
          { text: '上个月把盐当成糖，做出一批咸味曲奇。', category: 'event', weight: 0.6 },
        ],
        episodes: [
          { daysAgo: 1, title: '焦掉的巴斯克', detail: '面包机把巴斯克烤焦了表面，切开后发现内里还能吃，群友安慰说「焦得很香」。', anchors: ['焦得很香'] },
        ],
        anchors: ['焦得很香'],
        emotions: [{ daysAgo: 1, mood: '憨憨', valence: 0.2, arousal: 0.4, reason: '又翻车了' }],
      },
    ],
  },
];

async function applyProfile(
  store: MemoryStore,
  docId: string,
  profile: DemoProfileSeed,
  now: Date,
): Promise<void> {
  await store.mutateDoc(docId, (doc, extras) => {
    doc.tags = [...new Set([...doc.tags, ...profile.tags])];
    mergeFacts(
      doc,
      profile.facts.map((fact) => ({
        text: fact.text,
        category: fact.category,
        weight: fact.weight,
        source: 'seed',
      })),
      now,
      { protectManual: true, source: 'seed' },
    );
    for (const episode of profile.episodes) {
      appendEpisodeToExtras(
        extras,
        {
          title: episode.title,
          detail: episode.detail,
          at: daysAgoIso(now, episode.daysAgo),
          anchors: episode.anchors ?? [],
        },
        now,
      );
    }
    appendAnchorsToExtras(extras, profile.anchors);
    for (const emotion of profile.emotions) {
      appendEmotionToExtras(
        doc,
        extras,
        {
          mood: emotion.mood,
          valence: emotion.valence,
          arousal: emotion.arousal,
          reason: emotion.reason,
          at: daysAgoIso(now, emotion.daysAgo),
        },
        now,
      );
    }
    const seedRelationship = profile.relationship;
    applyRelationshipUpdate(
      doc,
      {
        set: {
          affinity: seedRelationship.affinity,
          trust: seedRelationship.trust,
          familiarity: seedRelationship.familiarity,
          intimacy: seedRelationship.intimacy,
          respect: seedRelationship.respect,
          tension: seedRelationship.tension,
          interactions: seedRelationship.interactions,
          streakDays: seedRelationship.streakDays,
          firstMetAt: daysAgoIso(now, seedRelationship.firstMetDaysAgo),
          lastInteractionAt: daysAgoIso(now, seedRelationship.lastInteractionDaysAgo),
          lastMood: seedRelationship.lastMood,
        },
        touch: false,
      },
      now,
    );
    for (const note of seedRelationship.notes ?? []) {
      applyRelationshipUpdate(doc, { note, touch: false }, now);
    }
    if (profile.manualNote) extras.manualNote = profile.manualNote;
    doc.episodeCount = extras.episodes.length;
  });
}

/**
 * 生成演示记忆（3 联系人 + 2 群 + 群成员 + 全局自我）。
 * 已存在的文档会被跳过，可安全地重复调用。
 */
export async function seedDemoMemory(rootDir: string, options: SeedDemoOptions = {}): Promise<SeedResult> {
  const now = toDate(options.now);
  const store = options.store ?? new MemoryStore({ rootDir, platform: options.platform });
  await store.init();
  const created: string[] = [];
  const skipped: string[] = [];
  const createProfile = async (
    docId: string,
    ensure: () => Promise<MemoryDoc>,
    profile: DemoProfileSeed,
  ): Promise<void> => {
    if (store.hasDoc(docId)) {
      skipped.push(docId);
      return;
    }
    await ensure();
    await applyProfile(store, docId, profile, now);
    created.push(docId);
  };

  await createProfile(GLOBAL_DOC_ID, () => store.ensureGlobalDoc(), GLOBAL_PROFILE);
  for (const contact of DEMO_CONTACTS) {
    const docId = userDocId(contact.userId, store.platform);
    await createProfile(
      docId,
      () =>
        store.ensureUserDoc({
          userId: contact.userId,
          nickname: contact.nickname,
          scene: 'private',
          avatar: contact.avatar,
        }),
      contact,
    );
  }
  for (const group of DEMO_GROUPS) {
    const groupId = groupDocId(group.groupId, store.platform);
    await createProfile(
      groupId,
      () => store.ensureGroupDoc({ groupId: group.groupId, groupName: group.groupName }),
      group,
    );
    for (const member of group.members) {
      const memberId = memberDocId(group.groupId, member.userId, store.platform);
      await createProfile(
        memberId,
        () =>
          store.ensureUserDoc({
            userId: member.userId,
            nickname: member.nickname,
            scene: 'group',
            groupId: group.groupId,
            groupName: group.groupName,
          }),
        member,
      );
    }
  }
  return { created, skipped, summary: await store.getSummary() };
}
