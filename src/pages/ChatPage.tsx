import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Eraser, MessagesSquare, PanelRightOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { ChatAttachment, ChatContextInfo, ChatMessage, Conversation, MemorySummary } from '@shared/types';
import { api, events } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import { Badge, Button, IconButton, Modal, useToast } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { ChatAvatar } from '@/components/chat/ChatAvatar';
import { ConversationList } from '@/components/chat/ConversationList';
import { MessageList } from '@/components/chat/MessageList';
import { ChatComposer } from '@/components/chat/ChatComposer';
import { InsightPanel } from '@/components/chat/InsightPanel';
import { NewConversationModal } from '@/components/chat/NewConversationModal';
import { conversationTitle } from '@/components/chat/chat-utils';
import '@/styles/chat.css';

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export default function ChatPage() {
  const app = useApp();
  const toast = useToast();
  const {
    conversations, personas, activePersona, petAssets, overview,
    refreshConversations, patchConversation, addConversation, setConversations, settings,
  } = app;

  const narrow = useMediaQuery('(max-width: 1100px)');
  const compact = useMediaQuery('(max-width: 860px)');

  const [selectedId, setSelectedId] = useState<string | null>(() => conversations[0]?.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [contextInfo, setContextInfo] = useState<ChatContextInfo | null>(null);
  const [memory, setMemory] = useState<MemorySummary | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [switchingPersona, setSwitchingPersona] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [insightCollapsed, setInsightCollapsed] = useState(false);
  const [insightOverlay, setInsightOverlay] = useState(false);
  const [mobilePane, setMobilePane] = useState<'list' | 'chat'>('list');

  const loadSeqRef = useRef(0);
  const selectedIdRef = useRef<string | null>(selectedId);
  const conversation = useMemo(() => conversations.find((item) => item.id === selectedId) ?? null, [conversations, selectedId]);
  const readOnlyChat = Boolean(conversation && !conversation.isDemo && !settings.napcat.allowDesktopSendToQq);
  const persona = useMemo(() => {
    if (!conversation) return activePersona;
    return personas.find((item) => item.id === conversation.personaId) ?? activePersona;
  }, [conversation, personas, activePersona]);

  const loadMessages = useCallback(async (id: string) => {
    const seq = ++loadSeqRef.current;
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const list = await api.chat.messages(id, 200);
      if (seq !== loadSeqRef.current) return;
      setMessages(list);
      setConversations((prev) => prev.map((item) => item.id === id ? { ...item, unread: 0 } : item));
    } catch (cause) {
      if (seq !== loadSeqRef.current) return;
      setMessagesError(errorMessage(cause));
    } finally {
      if (seq === loadSeqRef.current) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations().catch(() => undefined);
  }, [refreshConversations]);

  const loadMemory = useCallback(async () => {
    setMemoryLoading(true);
    setMemoryError(null);
    try {
      const summary = await api.memory.summary();
      setMemory(summary);
    } catch (cause) {
      setMemoryError(errorMessage(cause));
    } finally {
      setMemoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  useEffect(() => {
    if (conversations.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((previous) => (previous && conversations.some((item) => item.id === previous) ? previous : conversations[0].id));
  }, [conversations]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    setTyping(false);
    setContextInfo(null);
    setDraft('');
    if (!selectedId) {
      loadSeqRef.current += 1;
      setMessages([]);
      setMessagesError(null);
      setMessagesLoading(false);
      return;
    }
    void loadMessages(selectedId);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    if (!selectedId) return;
    const offMessage = events.on('chat:message', ({ message, conversation: nextConversation }) => {
      if (nextConversation.id !== selectedId) return;
      setMessages((previous) => (previous.some((item) => item.id === message.id) ? previous : [...previous, message]));
    });
    const offTyping = events.on('chat:typing', (payload) => {
      if (payload.conversationId === selectedId) setTyping(payload.typing);
    });
    return () => {
      offMessage();
      offTyping();
    };
  }, [selectedId]);

  useEffect(() => {
    if (narrow) {
      setInsightCollapsed(false);
    } else {
      setInsightOverlay(false);
    }
  }, [narrow]);

  const selectConversation = useCallback((next: Conversation) => {
    setSelectedId(next.id);
    setDraft('');
    setMobilePane('chat');
    setInsightOverlay(false);
    if (next.unread > 0) patchConversation({ ...next, unread: 0 });
  }, [patchConversation]);

  const handleSend = useCallback(async (text: string, attachments?: ChatAttachment[]): Promise<boolean> => {
    if (!conversation) return false;
    if (sending) return false;
    const content = text.trim();
    if (!content && (!attachments || attachments.length === 0)) return false;
    const optimisticId = 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const optimistic: ChatMessage = {
      id: optimisticId,
      conversationId: conversation.id,
      role: 'user',
      text: content,
      createdAt: new Date().toISOString(),
      senderId: 'me',
      senderName: '我',
      scene: conversation.scene,
      attachments,
    };
    setMessages((previous) => [...previous, optimistic]);
    setSending(true);
    setTyping(true);
    try {
      const result = await api.chat.send({ conversationId: conversation.id, text: content, attachments });
      const stillHere = selectedIdRef.current === conversation.id;
      const incoming = [result.userMessage, result.reply].filter((item): item is ChatMessage => Boolean(item));
      if (incoming.length === 0) {
        if (stillHere) setMessages((previous) => previous.filter((item) => item.id !== optimisticId));
        if (result.error) toast.error('鲸鲸没有回上话', result.error);
        return false;
      }
      if (stillHere) {
        setMessages((previous) => {
          const base = previous.filter((item) => item.id !== optimisticId);
          for (const message of incoming) {
            if (!base.some((item) => item.id === message.id)) base.push(message);
          }
          return base;
        });
        setContextInfo(result.context ?? null);
      }
      patchConversation(result.conversation);
      if (result.error) toast.error('回复生成了，但有点小问题', result.error);
      void loadMemory();
      return true;
    } catch (cause) {
      setMessages((previous) => previous.filter((item) => item.id !== optimisticId));
      toast.error('消息发送失败', errorMessage(cause));
      return false;
    } finally {
      setSending(false);
      setTyping(false);
    }
  }, [conversation, sending, patchConversation, loadMemory, toast]);

  const handleSwitchPersona = useCallback(async (personaId: string) => {
    if (!conversation || switchingPersona) return;
    setSwitchingPersona(personaId);
    try {
      const next = await api.chat.setPersona(conversation.id, personaId);
      patchConversation(next);
      const target = personas.find((item) => item.id === personaId);
      toast.success('已切换对话人设', (target?.nickname || target?.name || '新的人设') + ' 接管了这段对话');
    } catch (cause) {
      toast.error('切换人设失败', errorMessage(cause));
    } finally {
      setSwitchingPersona(null);
    }
  }, [conversation, personas, patchConversation, switchingPersona, toast]);

  const handleClear = async () => {
    if (!conversation || clearing) return;
    setClearing(true);
    try {
      await api.chat.clear(conversation.id);
      setMessages([]);
      patchConversation({ ...conversation, lastMessage: '', messageCount: 0, unread: 0 });
      toast.success('这段对话已清空', '关系记忆与成长记录都还在。');
      setClearOpen(false);
    } catch (cause) {
      toast.error('清空失败', errorMessage(cause));
    } finally {
      setClearing(false);
    }
  };

  const handleDelete = async () => {
    if (!conversation || deleting) return;
    setDeleting(true);
    try {
      await api.chat.remove(conversation.id);
      const remaining = conversations.filter((item) => item.id !== conversation.id);
      setConversations(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      toast.success('会话已删除', '如果只是不想看到消息，清空会话就可以了。');
      setDeleteOpen(false);
    } catch (cause) {
      toast.error('删除失败', errorMessage(cause));
    } finally {
      setDeleting(false);
    }
  };

  const handleCreated = (created: Conversation) => {
    addConversation(created);
    setSelectedId(created.id);
    setDraft('');
    setMobilePane('chat');
  };

  const toggleInsight = () => {
    if (narrow) setInsightOverlay((value) => !value);
    else setInsightCollapsed((value) => !value);
  };

  const navigate = (route: string) => { window.location.hash = '/' + route; };

  const workspaceClass = [
    'chat-workspace',
    !narrow && insightCollapsed ? 'is-insight-collapsed' : '',
    narrow && insightOverlay ? 'is-insight-open' : '',
    compact && mobilePane === 'list' ? 'is-mobile-list' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="chat-page">
      <div className={workspaceClass}>
        <ConversationList
          conversations={conversations}
          personas={personas}
          selectedId={selectedId}
          onSelect={selectConversation}
          onCreate={() => setNewOpen(true)}
        />

        <section className="chat-panel chat-panel--main">
          <div className="chat-main__head">
            {compact && (
              <IconButton label="返回会话列表" className="chat-mobile-back" onClick={() => setMobilePane('list')}>
                <ArrowLeft size={18} />
              </IconButton>
            )}
            {conversation ? (
              <>
                <ChatAvatar src={conversation.peerAvatar} name={conversationTitle(conversation)} scene={conversation.scene} size="md" ring />
                <div className="chat-main__identity">
                  <div className="chat-title-row">
                    <h2 className="chat-title">{conversationTitle(conversation)}</h2>
                    <Badge tone={conversation.scene === 'group' ? 'mint' : 'brand'}>{conversation.scene === 'group' ? '群聊' : '私聊'}</Badge>
                    {conversation.isDemo && <Badge tone="warning" dot>演示</Badge>}
                  </div>
                  <div className="chat-main__sub">
                    <span className="chat-main__persona">{persona?.avatar || '🐳'} {persona?.name || '鲸鲸'}</span>
                    <span className="chat-dot-sep" />
                    <span>{formatNumber(conversation.messageCount)} 条消息</span>
                    <span className="chat-dot-sep" />
                    <span>{sending ? '鲸鲸正在思考…' : typing ? '正在输入…' : '深海信号稳定'}</span>
                  </div>
                </div>
                <div className="chat-main__actions">
                  <IconButton label="刷新消息" onClick={() => void loadMessages(conversation.id)}><RefreshCw size={16} /></IconButton>
                  <IconButton label="清空会话" onClick={() => setClearOpen(true)}><Eraser size={16} /></IconButton>
                  <IconButton label="删除会话" onClick={() => setDeleteOpen(true)}><Trash2 size={16} /></IconButton>
                  <IconButton
                    label={narrow ? '记忆与情绪' : '展开或收起洞察面板'}
                    className="chat-insight-toggle"
                    active={narrow ? insightOverlay : !insightCollapsed}
                    onClick={toggleInsight}
                  >
                    <PanelRightOpen size={17} />
                  </IconButton>
                </div>
              </>
            ) : (
              <>
                <span className="chat-main__empty-glyph">{activePersona?.avatar || '🐳'}</span>
                <div className="chat-main__identity">
                  <div className="chat-eyebrow">CHAT WORKBENCH</div>
                  <h2 className="chat-title">聊天工作台</h2>
                  <div className="chat-main__sub">选择一段对话，或新建一段关系。</div>
                </div>
                <div className="chat-main__actions">
                  <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setNewOpen(true)}>新建会话</Button>
                </div>
              </>
            )}
          </div>

          {conversation ? (
            <>
              <MessageList
                conversation={conversation}
                persona={persona}
                messages={messages}
                loading={messagesLoading}
                error={messagesError}
                typing={typing || sending}
                onRetry={() => void loadMessages(conversation.id)}
                onQuickSend={(text) => { void handleSend(text); }}
              />
              <ChatComposer
                key={conversation.id}
                conversation={conversation}
                persona={persona}
                petAssets={petAssets}
                sending={sending}
                readOnly={readOnlyChat}
                draft={draft}
                onDraftChange={setDraft}
                onSend={handleSend}
              />
            </>
          ) : (
            <div className="chat-main__empty">
              <div className="chat-empty-orb">
                <span>{activePersona?.avatar || '🐳'}</span>
                <i className="chat-empty-orb__ring" />
                <i className="chat-empty-orb__bubble chat-empty-orb__bubble--1" />
                <i className="chat-empty-orb__bubble chat-empty-orb__bubble--2" />
                <i className="chat-empty-orb__bubble chat-empty-orb__bubble--3" />
              </div>
              <h3>深海频道还很安静</h3>
              <p>从左侧选一段对话，或者新建一个会话，把想说的话交给鲸鲸。她会记住你们聊过的每一件小事。</p>
              <div className="chat-empty-actions">
                <Button variant="primary" icon={<Plus size={15} />} onClick={() => setNewOpen(true)}>新建会话</Button>
                {conversations.length > 0 && (
                  <Button variant="ghost" icon={<MessagesSquare size={14} />} onClick={() => selectConversation(conversations[0])}>打开最近的对话</Button>
                )}
              </div>
              <div className="chat-empty-tips">
                <span><span className="kbd">Enter</span> 发送</span>
                <span><span className="kbd">Shift</span> + <span className="kbd">Enter</span> 换行</span>
                <span>支持表情、梗图与图片</span>
              </div>
            </div>
          )}
        </section>

        {narrow && insightOverlay && <div className="chat-insight-scrim" onClick={() => setInsightOverlay(false)} />}

        <InsightPanel
          conversation={conversation}
          personas={personas}
          persona={persona}
          emotion={overview.emotion}
          growth={overview.growth}
          memory={memory}
          memoryLoading={memoryLoading}
          memoryError={memoryError}
          onRetryMemory={() => void loadMemory()}
          context={contextInfo}
          messages={messages}
          switchingId={switchingPersona}
          collapsed={!narrow && insightCollapsed}
          onToggleCollapse={() => { if (narrow) setInsightOverlay(false); else setInsightCollapsed((value) => !value); }}
          onSwitchPersona={handleSwitchPersona}
          onNavigate={navigate}
          onClose={() => setInsightOverlay(false)}
        />
      </div>

      <NewConversationModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={handleCreated} />

      <Modal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="清空这段对话？"
        desc="消息记录会被删除，但关系记忆与成长记录不受影响。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setClearOpen(false)}>再想想</Button>
            <Button variant="danger" loading={clearing} onClick={() => void handleClear()}>确认清空</Button>
          </>
        )}
      >
        <div className="callout callout--warning">
          <AlertTriangle size={15} className="callout__icon" />
          <div>清空后无法恢复。如果只是想重新开始，也可以保留这段对话，直接发一句新的问候。</div>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="删除这段会话？"
        desc={conversation ? '「' + conversationTitle(conversation) + '」将从对话列表移除，' + formatNumber(conversation.messageCount) + ' 条消息会一起删除。' : undefined}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>取消</Button>
            <Button variant="danger" loading={deleting} onClick={() => void handleDelete()}>删除会话</Button>
          </>
        )}
      >
        <div className="callout">
          <AlertTriangle size={15} className="callout__icon" />
          <div>如果这段关系对你很重要，建议先清空而不是删除，记忆档案会继续保留。</div>
        </div>
      </Modal>
    </div>
  );
}