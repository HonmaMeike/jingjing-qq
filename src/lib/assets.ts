import type { PetAsset } from '@shared/types';

/** 把素材相对路径变成可直接用于 img/video 的 URL。
 *  生产与开发都由 Vite 将 public/pet 复制/服务到页面同源，因此使用相对路径，
 *  避免 Electron 自定义协议在中文路径上的兼容问题。 */
export function assetUrl(relativePath?: string): string {
  if (!relativePath) return '';
  if (/^(https?:|data:|blob:|media:|file:|pet:|demo:)/.test(relativePath)) return normalizeAssetUrl(relativePath);
  const clean = relativePath.replace(/\\/g, '/').replace(/^\.?\//, '');
  return './pet/' + clean.split('/').map((s) => encodeURIComponent(s)).join('/');
}

export function normalizeAssetUrl(url?: string): string {
  if (!url) return '';
  if (url.startsWith('pet://asset/')) {
    try {
      const decoded = decodeURIComponent(url.slice('pet://asset/'.length));
      return assetUrl(decoded);
    } catch { return url; }
  }
  if (url.startsWith('demo://')) return assetUrl('memes/可爱.png');
  return url;
}

export function petAsset(assets: PetAsset[], name: string): PetAsset | undefined {
  return assets.find((a) => a.name === name);
}

export const FALLBACK_PET = { webm: 'animations/待机呼吸休闲.webm', gif: 'gifs/待机呼吸休闲.gif', name: '待机呼吸休闲' };
