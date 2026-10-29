import { useState } from 'react';
import { Eye, EyeOff, Heart, ImageOff, Pencil, Trash2 } from 'lucide-react';
import type { StickerItem } from '@shared/types';
import { normalizeAssetUrl } from '@/lib/assets';
import { Badge, Button, Modal } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import { STICKER_MOOD_META, STICKER_SOURCE_META } from '@/components/stickers/meta';

interface Props {
  item: StickerItem | null;
  busy?: boolean;
  onClose: () => void;
  onFavorite: (item: StickerItem) => void;
  onToggleEnabled: (item: StickerItem) => void;
  onEdit: (item: StickerItem) => void;
  onDelete: (item: StickerItem) => void;
}

function PreviewBody({ item, busy, onClose, onFavorite, onToggleEnabled, onEdit, onDelete }: Props & { item: StickerItem }) {
  const [broken, setBroken] = useState(false);
  const source = STICKER_SOURCE_META[item.source] ?? STICKER_SOURCE_META.builtin;

  return (
    <div className="stk-preview">
      <div className="stk-preview__stage">
        {broken || !item.url ? (
          <div className="stk-preview__fallback"><ImageOff size={30} /><span>图片暂时没有加载出来</span></div>
        ) : (
          <img src={normalizeAssetUrl(item.url)} alt={item.name} onError={() => setBroken(true)} />
        )}
        <div className="stk-preview__badges">
          <Badge tone={source.tone}>{source.label}</Badge>
          {item.whale && <Badge tone="brand">🐋 鲸鱼娘</Badge>}
          {!item.enabled && <Badge tone="warning">已停用</Badge>}
        </div>
      </div>

      <div className="stk-preview__info">
        <div className="stk-preview__title-row">
          <h3>{item.name}</h3>
          {item.favorite && <Heart size={15} fill="currentColor" className="stk-preview__heart" />}
        </div>
        {item.description ? <p className="stk-preview__desc">{item.description}</p> : <p className="stk-preview__desc is-empty">她还没有给这张表情写说明。</p>}

        {item.moods.length > 0 && (
          <div className="stk-preview__section">
            <div className="stk-preview__label">适用心情</div>
            <div className="stk-preview__chips">
              {item.moods.map((mood) => {
                const meta = STICKER_MOOD_META[mood];
                return <span key={mood} className="stk-chip" style={{ color: meta.color, borderColor: 'color-mix(in srgb, ' + meta.color + ' 26%, transparent)' }}>{meta.label}</span>;
              })}
            </div>
          </div>
        )}

        {item.tags.length > 0 && (
          <div className="stk-preview__section">
            <div className="stk-preview__label">标签</div>
            <div className="stk-preview__chips">
              {item.tags.map((tag) => <span key={tag} className="stk-chip">#{tag}</span>)}
            </div>
          </div>
        )}

        <div className="stk-preview__meta">
          <div><span>被用过</span><b>{item.useCount} 次</b></div>
          <div><span>上次使用</span><b>{item.lastUsedAt ? relativeTime(item.lastUsedAt) : '还没用过'}</b></div>
          <div><span>收藏时间</span><b>{formatDateTime(item.createdAt)}</b></div>
          {item.width && item.height && <div><span>尺寸</span><b>{item.width} × {item.height}</b></div>}
        </div>

        <div className="stk-preview__actions">
          <Button variant={item.favorite ? 'success' : 'secondary'} size="sm" icon={<Heart size={13} fill={item.favorite ? 'currentColor' : 'none'} />} disabled={busy} onClick={() => onFavorite(item)}>
            {item.favorite ? '取消收藏' : '放进最爱'}
          </Button>
          <Button variant="ghost" size="sm" icon={item.enabled ? <EyeOff size={13} /> : <Eye size={13} />} disabled={busy} onClick={() => onToggleEnabled(item)}>
            {item.enabled ? '停用' : '启用'}
          </Button>
          <Button variant="ghost" size="sm" icon={<Pencil size={13} />} disabled={busy} onClick={() => { onClose(); onEdit(item); }}>编辑</Button>
          {item.source !== 'builtin' && (
            <Button variant="danger" size="sm" icon={<Trash2 size={13} />} disabled={busy} onClick={() => onDelete(item)}>删除</Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function StickerPreviewModal(props: Props) {
  return (
    <Modal open={Boolean(props.item)} onClose={props.onClose} wide title="表情预览" desc="她会在聊天或说说里按心情和标签自己挑一张。">
      {props.item ? <PreviewBody key={props.item.id} {...props} item={props.item} /> : null}
    </Modal>
  );
}
