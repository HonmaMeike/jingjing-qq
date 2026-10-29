import { useState } from 'react';
import type { CSSProperties, MouseEvent } from 'react';
import { Eye, EyeOff, Heart, ImageOff, Pencil, Trash2 } from 'lucide-react';
import type { StickerItem } from '@shared/types';
import { normalizeAssetUrl } from '@/lib/assets';
import { IconButton, cn } from '@/components/ui';
import { STICKER_MOOD_META, STICKER_SOURCE_META } from '@/components/stickers/meta';

interface Props {
  item: StickerItem;
  busy?: boolean;
  onPreview: (item: StickerItem) => void;
  onFavorite: (item: StickerItem) => void;
  onToggleEnabled: (item: StickerItem) => void;
  onEdit: (item: StickerItem) => void;
  onDelete: (item: StickerItem) => void;
}

export default function StickerCard({ item, busy, onPreview, onFavorite, onToggleEnabled, onEdit, onDelete }: Props) {
  const [broken, setBroken] = useState(false);
  const source = STICKER_SOURCE_META[item.source] ?? STICKER_SOURCE_META.builtin;
  const SourceIcon = source.icon;
  const moods = (item.moods ?? []).slice(0, 3).map((mood) => STICKER_MOOD_META[mood]).filter(Boolean);

  const stop = (event: MouseEvent) => { event.stopPropagation(); };

  return (
    <div
      className={cn('stk-card', !item.enabled && 'is-disabled', item.favorite && 'is-favorite')}
      role="button"
      tabIndex={0}
      aria-label={'预览表情包 ' + item.name}
      onClick={() => onPreview(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPreview(item);
        }
      }}
      style={{ ['--src-c' as string]: source.color } as CSSProperties}
    >
      <div className="stk-card__media">
        {broken || !item.url ? (
          <div className="stk-card__fallback"><ImageOff size={24} /><span>图片没游出来</span></div>
        ) : (
          <img src={normalizeAssetUrl(item.url)} alt={item.name} loading="lazy" draggable={false} onError={() => setBroken(true)} />
        )}
        <span className="stk-card__source" style={{ color: source.color, borderColor: 'color-mix(in srgb, ' + source.color + ' 28%, transparent)', background: 'color-mix(in srgb, ' + source.color + ' 10%, transparent)' }}>
          <SourceIcon size={10} />{source.label}
        </span>
        {item.favorite && <span className="stk-card__fav-mark" aria-label="已收藏"><Heart size={12} fill="currentColor" /></span>}
        {!item.enabled && <span className="stk-card__off">已停用</span>}
        {item.whale && <span className="stk-card__whale" title="鲸鱼娘">🐋</span>}

        <div className="stk-card__hover" onClick={stop}>
          <IconButton
            label={item.favorite ? '取消收藏' : '收藏'}
            className={cn('stk-card__action', item.favorite && 'is-favorite')}
            disabled={busy}
            onClick={(event) => { event.stopPropagation(); onFavorite(item); }}
          >
            <Heart size={15} fill={item.favorite ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton
            label={item.enabled ? '停用这张' : '启用这张'}
            className="stk-card__action"
            disabled={busy}
            onClick={(event) => { event.stopPropagation(); onToggleEnabled(item); }}
          >
            {item.enabled ? <EyeOff size={15} /> : <Eye size={15} />}
          </IconButton>
          <IconButton
            label="编辑标签"
            className="stk-card__action"
            disabled={busy}
            onClick={(event) => { event.stopPropagation(); onEdit(item); }}
          >
            <Pencil size={14} />
          </IconButton>
          {item.source !== 'builtin' && (
            <IconButton
              label="删除这张"
              className="stk-card__action is-danger"
              disabled={busy}
              onClick={(event) => { event.stopPropagation(); onDelete(item); }}
            >
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      </div>

      <div className="stk-card__body">
        <div className="stk-card__title-row">
          <span className="stk-card__name" title={item.name}>{item.name}</span>
          <span className="stk-card__count" title={'被用过 ' + item.useCount + ' 次'}>×{item.useCount}</span>
        </div>
        <div className="stk-card__meta">
          {moods.map((mood) => (
            <span className="stk-mood-dot" key={mood.label} style={{ color: mood.color, background: 'color-mix(in srgb, ' + mood.color + ' 12%, transparent)' }}>{mood.label}</span>
          ))}
          {moods.length === 0 && <span className="stk-card__meta-empty">未标注心情</span>}
        </div>
        {item.tags.length > 0 && (
          <div className="stk-card__tags">
            {item.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}
            {item.tags.length > 3 && <span className="stk-card__tags-more">+{item.tags.length - 3}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
