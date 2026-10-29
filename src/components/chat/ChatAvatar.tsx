import { useState } from 'react';
import { Users } from 'lucide-react';
import { cn } from '@/components/ui';
import { isMediaSource } from './chat-utils';

interface ChatAvatarProps {
  src?: string;
  glyph?: string;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  scene?: 'private' | 'group' | 'local';
  ring?: boolean;
  className?: string;
}

export function ChatAvatar({ src, glyph, name, size = 'md', scene, ring, className }: ChatAvatarProps) {
  const [broken, setBroken] = useState(false);
  const image = Boolean(src && !broken && isMediaSource(src));
  const first = name ? Array.from(name.trim())[0] : undefined;
  const text = glyph ?? (src && !isMediaSource(src) ? src : first || '鲸');
  return (
    <span
      className={cn('chat-avatar', size !== 'md' && 'chat-avatar--' + size, scene === 'group' && 'chat-avatar--group', ring && 'chat-avatar--ring', className)}
      title={name}
    >
      {image ? (
        <img src={src} alt={name ?? ''} onError={() => setBroken(true)} />
      ) : scene === 'group' ? (
        <Users size={size === 'xs' ? 12 : size === 'sm' ? 15 : 19} />
      ) : (
        <span className="chat-avatar__glyph">{text}</span>
      )}
    </span>
  );
}