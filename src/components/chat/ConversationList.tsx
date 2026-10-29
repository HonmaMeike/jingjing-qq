import { useMemo, useState } from 'react';
import { Hash, MessageSquare, Pin, Plus, Search, X } from 'lucide-react';
import type { Conversation, Persona } from '@shared/types';
import { Badge, Button, EmptyState, Segmented, cn } from '@/components/ui';
import { personaAvatarUrl } from '@/lib/persona';
import { ChatAvatar } from './ChatAvatar';
import {
  conversationTimestamp,
  conversationTitle,
  type ConversationFilter,
} from './chat-utils';

interface ConversationListProps {
  conversations: Conversation[];
  personas: Persona[];
  selectedId: string | null;
  loading?: boolean;
  onSelect: (conversation: Conversation) => void;
  onCreate: () => void;
}

function PersonaDot({ persona }: { persona?: Persona }) {
  if (!persona) return null;
  const url = personaAvatarUrl(persona);
  return (
    <span className="chat-conv__persona" title={persona.name}>
      {url ? <img src={url} alt={persona.name} /> : <span>{persona.avatar || persona.name.slice(0, 1)}</span>}
    </span>
  );
}

export function ConversationList({ conversations, personas, selectedId, loading, onSelect, onCreate }: ConversationListProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ConversationFilter>('all');

  const counts = useMemo(() => ({
    all: conversations.length,
    private: conversations.filter((c) => c.scene === 'private').length,
    group: conversations.filter((c) => c.scene === 'group').length,
  }), [conversations]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return conversations.filter((conversation) => {
      if (filter !== 'all' && conversation.scene !== filter) return false;
      if (!keyword) return true;
      const haystack = (conversationTitle(conversation) + ' ' + conversation.peerName + ' ' + (conversation.groupName ?? '') + ' ' + conversation.lastMessage).toLowerCase();
      return haystack.includes(keyword);
    });
  }, [conversations, filter, query]);

  const unread = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);
  const personaOf = (conversation: Conversation): Persona | undefined => personas.find((p) => p.id === conversation.personaId);

  return (
    <aside className="chat-panel chat-panel--conv">
      <div className="chat-conv__head">
        <div className="chat-head-row">
          <div className="chat-head-titles">
            <div className="chat-eyebrow">CONVERSATIONS</div>
            <div className="chat-title-row">
              <h2 className="chat-title">对话</h2>
              <span className="chat-count">{conversations.length}</span>
            </div>
          </div>
          <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={onCreate}>新会话</Button>
        </div>
        <div className="chat-search">
          <Search size={15} className="chat-search__icon" />
          <input
            className="input chat-search__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索名字或消息…"
            aria-label="搜索会话"
          />
          {query && (
            <button type="button" className="chat-search__clear" onClick={() => setQuery('')} aria-label="清空搜索">
              <X size={13} />
            </button>
          )}
        </div>
        <Segmented<ConversationFilter>
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: '全部' },
            { value: 'private', label: '私聊' },
            { value: 'group', label: '群聊' },
          ]}
        />
      </div>

      <div className="chat-conv__list">
        {loading && conversations.length === 0 && (
          <div className="chat-conv__skeleton">
            {[0, 1, 2, 3].map((item) => (
              <div className="chat-conv-skeleton" key={item}>
                <span className="skeleton chat-conv-skeleton__avatar" />
                <span className="chat-conv-skeleton__lines">
                  <span className="skeleton" style={{ width: '46%', height: 10 }} />
                  <span className="skeleton" style={{ width: '78%', height: 8 }} />
                </span>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          conversations.length === 0 ? (
            <EmptyState
              icon={<MessageSquare size={22} />}
              title="还没有任何对话"
              desc="新建一段会话，和鲸鲸从一句问候开始。也可以勾选演示模式先体验。"
              action={<Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={onCreate}>新建第一段会话</Button>}
            />
          ) : (
            <EmptyState
              icon={<Search size={21} />}
              title="没有匹配的会话"
              desc={query ? '换个关键词试试，或者清空搜索。' : '这个分类下还很安静，切回全部看看。'}
              action={query ? <Button size="sm" variant="ghost" onClick={() => setQuery('')}>清空搜索</Button> : <Button size="sm" variant="ghost" onClick={() => setFilter('all')}>查看全部</Button>}
            />
          )
        )}

        {filtered.map((conversation) => {
          const active = conversation.id === selectedId;
          const persona = personaOf(conversation);
          const title = conversationTitle(conversation);
          return (
            <button
              type="button"
              key={conversation.id}
              className={cn('chat-conv', active && 'is-active')}
              onClick={() => onSelect(conversation)}
            >
              <span className="chat-conv__avatar-wrap">
                <ChatAvatar src={conversation.peerAvatar} name={title} scene={conversation.scene} size="md" />
                <PersonaDot persona={persona} />
              </span>
              <span className="chat-conv__body">
                <span className="chat-conv__top">
                  <span className="chat-conv__name">{title}</span>
                  {conversation.scene === 'group' && <Hash size={11} className="chat-conv__hash" />}
                  {conversation.pinned && <Pin size={11} className="chat-conv__pin" />}
                  {conversation.isDemo && <Badge tone="warning" className="chat-conv__demo">演示</Badge>}
                  <span className="chat-conv__time">{conversationTimestamp(conversation.lastMessageAt)}</span>
                </span>
                <span className="chat-conv__bottom">
                  <span className={cn('chat-conv__preview', conversation.unread > 0 && 'is-unread')}>
                    {conversation.lastMessage || (conversation.messageCount > 0 ? '[媒体消息]' : '还没有消息，先打个招呼吧')}
                  </span>
                  {conversation.unread > 0 && <span className="chat-conv__unread">{conversation.unread > 99 ? '99+' : conversation.unread}</span>}
                </span>
                <span className="chat-conv__persona-line">
                  <span className="chat-conv__persona-emoji">{persona?.avatar || '🐳'}</span>
                  <span>{persona?.name || '鲸鲸'} 在此陪伴</span>
                  <span className="chat-conv__scene">{conversation.scene === 'group' ? '群聊' : '私聊'}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="chat-conv__foot">
        <span className="chat-conv__foot-dot" />
        <span>共 {counts.all} 段对话</span>
        <span className="chat-conv__foot-sep" />
        <span>{unread > 0 ? unread + ' 条未读' : '全部已读'}</span>
        <span className="spacer" />
        <span className="chat-conv__foot-hint">演示会话可放心试聊</span>
      </div>
    </aside>
  );
}
