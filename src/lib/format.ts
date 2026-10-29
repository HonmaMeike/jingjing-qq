export function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

export function relativeTime(iso?: string): string {
  if (!iso) return '刚刚';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < 45_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return formatDate(iso);
}

export function formatNumber(n?: number): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '0';
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return n.toLocaleString('zh-CN');
}

export function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let value = bytes;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function clamp(n: number, min = 0, max = 1): number { return Math.min(max, Math.max(min, n)); }

export function initials(name?: string): string {
  if (!name) return '鲸';
  return name.trim().slice(0, 1).toUpperCase();
}

export function uid(prefix = 'tmp'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function moodTone(mood?: string): 'good' | 'bad' | 'neutral' {
  if (!mood) return 'neutral';
  if (/开心|高兴|期待|兴奋|喜欢|元气|雀跃|幸福|骄傲|得意|平静/.test(mood)) return 'good';
  if (/生气|难过|委屈|烦躁|嫉妒|吃醋|失落|困|累|冷漠|不屑/.test(mood)) return 'bad';
  return 'neutral';
}
