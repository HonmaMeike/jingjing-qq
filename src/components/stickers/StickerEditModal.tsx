import { useEffect, useState } from 'react';
import { AlertTriangle, ImageOff, Sparkles } from 'lucide-react';
import type { StickerItem, StickerMood } from '@shared/types';
import { api } from '@/lib/api';
import { Badge, Button, Field, Input, Modal, Textarea, cn, useToast } from '@/components/ui';
import TagInput from '@/components/stickers/TagInput';
import { STICKER_MOOD_META, STICKER_MOOD_ORDER, STICKER_SOURCE_META, uniqueTags } from '@/components/stickers/meta';

interface Props {
  open: boolean;
  mode: 'upload' | 'edit';
  item?: StickerItem | null;
  dataUrl?: string | null;
  defaultName?: string;
  onClose: () => void;
  onSaved: (item: StickerItem) => void;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function StickerEditModal({ open, mode, item, dataUrl, defaultName, onClose, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [moods, setMoods] = useState<StickerMood[]>(['neutral']);
  const [favorite, setFavorite] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBroken(false);
    setError(null);
    if (mode === 'edit' && item) {
      setName(item.name);
      setDescription(item.description ?? '');
      setTags(item.tags ?? []);
      setMoods(item.moods?.length ? item.moods : ['neutral']);
      setFavorite(item.favorite);
    } else {
      setName(defaultName || '鲸鱼娘表情');
      setDescription('');
      setTags([]);
      setMoods(['neutral']);
      setFavorite(false);
    }
    // 只在打开 / 切换编辑对象时重置表单；stickers:update 刷新 overview 不应覆盖正在编辑的内容。
  }, [open, mode, item?.id, defaultName]);

  const source = mode === 'edit' && item ? STICKER_SOURCE_META[item.source] : null;
  const preview = mode === 'upload' ? dataUrl : item?.url;

  const toggleMood = (mood: StickerMood) => {
    setMoods((previous) => (previous.includes(mood) ? previous.filter((entry) => entry !== mood) : [...previous, mood]));
  };

  const save = async () => {
    if (saving) return;
    const finalName = name.trim() || '未命名表情';
    setSaving(true);
    setError(null);
    try {
      if (mode === 'upload') {
        if (!dataUrl) throw new Error('没有拿到图片数据，请重新选择文件');
        const saved = await api.stickers.save({ dataUrl, name: finalName, tags: uniqueTags(tags), moods, favorite });
        onSaved(saved);
        toast.success('表情已收进库', '「' + saved.name + '」现在可以被她挑中了。');
      } else if (item) {
        const updated = await api.stickers.update(item.id, { name: finalName, description: description.trim(), tags: uniqueTags(tags), moods });
        if (!updated) throw new Error('这张表情可能已经被删除');
        onSaved(updated);
        toast.success('表情信息已更新', '标签和心情会影响她自动挑选时的匹配。');
      }
      onClose();
    } catch (caught) {
      const message = errText(caught);
      setError(message);
      toast.error(mode === 'upload' ? '保存表情失败' : '更新表情失败', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={mode === 'upload' ? '把表情收进库里' : '编辑表情信息'}
      desc={mode === 'upload' ? '补一个名字、标签和心情，她之后就能按心情挑到它。' : '名字、标签和心情会影响她在聊天与说说里的自动挑选。'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>取消</Button>
          <Button variant="primary" icon={<Sparkles size={14} />} loading={saving} onClick={() => void save()}>{mode === 'upload' ? '保存表情' : '保存修改'}</Button>
        </>
      )}
    >
      <div className="stk-edit">
        <div className="stk-edit__preview">
          {preview && !broken ? (
            <img src={preview} alt={name || '表情预览'} onError={() => setBroken(true)} />
          ) : (
            <div className="stk-edit__fallback"><ImageOff size={24} /><span>预览没有加载出来</span></div>
          )}
          {source && <Badge tone={source.tone}>{source.label}</Badge>}
        </div>

        <div className="stk-edit__form">
          <Field label="名字">
            <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} placeholder="比如：晚安鲸鱼" />
          </Field>
          <Field label="描述（可选）">
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={160} placeholder="这张表情适合在什么时候发？" />
          </Field>
          <Field label="标签" hint="回车或逗号添加，最多 12 个。">
            <TagInput value={tags} onChange={setTags} placeholder="比如：晚安、白饭、撒娇" />
          </Field>
          <Field label="心情" hint="多选；她自动挑表情时会优先找心情匹配的。">
            <div className="stk-mood-grid">
              {STICKER_MOOD_ORDER.map((mood) => {
                const meta = STICKER_MOOD_META[mood];
                const active = moods.includes(mood);
                return (
                  <button
                    type="button"
                    key={mood}
                    className={cn('stk-mood-btn', active && 'is-active')}
                    style={{ color: active ? meta.color : undefined, borderColor: active ? 'color-mix(in srgb, ' + meta.color + ' 34%, transparent)' : undefined }}
                    onClick={() => toggleMood(mood)}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </Field>
          {mode === 'upload' && (
            <label className="stk-edit__favorite">
              <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />
              <span>保存后直接放进「最爱」</span>
            </label>
          )}
          {error && <div className="stk-edit__error"><AlertTriangle size={13} />{error}</div>}
        </div>
      </div>
    </Modal>
  );
}
