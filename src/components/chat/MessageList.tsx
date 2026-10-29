import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, FileText, Film, MessageCircle, Mic, Music, Pause, Play, RotateCcw, Sparkles } from 'lucide-react';
import type { ChatAttachment, ChatMessage, Conversation, Persona } from '@shared/types';
import { Badge, Button, MarkdownView, Modal, cn, useToast } from '@/components/ui';
import { personaAvatarUrl } from '@/lib/persona';
import { formatDateTime, formatTime } from '@/lib/format';
import { ChatAvatar } from './ChatAvatar';
import {
  attachmentLabel,
  formatVoiceDuration,
  groupMessagesByDay,
  resolveAttachmentSrc,
} from './chat-utils';

interface MessageListProps {
  conversation: Conversation;
  persona?: Persona;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  typing: boolean;
  onRetry: () => void;
  onQuickSend?: (text: string) => void;
}

function SmartImage({ src, alt, className, onClick, onLoad }: { src: string; alt: string; className: string; onClick?: () => void; onLoad?: () => void }) {
  const [broken, setBroken] = useState(false);
  if (broken || !src) {
    return <span className="chat-attach__broken"><FileText size={16} />{alt || '图片不可用'}</span>;
  }
  return <img className={className} src={src} alt={alt} onClick={onClick} onLoad={onLoad} onError={() => setBroken(true)} />;
}

function ImageAttachment({ attachment, onPreview, onMediaLoad }: { attachment: ChatAttachment; onPreview: (src: string, name: string) => void; onMediaLoad: () => void }) {
  const src = resolveAttachmentSrc(attachment);
  const name = attachmentLabel(attachment);
  return (
    <button type="button" className="chat-attach__image-btn" onClick={() => src && onPreview(src, name)} title="点击放大">
      <SmartImage src={src} alt={name} className="chat-attach__img" onLoad={onMediaLoad} />
    </button>
  );
}

function StickerAttachment({ attachment, onMediaLoad }: { attachment: ChatAttachment; onMediaLoad: () => void }) {
  const src = resolveAttachmentSrc(attachment);
  return <SmartImage src={src} alt={attachmentLabel(attachment)} className="chat-attach__sticker" onLoad={onMediaLoad} />;
}

function VoiceAttachment({ attachment }: { attachment: ChatAttachment }) {
  const toast = useToast();
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audioRef.current?.pause(); }, []);
  const toggle = async () => {
    const src = resolveAttachmentSrc(attachment);
    if (!src) {
      toast.warning('语音文件不在这里', '这条消息只保留了时长记录，可以去数据目录找找原文件。');
      return;
    }
    try {
      if (playing) {
        audioRef.current?.pause();
        setPlaying(false);
        return;
      }
      if (!audioRef.current || audioRef.current.src !== src) {
        audioRef.current = new Audio(src);
        audioRef.current.onended = () => setPlaying(false);
      }
      audioRef.current.currentTime = 0;
      await audioRef.current.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      toast.error('播放失败', '音频文件无法访问或格式不受支持。');
    }
  };
  return (
    <div className={cn('chat-voice', playing && 'is-playing')}>
      <button type="button" className="chat-voice__btn" onClick={() => void toggle()} aria-label={playing ? '暂停语音' : '播放语音'}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <span className="chat-voice__wave" aria-hidden="true">
        {[9, 15, 21, 12, 18, 8, 23, 14, 10, 19, 7, 16].map((height, index) => (
          <i key={index} style={{ height }} />
        ))}
      </span>
      <span className="chat-voice__meta">
        <Mic size={11} />
        {attachment.durationMs ? formatVoiceDuration(attachment.durationMs) : '语音'}
      </span>
    </div>
  );
}

