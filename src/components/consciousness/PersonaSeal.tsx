import type { Persona } from '@shared/types';
import { Avatar, cn } from '@/components/ui';
import { personaAvatarUrl } from '@/lib/persona';

export default function PersonaSeal({ persona, size = 'lg', ring, className }: { persona?: Persona; size?: 'md' | 'lg'; ring?: boolean; className?: string }) {
  const src = personaAvatarUrl(persona);
  if (src) return <Avatar src={src} name={persona?.name || '鲸鲸'} size={size} ring={ring} className={className} />;
  const avatar = persona?.avatar?.trim();
  const emoji = avatar && avatar.length <= 4 ? avatar : '🐳';
  return (
    <span className={cn('cs-seal', size === 'lg' ? 'cs-seal--lg' : 'cs-seal--md', ring && 'is-ring', className)} aria-hidden>
      {emoji}
    </span>
  );
}
