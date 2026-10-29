import { useState } from 'react';
import { normalizeAssetUrl } from '@/lib/assets';
import { ImageOff } from 'lucide-react';
import { cn } from '@/components/ui';

export default function MediaImage({ src, alt, className }: { src?: string; alt?: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const resolved = normalizeAssetUrl(src);
  if (!resolved || broken) {
    return (
      <div className={cn('gro-media-fallback', className)}>
        <ImageOff size={17} />
      </div>
    );
  }
  return <img className={className} src={resolved} alt={alt ?? ''} loading="lazy" onError={() => setBroken(true)} />;
}