function FileAttachment({ attachment }: { attachment: ChatAttachment }) {
  const icon = attachment.kind === 'video' ? <Film size={14} /> : attachment.kind === 'music' ? <Music size={14} /> : <FileText size={14} />;
  const src = resolveAttachmentSrc(attachment);
  if (attachment.kind === 'video' && src) {
    return <video className="chat-attach__video" src={src} controls playsInline />;
  }
  if (attachment.kind === 'music' && src) {
    return <audio className="chat-attach__audio" src={src} controls preload="metadata" />;
  }
  return (
    <div className="chat-attach__file">
      <span className="chat-attach__file-icon">{icon}</span>
      <span className="chat-attach__file-text">
        <span className="chat-attach__file-name">{attachmentLabel(attachment)}</span>
        <span className="chat-attach__file-kind">{attachment.kind === 'video' ? '视频' : attachment.kind === 'music' ? '音乐' : attachment.kind === 'file' ? '文件' : '附件'}</span>
      </span>
    </div>
  );
}

function Attachments({ attachments, onPreview, onMediaLoad }: { attachments: ChatAttachment[]; onPreview: (src: string, name: string) => void; onMediaLoad: () => void }) {
  return (
    <div className="chat-attach-list">
      {attachments.map((attachment, index) => {
        if (attachment.kind === 'image') return <ImageAttachment key={index} attachment={attachment} onPreview={onPreview} onMediaLoad={onMediaLoad} />;
        if (attachment.kind === 'sticker') return <StickerAttachment key={index} attachment={attachment} onMediaLoad={onMediaLoad} />;
        if (attachment.kind === 'voice') return <VoiceAttachment key={index} attachment={attachment} />;
        return <FileAttachment key={index} attachment={attachment} />;
      })}
    </div>
  );
}

function MessageRow({ message, conversation, persona, onPreview, onMediaLoad }: { message: ChatMessage; conversation: Conversation; persona?: Persona; onPreview: (src: string, name: string) => void; onMediaLoad: () => void }) {
  if (message.role === 'system') {
    return <div className="chat-system"><span>{message.text}</span></div>;
  }
  const isUser = message.role === 'user';
  const showSender = conversation.scene === 'group';
  const attachments = message.attachments ?? [];
  const mediaOnly = !message.text.trim() && attachments.length === 1 && (attachments[0].kind === 'sticker' || attachments[0].kind === 'image');
  const assistantName = message.senderName || persona?.name || '鲸鲸';
  const userGlyph = message.senderName && message.senderName !== '我' ? message.senderName.trim().slice(0, 1) : '我';
  const avatarSrc = isUser ? message.avatar : message.avatar || personaAvatarUrl(persona);
  const avatarGlyph = isUser ? userGlyph : persona?.avatar;
  const meta = message.meta;

  return (
    <div className={cn('chat-msg', isUser ? 'chat-msg--user' : 'chat-msg--bot')}>
      <ChatAvatar src={avatarSrc} glyph={avatarGlyph} name={isUser ? '我' : assistantName} size="sm" className="chat-msg__avatar" />
      <div className="chat-msg__content">
        {showSender && (
          <div className="chat-msg__sender">
            <span>{isUser ? (message.senderName || '我') : assistantName}</span>
            {!isUser && <Badge tone="brand">{persona?.name || '人设'}</Badge>}
            {message.scene === 'group' && !isUser && <span className="chat-msg__source">群聊</span>}
          </div>
        )}
        {meta?.reasoning && (
          <details className="chat-reasoning">
            <summary>看看鲸鲸刚才在想什么</summary>
            <div>{meta.reasoning}</div>
          </details>
        )}
        <div className={cn('chat-bubble', isUser ? 'chat-bubble--user' : 'chat-bubble--bot', mediaOnly && 'chat-bubble--media')}>
          {message.text.trim().length > 0 && (
            isUser ? <div className="chat-text">{message.text}</div> : <MarkdownView text={message.text} className="chat-markdown" />
          )}
          {attachments.length > 0 && <Attachments attachments={attachments} onPreview={onPreview} onMediaLoad={onMediaLoad} />}
        </div>
        <div className="chat-msg__meta">
          <span>{formatTime(message.createdAt)}</span>
          {!isUser && meta?.mood && <span className="chat-meta-chip">心情 · {meta.mood}</span>}
          {!isUser && meta?.model && <span className="chat-meta-chip chat-meta-chip--mono">{meta.model}</span>}
          {!isUser && typeof meta?.tokens === 'number' && meta.tokens > 0 && <span className="chat-meta-chip">{meta.tokens} tokens</span>}
          {!isUser && meta?.compressed && <span className="chat-meta-chip">上下文已压缩</span>}
          {!isUser && meta?.memoryFacts && meta.memoryFacts.length > 0 && (
            <span className="chat-meta-chip chat-meta-chip--brand" title={meta.memoryFacts.join('；')}>
              <Sparkles size={10} /> 记忆 {meta.memoryFacts.length}
            </span>
          )}
          {meta?.source === 'qq' && <span className="chat-meta-chip">来自 QQ</span>}
          {meta?.source === 'autonomy' && <span className="chat-meta-chip">主动消息</span>}
        </div>
        {meta?.error && <div className="chat-msg__error"><AlertTriangle size={12} />{meta.error}</div>}
      </div>
    </div>
  );
}

