import { useEffect, useState } from 'react';
import { Save, Settings2, Sparkles, Wand2 } from 'lucide-react';
import type { StickerSettings } from '@shared/types';
import { api } from '@/lib/api';
import { Badge, Button, Card, CardBody, CardHead, Toggle, cn, useToast } from '@/components/ui';

interface Props {
  settings: StickerSettings;
  onSaved?: (settings: StickerSettings) => void;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function StickerSettingsBar({ settings, onSaved }: Props) {
  const toast = useToast();
  const [draft, setDraft] = useState<StickerSettings>(settings);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(settings);
  }, [settings, dirty]);

  const patch = (value: Partial<StickerSettings>) => {
    setDraft((previous) => ({ ...previous, ...value }));
    setDirty(true);
  };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const next = await api.stickers.settings(draft);
      setDraft(next);
      setDirty(false);
      onSaved?.(next);
      toast.success('表情包设置已保存', '她会按这个节奏在聊天和说说里挑表情。');
    } catch (error) {
      toast.error('保存设置失败', errText(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="stk-settings">
      <CardHead
        title={<><span className="stk-settings__icon"><Settings2 size={14} /></span>她怎么用表情包</>}
        desc="自主收集、聊天自动发表情、说说自动配图，都在这里掌握节奏。"
        extra={(
          <>
            <Badge tone={dirty ? 'warning' : 'success'}>{dirty ? '有未保存修改' : '已同步'}</Badge>
            <Button variant="primary" size="sm" icon={<Save size={13} />} loading={saving} disabled={!dirty} onClick={() => void save()}>保存设置</Button>
          </>
        )}
      />
      <CardBody>
        <div className="stk-settings__grid">
          <div className="stk-settings__item">
            <div className="stk-settings__item-head"><span className="stk-settings__item-icon is-brand"><Sparkles size={14} /></span><div><b>自主收集</b><span>她偶尔会自己画一张或收一张鲸鱼娘表情</span></div></div>
            <div className="stk-settings__row">
              <span>允许自主收集</span>
              <Toggle checked={draft.autoCollect} onChange={(value) => patch({ autoCollect: value })} label="允许自主收集" />
            </div>
            <div className="stk-settings__row">
              <span>每日最多</span>
              <div className="stk-settings__seg">
                {[1, 2, 3].map((value) => (
                  <button type="button" key={value} className={cn('stk-seg-btn', draft.autoCollectPerDay === value && 'is-active')} onClick={() => patch({ autoCollectPerDay: value })}>{value} 张</button>
                ))}
              </div>
            </div>
            <div className="stk-settings__hint">没有 MiniMax Key 时会自动改为从内置素材里挑，不会乱画。</div>
          </div>

          <div className="stk-settings__item">
            <div className="stk-settings__item-head"><span className="stk-settings__item-icon is-mint"><Wand2 size={14} /></span><div><b>聊天自动发</b><span>聊天时她可以自己挑一张发给你</span></div></div>
            <div className="stk-settings__row">
              <span>允许聊天里发表情</span>
              <Toggle checked={draft.autoSendInChat} onChange={(value) => patch({ autoSendInChat: value })} label="聊天自动发" />
            </div>
            <div className="stk-settings__range">
              <div className="stk-settings__range-head"><span>每次回复的概率</span><b>{Math.round(draft.autoSendChance * 100)}%</b></div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(draft.autoSendChance * 100)}
                disabled={!draft.autoSendInChat}
                onChange={(event) => patch({ autoSendChance: Number(event.target.value) / 100 })}
                aria-label="聊天自动发表情概率"
              />
            </div>
            <div className="stk-settings__hint">概率越高越常发表情；她只会挑已启用、和当下心情匹配的那几张。</div>
          </div>

          <div className="stk-settings__item">
            <div className="stk-settings__item-head"><span className="stk-settings__item-icon is-pink"><Sparkles size={14} /></span><div><b>说说自动配图</b><span>发 QQ 空间时她可以自己配一张表情</span></div></div>
            <div className="stk-settings__row">
              <span>允许空间配表情</span>
              <Toggle checked={draft.autoAttachInQzone} onChange={(value) => patch({ autoAttachInQzone: value })} label="说说自动配图" />
            </div>
            <div className="stk-settings__range">
              <div className="stk-settings__range-head"><span>配图的概率</span><b>{Math.round(draft.qzoneChance * 100)}%</b></div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(draft.qzoneChance * 100)}
                disabled={!draft.autoAttachInQzone}
                onChange={(event) => patch({ qzoneChance: Number(event.target.value) / 100 })}
                aria-label="说说自动配表情概率"
              />
            </div>
            <div className="stk-settings__hint">配图会从库里挑心情最接近的一张，不会每次都用同一张。</div>
          </div>
        </div>
        <div className="stk-settings__foot">
          <Wand2 size={13} />
          <span>自动挑选只作用于「已启用」的表情；停用的表情仍会留在库里，但聊天和说说不会用它们。</span>
        </div>
      </CardBody>
    </Card>
  );
}
