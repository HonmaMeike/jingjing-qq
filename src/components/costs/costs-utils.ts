import type { AppSettings, BillingSettings, UsageKind, UsageProvider } from '@shared/types';

export const DEFAULT_BILLING: BillingSettings = {
  monthlyBudgetCny: 100,
  deepseekInputPerMillion: 2,
  deepseekOutputPerMillion: 8,
  deepseekReasonerInputPerMillion: 9,
  deepseekReasonerOutputPerMillion: 27,
  breezePerKChar: 0.1,
  minimaxImage: 0.2,
  minimaxVideoSecond: 0.5,
  sunoTrack: 0.2,
  serperSearch: 0.005,
  deepseekSearchPerCall: 0.005,
};

export interface UsageProviderMeta {
  label: string;
  color: string;
  short: string;
}

export const USAGE_PROVIDER_META: Record<UsageProvider, UsageProviderMeta> = {
  deepseek: { label: 'DeepSeek', color: 'var(--brand)', short: 'DeepSeek' },
  breezeblue: { label: 'BreezeBlue', color: 'var(--aqua)', short: 'Breeze' },
  minimax: { label: 'MiniMax', color: 'var(--brand-3)', short: 'MiniMax' },
  suno: { label: 'Suno', color: 'var(--pink)', short: 'Suno' },
  serper: { label: 'Serper', color: 'var(--amber)', short: 'Serper' },
  bilibili: { label: '哔哩哔哩', color: 'var(--mint)', short: 'B站' },
  napcat: { label: 'NapCat', color: 'var(--success)', short: 'NapCat' },
  memory: { label: '本地记忆', color: 'var(--brand-2)', short: '记忆' },
  other: { label: '其他', color: 'var(--text-3)', short: '其他' },
};

export const USAGE_KIND_LABELS: Record<UsageKind, string> = {
  llm: '大模型',
  tts: '语音',
  image: '图像',
  video: '视频',
  music: '音乐',
  search: '搜索',
  message: '消息',
  other: '其他',
};

export const USAGE_UNIT_LABELS: Record<string, string> = {
  tokens: 'tokens',
  characters: '字符',
  images: '张',
  seconds: '秒',
  tracks: '首',
  requests: '次',
  messages: '条',
};

export interface BillingFieldMeta {
  key: keyof BillingSettings;
  label: string;
  hint: string;
  step: number;
  group: 'budget' | 'llm' | 'media';
}

export const BILLING_FIELDS: BillingFieldMeta[] = [
  { key: 'monthlyBudgetCny', label: '月预算', hint: '每月预算上限，用于进度与剩余额度', step: 1, group: 'budget' },
  { key: 'deepseekInputPerMillion', label: 'DeepSeek Flash 输入', hint: 'deepseek-flash · 元 / 百万 input tokens', step: 0.1, group: 'llm' },
  { key: 'deepseekOutputPerMillion', label: 'DeepSeek Flash 输出', hint: 'deepseek-flash · 元 / 百万 output tokens', step: 0.1, group: 'llm' },
  { key: 'deepseekReasonerInputPerMillion', label: 'V4 Pro 输入', hint: 'deepseek-v4-pro · 元 / 百万 input tokens', step: 0.1, group: 'llm' },
  { key: 'deepseekReasonerOutputPerMillion', label: 'V4 Pro 输出', hint: 'deepseek-v4-pro · 元 / 百万 output tokens', step: 0.1, group: 'llm' },
  { key: 'breezePerKChar', label: 'BreezeBlue TTS', hint: '元 / 千字符', step: 0.01, group: 'media' },
  { key: 'minimaxImage', label: 'MiniMax 图像', hint: '元 / 张', step: 0.01, group: 'media' },
  { key: 'minimaxVideoSecond', label: 'MiniMax 视频', hint: '元 / 秒', step: 0.01, group: 'media' },
  { key: 'sunoTrack', label: 'Suno 音乐', hint: '元 / 首', step: 0.01, group: 'media' },
  { key: 'serperSearch', label: 'Serper 搜索', hint: '元 / 次', step: 0.001, group: 'media' },
  { key: 'deepseekSearchPerCall', label: 'DeepSeek 搜索/抓取', hint: '元 / 次（官方 5 元 / 1000 次）', step: 0.001, group: 'media' },
];

export function billingFromSettings(settings?: AppSettings | null): BillingSettings {
  return { ...DEFAULT_BILLING, ...(settings?.billing ?? {}) };
}

export function formatCny(value?: number, digits = 2): string {
  const amount = value ?? 0;
  if (!Number.isFinite(amount)) return '¥0.00';
  if (amount > 0 && amount < 0.01) return '¥' + amount.toFixed(4);
  return '¥' + amount.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatCompactCny(value?: number): string {
  const amount = value ?? 0;
  if (!Number.isFinite(amount)) return '¥0';
  if (Math.abs(amount) >= 10000) return '¥' + (amount / 10000).toFixed(1) + 'w';
  if (Math.abs(amount) >= 100) return '¥' + amount.toFixed(0);
  if (Math.abs(amount) < 0.01 && amount !== 0) return '¥' + amount.toFixed(3);
  return '¥' + amount.toFixed(2);
}

export function formatUnit(units: number | undefined, unit: string | undefined): string {
  const value = units ?? 0;
  const suffix = USAGE_UNIT_LABELS[unit ?? ''] ?? unit ?? '';
  return value.toLocaleString('zh-CN') + (suffix ? ' ' + suffix : '');
}

export function budgetTone(percent?: number): 'brand' | 'warning' | 'danger' {
  const value = percent ?? 0;
  if (value >= 100) return 'danger';
  if (value >= 80) return 'warning';
  return 'brand';
}

export function dateLabel(date: string): string {
  const parts = date.split('-');
  if (parts.length < 3) return date;
  return parts[1] + '/' + parts[2];
}

export function billingPatchFromForm(form: Record<string, string>): Partial<BillingSettings> {
  const patch: Partial<BillingSettings> = {};
  for (const field of BILLING_FIELDS) {
    const value = Number(form[field.key]);
    patch[field.key] = Number.isFinite(value) ? Math.max(0, value) : 0;
  }
  return patch;
}

export function billingFormFrom(billing: BillingSettings): Record<string, string> {
  const form: Record<string, string> = {};
  for (const field of BILLING_FIELDS) form[field.key] = String(billing[field.key] ?? 0);
  return form;
}