function TypingIndicator({ conversation, persona }: { conversation: Conversation; persona?: Persona }) {
  return (
    <div className="chat-msg chat-msg--bot chat-typing">
      <ChatAvatar src={personaAvatarUrl(persona)} glyph={persona?.avatar} name={persona?.name} size="sm" className="chat-msg__avatar" />
      <div className="chat-typing__content">
        {conversation.scene === 'group' && <div className="chat-msg__sender">{persona?.name || '鲸鲸'}</div>}
        <div className="chat-typing__bubble">
          <span className="chat-typing__dot" />
          <span className="chat-typing__dot" />
          <span className="chat-typing__dot" />
          <span className="chat-typing__label">{persona?.name || '鲸鲸'} 正在输入</span>
        </div>
      </div>
    </div>
  );
}

function ThreadIntro({ conversation, persona, messages }: { conversation: Conversation; persona?: Persona; messages: ChatMessage[] }) {
  const first = messages[0];
  return (
    <div className="chat-thread-intro">
      <ChatAvatar src={personaAvatarUrl(persona)} glyph={persona?.avatar} name={persona?.name} size="md" />
      <div className="chat-thread-intro__body">
        <div className="chat-thread-intro__title">
          {conversation.scene === 'group' ? conversation.groupName || conversation.peerName : persona?.name || '鲸鲸'}
          <Badge tone="brand">{conversation.scene === 'group' ? '群聊' : '私聊'}</Badge>
          {conversation.isDemo && <Badge tone="warning" dot>演示会话</Badge>}
        </div>
        <div className="chat-thread-intro__desc">
          {first ? '对话开始于 ' + formatDateTime(first.createdAt) + '，共 ' + conversation.messageCount + ' 条消息' : '还没有消息，先打个招呼吧'}
        </div>
      </div>
    </div>
  );
}

