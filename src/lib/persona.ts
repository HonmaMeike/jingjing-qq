import type { Persona, PetAsset } from '@shared/types';
import { assetUrl } from './assets';

export function personaAvatarUrl(persona?: Persona | null): string | undefined {
  const raw = persona?.avatar;
  if (!raw) return undefined;
  if (/^(https?:|data:|blob:|pet:)/.test(raw)) return raw;
  if (/\.(png|jpe?g|webp|gif|webm)$/i.test(raw)) return assetUrl(raw);
  return undefined;
}

export function personaAnimation(persona: Persona | undefined, petAssets: PetAsset[]): string | undefined {
  if (!persona) return undefined;
  const candidates = [persona.animation, persona.nickname, persona.name].filter(Boolean) as string[];
  for (const name of candidates) {
    const found = petAssets.find((a) => a.name === name || a.name.includes(name));
    if (found?.webm) return assetUrl(found.webm);
  }
  return assetUrl('animations/待机呼吸休闲.webm');
}

export function personaGradient(persona?: Persona | null): string {
  const color = persona?.color || '#4d8dff';
  return `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 42%, #7c6cff))`;
}
