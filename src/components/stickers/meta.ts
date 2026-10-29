import type { LucideIcon } from 'lucide-react';
import { Bookmark, Images, Sparkles, Wand2 } from 'lucide-react';
import type { StickerMood, StickerSource } from '@shared/types';

export type BadgeTone = 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'pink' | 'mint';

export const STICKER_SOURCE_ORDER: StickerSource[] = ['builtin', 'saved', 'generated', 'collected'];

export const STICKER_SOURCE_META: Record<StickerSource, { label: string; color: string; tone: BadgeTone; icon: LucideIcon; hint: string }> = {
  builtin: { label: '内置', color: 'var(--brand-2)', tone: 'brand', icon: Images, hint: '随应用一起带来的鲸鱼娘表情' },
  saved: { label: '已保存', color: 'var(--mint)', tone: 'mint', icon: Bookmark, hint: '你亲手收进库里的一张' },
  generated: { label: '她画的', color: 'var(--pink)', tone: 'pink', icon: Wand2, hint: '她让 MiniMax 画的鲸鱼娘表情' },
  collected: { label: '她收集的', color: 'var(--amber)', tone: 'warning', icon: Sparkles, hint: '她自己从素材里挑进来的' },
};

export const STICKER_MOOD_ORDER: StickerMood[] = [
  'happy', 'love', 'shy', 'tease', 'comfort', 'angry', 'sad', 'tired', 'food', 'work', 'greeting', 'neutral',
];

export const STICKER_MOOD_META: Record<StickerMood, { label: string; color: string }> = {
  happy: { label: '开心', color: 'var(--amber)' },
  love: { label: '喜欢', color: 'var(--pink)' },
  shy: { label: '害羞', color: 'var(--pink)' },
  tease: { label: '调皮', color: 'var(--brand-3)' },
  comfort: { label: '安慰', color: 'var(--mint)' },
  angry: { label: '生气', color: 'var(--danger)' },
  sad: { label: '难过', color: 'var(--brand-3)' },
  tired: { label: '困倦', color: 'var(--text-3)' },
  food: { label: '干饭', color: 'var(--amber)' },
  work: { label: '工作', color: 'var(--brand-2)' },
  greeting: { label: '打招呼', color: 'var(--aqua)' },
  neutral: { label: '平静', color: 'var(--text-3)' },
};

export function timeValue(iso?: string): number {
  if (!iso) return 0;
  const value = new Date(iso).getTime();
  return Number.isNaN(value) ? 0 : value;
}

export function uniqueTags(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const tag = value.trim().replace(/^#/, '');
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function collectTags(items: { tags: string[] }[], extra: string[] = []): string[] {
  return uniqueTags([...extra, ...items.flatMap((item) => item.tags ?? [])]).sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return Math.round(bytes / 1024) + ' KB';
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