export function MessageList({ conversation, persona, messages, loading, error, typing, onRetry, onQuickSend }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [mediaTick, setMediaTick] = useState(0);
  const [lightbox, setLightbox] = useState<{ src: string; name: string } | null>(null);
  const groups = useMemo(() => groupMessagesByDay(messages), [messages]);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: 'auto' });
    lastScrollTopRef.current = element.scrollTop;
    setShowJump(false);
  }, []);

  useLayoutEffect(() => {
    stickRef.current = true;
    setShowJump(false);
  }, [conversation.id]);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current) scrollToBottom();
      else setShowJump(true);
    });
    observer.observe(inner);
    return () => observer.disconnect();
  }, [conversation.id, loading, Boolean(error), messages.length, scrollToBottom]);

  useEffect(() => {
    if (mediaTick === 0) return;
    if (stickRef.current) scrollToBottom();
    else setShowJump(true);
    const timer = window.setTimeout(() => { if (stickRef.current) scrollToBottom(); }, 160);
    return () => window.clearTimeout(timer);
  }, [mediaTick, scrollToBottom]);

  useEffect(() => {
    if (loading || error) return;
    if (!messages.some((message) => (message.attachments?.length ?? 0) > 0)) return;
    if (!stickRef.current) return;
    const timer = window.setTimeout(() => { if (stickRef.current) scrollToBottom(); }, 320);
    return () => window.clearTimeout(timer);
  }, [messages, loading, error, scrollToBottom]);

  useLayoutEffect(() => {
    if (loading) return;
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') stickRef.current = true;
    if (stickRef.current) scrollToBottom();
    else setShowJump(true);
  }, [messages, typing, loading, scrollToBottom]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const previousTop = lastScrollTopRef.current;
    lastScrollTopRef.current = element.scrollTop;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    // 图片/媒体加载会让内容变高并触发一次同位置的 scroll 事件，这不算用户向上滚动
    if (element.scrollTop === previousTop) {
      if (distance < 90) stickRef.current = true;
      return;
    }
    stickRef.current = distance < 90;
    setShowJump(distance > 260);
  };

  const openPreview = (src: string, name: string) => setLightbox({ src, name });

  if (loading) {
    return (
      <div className="chat-main__body">
        <div className="chat-messages">
          <div className="chat-messages__inner">
            <div className="chat-thread-skeleton">
              <span className="skeleton" style={{ width: 160, height: 14 }} />
              <span className="skeleton" style={{ width: 260, height: 10 }} />
            </div>
            {[0, 1, 2, 3].map((item) => (
              <div className={cn('chat-skeleton-msg', item % 2 === 1 && 'chat-skeleton-msg--user')} key={item}>
                <span className="skeleton chat-skeleton-msg__avatar" />
                <div className="chat-skeleton-msg__lines">
                  <span className="skeleton" style={{ width: 64, height: 9 }} />
                  <span className="skeleton" style={{ width: item % 2 === 1 ? 190 : 260, height: 38 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-main__body">
        <div className="chat-messages">
          <div className="chat-messages__inner">
            <div className="chat-error">
              <span className="chat-error__icon"><AlertTriangle size={20} /></span>
              <div className="chat-error__title">消息加载失败</div>
              <div className="chat-error__desc">{error}</div>
              <Button variant="secondary" size="sm" icon={<RotateCcw size={14} />} onClick={onRetry}>重新加载</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="chat-main__body">
        <div className="chat-messages">
          <div className="chat-messages__inner chat-messages__inner--empty">
            <div className="chat-greeting-card">
              <ChatAvatar src={personaAvatarUrl(persona)} glyph={persona?.avatar} name={persona?.name} size="lg" ring />
              <div className="chat-greeting-card__name">{persona?.name || '鲸鲸'}</div>
              <div className="chat-greeting-card__title">{persona?.title || '你的深海伙伴'}</div>
              <div className="chat-greeting-card__greeting">{persona?.greeting || '（从屏幕角落冒出一个蓝色的小脑袋）鲸鲸在呢～想聊点什么？'}</div>
              <div className="chat-greeting-card__actions">
                {onQuickSend && <Button variant="primary" icon={<MessageCircle size={14} />} onClick={() => onQuickSend('在吗？')}>打个招呼</Button>}
                <Badge tone="brand"><Sparkles size={11} /> 记忆会从第一句话开始</Badge>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-main__body">
      <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
        <div className="chat-messages__inner" ref={innerRef}>
          <ThreadIntro conversation={conversation} persona={persona} messages={messages} />
          {groups.map((group) => (
            <Fragment key={group.key}>
              <div className="chat-day"><span>{group.label}</span></div>
              {group.items.map((message) => (
                <MessageRow key={message.id} message={message} conversation={conversation} persona={persona} onPreview={openPreview} onMediaLoad={() => setMediaTick((value) => value + 1)} />
              ))}
            </Fragment>
          ))}
          {typing && <TypingIndicator conversation={conversation} persona={persona} />}
        </div>
      </div>
      {showJump && (
        <button type="button" className="chat-jump" onClick={scrollToBottom}>
          回到底部 <ChevronDown size={13} />
        </button>
      )}
      <Modal open={Boolean(lightbox)} onClose={() => setLightbox(null)} title={lightbox?.name || '图片预览'} desc="点击背景关闭">
        {lightbox && <img className="chat-lightbox__img" src={lightbox.src} alt={lightbox.name} />}
      </Modal>
    </div>
  );
}