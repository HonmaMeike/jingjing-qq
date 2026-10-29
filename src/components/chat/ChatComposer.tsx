import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AtSign, ImagePlus, Loader2, Send, Smile, Sticker, X } from 'lucide-react';
import type { ChatAttachment, Conversation, Persona, PetAsset } from '@shared/types';
import { IconButton, cn, useToast } from '@/components/ui';
import { assetUrl } from '@/lib/assets';

const EMOJI_GROUPS: { label: string; items: string[] }[] = [
  { label: '鲸语', items: ['🐳', '🫧', '🍚', '🌊', '🐋', '🐟', '🍙', '🫐', '🪸', '🌙'] },
  { label: '心情', items: ['😊', '🥺', '😳', '😤', '😴', '🤔', '😭', '😆', '🥰', '😇'] },
  { label: '动作', items: ['👍', '🙌', '🫶', '✨', '💫', '🌧️', '☀️', '🎧', '🍜', '🧋'] },
];

interface ChatComposerProps {
  conversation: Conversation;
  persona?: Persona;
  petAssets: PetAsset[];
  sending: boolean;
  readOnly?: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: (text: string, attachments?: ChatAttachment[]) => Promise<boolean>;
}

export function ChatComposer({ conversation, persona, petAssets, sending, readOnly = false, draft, onDraftChange, onSend }: ChatComposerProps) {
  const toast = useToast();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [picker, setPicker] = useState<'emoji' | 'meme' | null>(null);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = '0px';
    element.style.height = Math.min(element.scrollHeight, 148) + 'px';
  }, [draft]);

  useEffect(() => {
    if (!picker) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setPicker(null);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPicker(null);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [picker]);

  const insertText = (text: string) => {
    const element = textareaRef.current;
    if (!element) {
      onDraftChange(draft + text);
      return;
    }
    const start = element.selectionStart ?? draft.length;
    const end = element.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    onDraftChange(next);
    window.requestAnimationFrame(() => {
      element.focus();
      const position = start + text.length;
      element.setSelectionRange(position, position);
    });
  };

  const submit = async () => {
    if (sending || readOnly) return;
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    const ok = await onSend(text, attachments.length > 0 ? attachments : undefined);
    if (ok) {
      onDraftChange('');
      setAttachments([]);
      setPicker(null);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      setPicker(null);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      void submit();
    }
  };

  const readFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = Array.from(files);
    if (attachments.length + selected.length > 4) {
      toast.warning('最多 4 张图片', '先删掉几张再添加吧。');
      return;
    }
    const results = await Promise.all(selected.map((file) => new Promise<ChatAttachment | null>((resolve) => {
      if (!file.type.startsWith('image/')) {
        toast.warning('只支持图片附件', file.name + ' 不是图片文件。');
        resolve(null);
        return;
      }
      if (file.size > 6 * 1024 * 1024) {
        toast.warning('图片太大了', file.name + ' 超过 6MB，压缩后再试试。');
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ kind: 'image', url: String(reader.result), name: file.name });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    })));
    const next = results.filter((item): item is ChatAttachment => item !== null);
    if (next.length > 0) setAttachments((previous) => [...previous, ...next]);
  };

  const sendSticker = async (asset: PetAsset) => {
    const url = assetUrl(asset.gif || asset.webm);
    if (!url) return;
    const ok = await onSend('', [{ kind: 'sticker', url, name: asset.name }]);
    if (ok) setPicker(null);
  };

  const memes = petAssets.filter((asset) => (asset.category === 'meme' || asset.category === 'gif') && (asset.gif || asset.webm)).slice(0, 60);
  const canSend = !readOnly && !sending && (draft.trim().length > 0 || attachments.length > 0);

  return (
    <div className="chat-composer" ref={rootRef}>
      {picker && (
        <div className="chat-picker">
          <div className="chat-picker__head">
            <div className="chat-picker__tabs">
              <button type="button" className={cn('chat-picker__tab', picker === 'emoji' && 'is-active')} onClick={() => setPicker('emoji')}>表情</button>
              <button type="button" className={cn('chat-picker__tab', picker === 'meme' && 'is-active')} onClick={() => setPicker('meme')}>梗图</button>
            </div>
            <IconButton label="关闭表情面板" onClick={() => setPicker(null)}><X size={14} /></IconButton>
          </div>
          <div className="chat-picker__body">
            {picker === 'emoji' ? (
              EMOJI_GROUPS.map((group) => (
                <div className="chat-picker__group" key={group.label}>
                  <div className="chat-picker__label">{group.label}</div>
                  <div className="chat-emoji-grid">
                    {group.items.map((emoji) => (
                      <button type="button" key={emoji} className="chat-emoji" onClick={() => insertText(emoji)} aria-label={'插入表情 ' + emoji}>{emoji}</button>
                    ))}
                  </div>
                </div>
              ))
            ) : memes.length > 0 ? (
              <div className="chat-meme-grid">
                {memes.map((asset) => (
                  <button type="button" key={asset.name} className="chat-meme" onClick={() => void sendSticker(asset)} title={asset.description || asset.name}>
                    {asset.gif ? <img src={assetUrl(asset.gif)} alt={asset.name} /> : <video src={assetUrl(asset.webm)} muted loop autoPlay playsInline />}
                    <span>{asset.description || asset.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="chat-picker__empty">
                <Sticker size={18} />
                <div>还没有梗图素材</div>
                <span>把 gif 或 meme 放进素材目录，就会出现在这里。</span>
              </div>
            )}
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="chat-attach-chips">
          {attachments.map((attachment, index) => (
            <div className="chat-attach-chip" key={index}>
              {attachment.kind === 'image' && attachment.url ? <img src={attachment.url} alt={attachment.name} /> : <ImagePlus size={14} />}
              <span className="chat-attach-chip__name">{attachment.name || '图片'}</span>
              <button type="button" className="chat-attach-chip__remove" onClick={() => setAttachments((previous) => previous.filter((_, item) => item !== index))} aria-label="移除附件">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={cn('chat-compose', sending && 'is-sending')}>
        <div className="chat-compose__top">
          <textarea
            ref={textareaRef}
            className="chat-compose__input"
            value={draft}
            rows={1}
            disabled={readOnly}
            placeholder={readOnly ? 'QQ 会话只读，请在 QQ 中回复' : conversation.scene === 'group' ? '在群里说点什么…（@ 一下鲸鲸也会回应）' : '和' + (persona?.name || '鲸鲸') + '说点什么…'}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="消息输入框"
          />
          <button type="button" className="chat-send" onClick={() => void submit()} disabled={!canSend} aria-label="发送消息">
            {sending ? <Loader2 size={17} className="spin" /> : <Send size={17} />}
          </button>
        </div>
        <div className="chat-compose__bar">
          <IconButton label="添加图片" onClick={() => fileRef.current?.click()}><ImagePlus size={17} /></IconButton>
          <IconButton label="表情" active={picker === 'emoji'} onClick={() => setPicker(picker === 'emoji' ? null : 'emoji')}><Smile size={17} /></IconButton>
          <IconButton label="梗图" active={picker === 'meme'} onClick={() => setPicker(picker === 'meme' ? null : 'meme')}><Sticker size={17} /></IconButton>
          {conversation.scene === 'group' && <IconButton label="插入 @" onClick={() => insertText('@')}><AtSign size={16} /></IconButton>}
          <span className="spacer" />
          <span className="chat-compose__hint"><span className="kbd">Enter</span> 发送 · <span className="kbd">Shift</span> + <span className="kbd">Enter</span> 换行</span>
        </div>
      </div>
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(event) => { void readFiles(event.target.files); event.target.value = ''; }} />
    </div>
  );
}
