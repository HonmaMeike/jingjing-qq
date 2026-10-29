// 时间与数值小工具：统一 ISO 字符串，保证持久化格式稳定。
export function toDate(input?: Date | number | string): Date {
  if (input === undefined) return new Date();
  if (input instanceof Date) return new Date(input.getTime());
  if (typeof input === 'number') return new Date(input);
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function toIso(input?: Date | number | string): string {
  return toDate(input).toISOString();
}

/** 用于展示的简短时间（本地时区）：YYYY-MM-DD 或 YYYY-MM-DD HH:mm。 */
export function formatDate(input?: string | number | Date, withTime = false): string {
  if (input === undefined || input === null || input === '') return '—';
  const date = toDate(input);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number): string => (value < 10 ? '0' + value : String(value));
  const day = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  if (!withTime) return day;
  return day + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

/** 年龄（天），未来时间返回 0。 */
export function ageInDays(iso: string | undefined, now: Date): number {
  if (!iso) return 0;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 0;
  return Math.max(0, (now.getTime() - time) / 86_400_000);
}

export function dayKey(input?: string | number | Date): string {
  return formatDate(input);
}

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 归一化多行文本：去首尾空白、压缩空行，限制长度。 */
export function normalizeText(value: unknown, maxLength = 4000): string {
  if (value === undefined || value === null) return '';
  const text = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, all) => line.length > 0 || (index > 0 && index < all.length - 1));
  return lines.join('\n').trim().slice(0, maxLength);
}

/** 单行归一化。 */
export function normalizeLine(value: unknown, maxLength = 400): string {
  return normalizeText(value, maxLength).replace(/\s+/g, ' ').trim();
}
