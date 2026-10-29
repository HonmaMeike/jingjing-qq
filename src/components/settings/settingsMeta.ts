import type { LucideIcon } from 'lucide-react';
import { AudioLines, Brain, Image as ImageIcon, Music, Search } from 'lucide-react';
import type { ApiKeys, AppSettings } from '@shared/types';

export type ApiKeyId = keyof ApiKeys;

/** 设置页统一的局部更新函数：深拷贝 draft 后按分区打补丁。 */
export type PatchSection = <K extends keyof AppSettings>(section: K, patch: Partial<AppSettings[K]>) => void;

export interface ApiServiceMeta {
  id: ApiKeyId;
  label: string;
  role: string;
  purpose: string;
  docs: string;
  docsLabel: string;
  placeholder: string;
  icon: LucideIcon;
  color: string;
}

/** 所有第三方密钥只在设置页这一张卡片里填写。 */
export const API_SERVICES: ApiServiceMeta[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    role: '对话大脑',
    purpose: '驱动聊天、日记、自我反思与人设生成，是最核心的一把钥匙。',
    docs: 'https://platform.deepseek.com/api_keys',
    docsLabel: 'DeepSeek 开放平台',
    placeholder: 'sk-… DeepSeek API Key',
    icon: Brain,
    color: 'var(--brand-2)',
  },
  {
    id: 'breezeblue',
    label: 'BreezeBlue',
    role: '声音',
    purpose: '中文语音合成，让鲸鲸能在 QQ 里发语音、也能在首页开口说话。',
    docs: 'https://docs.breezeblue.ai/guides/audio-tags#simplified-chinese-zh',
    docsLabel: 'BreezeBlue 文档',
    placeholder: 'BreezeBlue API Key',
    icon: AudioLines,
    color: 'var(--mint)',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    role: '影像',
    purpose: '文生图与文生视频，用于空间配图、创作工坊和自动插画。',
    docs: 'https://platform.minimax.io/docs',
    docsLabel: 'MiniMax 开放平台',
    placeholder: 'MiniMax API Key',
    icon: ImageIcon,
    color: 'var(--pink)',
  },
  {
    id: 'suno',
    label: 'Suno',
    role: '音乐',
    purpose: '一句话生成歌曲与纯音乐，让她把心情唱出来。',
    docs: 'https://docs.sunoapi.org/',
    docsLabel: 'Suno API 文档',
    placeholder: 'Suno API Key',
    icon: Music,
    color: 'var(--amber)',
  },
  {
    id: 'serper',
    label: 'Serper',
    role: '搜索',
    purpose: '联网搜索与资讯，让她查资料、学新东西、聊得来当天的事。',
    docs: 'https://serper.dev/',
    docsLabel: 'Serper 控制台',
    placeholder: 'Serper API Key',
    icon: Search,
    color: 'var(--brand-3)',
  },
];

export interface AccentOption { value: 'ocean' | 'sakura' | 'mint' | 'amber' | 'violet'; label: string; color: string }

export const ACCENT_OPTIONS: AccentOption[] = [
  { value: 'ocean', label: '深海蓝', color: '#4d8dff' },
  { value: 'sakura', label: '鲸落樱', color: '#f472b6' },
  { value: 'mint', label: '薄荷潮', color: '#34d399' },
  { value: 'amber', label: '黄昏金', color: '#f59e0b' },
  { value: 'violet', label: '极光紫', color: '#8b5cf6' },
];

export const DEEPSEEK_MODELS = [
  { value: 'deepseek-flash', label: 'deepseek-flash · V4.1 Flash（默认，省钱）' },
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro · V4 Pro（旗舰，更贵）' },
];
export const DEEPSEEK_REASONING_EFFORTS = [
  { value: 'low', label: 'low · 更快更省' },
  { value: 'high', label: 'high · 默认平衡' },
  { value: 'max', label: 'max · 最深思考' },
];
export const MINIMAX_IMAGE_MODELS = [{ value: 'image-01-live', label: 'image-01-live · 最新画风模型' }, { value: 'image-01', label: 'image-01 · 经典' }];
export const MINIMAX_VIDEO_MODELS = [
  { value: 'MiniMax-H3', label: 'MiniMax-H3 · 最新旗舰，2K / 4–15s' },
  { value: 'MiniMax-H3-Max', label: 'MiniMax-H3-Max · 快速生成，480P/768P' },
  { value: 'MiniMax-H3-Highspeed', label: 'MiniMax-H3-Highspeed · 高速，768P' },
  { value: 'MiniMax-H3-Lite', label: 'MiniMax-H3-Lite · 轻量，480P/768P' },
  { value: 'MiniMax-Hailuo-2.3', label: 'MiniMax-Hailuo-2.3 · 旧版兼容' },
  { value: 'MiniMax-Hailuo-02', label: 'MiniMax-Hailuo-02 · 旧版兼容' },
  { value: 'T2V-01-Director', label: 'T2V-01-Director · 旧版运镜' },
];
export const VIDEO_RESOLUTIONS = ['2K', '1080P', '768P', '480P'];
export const VIDEO_DURATIONS = Array.from({ length: 12 }, (_, index) => index + 4);
export function videoCapabilities(model: string): { resolutions: string[]; durations: number[] } {
  if (model === 'MiniMax-H3') return { resolutions: ['2K', '768P'], durations: Array.from({ length: 12 }, (_, i) => i + 4) };
  if (model === 'MiniMax-H3-Max') return { resolutions: ['768P', '480P'], durations: Array.from({ length: 11 }, (_, i) => i + 5) };
  if (model === 'MiniMax-H3-Highspeed') return { resolutions: ['768P'], durations: Array.from({ length: 12 }, (_, i) => i + 4) };
  if (model === 'MiniMax-H3-Lite') return { resolutions: ['768P', '480P'], durations: Array.from({ length: 12 }, (_, i) => i + 4) };
  if (model.startsWith('MiniMax-Hailuo')) return { resolutions: ['1080P', '768P', '720P'], durations: [6, 10] };
  return { resolutions: ['1080P', '768P', '720P'], durations: [6, 10] };
}
export const SUNO_MODELS = ['V6', 'V6_WILD', 'V6_MINI'];
export const IMAGE_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16'];
export const VIDEO_ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4'];
export const QZONE_VISIBILITY = [
  { value: 1, label: '公开' },
  { value: 4, label: '好友可见' },
  { value: 64, label: '仅自己' },
];
export const PROACTIVE_TARGETS = [
  { value: 'owner', label: '只找主人' },
  { value: 'close', label: '主人和亲近的人' },
  { value: 'whitelist', label: '白名单以内' },
];
export const SERVICE_TEST_ORDER = ['deepseek', 'breezeblue', 'minimax', 'suno', 'serper'] as const;
