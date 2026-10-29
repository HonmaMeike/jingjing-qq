import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import {
  AlertTriangle, ArrowUpRight, BookOpen, Brain, ChevronLeft, ChevronRight, Gauge, Heart,
  Loader2, Sparkles, Users, X,
} from 'lucide-react';
import type {
  ChatContextInfo, ChatMessage, Conversation, EmotionState, GrowthState,
  MemorySummary, Persona,
} from '@shared/types';
import { Badge, Button, EmptyState, IconButton, Progress, Ring, cn } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { personaAvatarUrl } from '@/lib/persona';
import { ChatAvatar } from './ChatAvatar';
import { MEMORY_CATEGORY_LABEL, conversationTitle, normalizeMetric } from './chat-utils';

interface InsightPanelProps {
  conversation: Conversation | null;
  personas: Persona[];
  persona?: Persona;
  emotion: EmotionState;
  growth: GrowthState;
  memory: MemorySummary | null;
  memoryLoading: boolean;
  memoryError: string | null;
  context: ChatContextInfo | null;
  messages: ChatMessage[];
  switchingId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSwitchPersona: (personaId: string) => void;
  onNavigate: (route: string) => void;
  onClose: () => void;
  onRetryMemory: () => void;
}

function Meter({ label, value }: { label: string; value: number }) {
  const percent = normalizeMetric(value);
  return (
    <div className="chat-meter">
      <div className="chat-meter__head"><span>{label}</span><strong>{Math.round(percent)}</strong></div>
      <Progress value={percent} thin />
    </div>
  );
}

export function InsightPanel({
  conversation, personas, persona, emotion, growth, memory, memoryLoading, memoryError, context, messages,
  switchingId, collapsed, onToggleCollapse, onSwitchPersona, onNavigate, onClose, onRetryMemory,
}: InsightPanelProps) {
  const memoryDoc = useMemo(() => {
    if (!memory || !conversation) return undefined;
    const target = conversation.scene === 'group' ? conversation.groupId : conversation.peerId;
    const names = [conversation.peerName, conversation.groupName].filter(Boolean);
    return memory.docs.find((doc) =>
      (target && doc.externalId === target) ||
      doc.externalId === conversation.peerId ||
      names.includes(doc.displayName),
    );
  }, [memory, conversation]);

  const relationship = memoryDoc?.relationship;
  const facts = useMemo(() => {
    const list = memoryDoc?.facts ?? [];
    return list.slice().sort((a, b) => b.weight - a.weight).slice(0, 4);
  }, [memoryDoc]);

  const members = useMemo(() => {
    const map = new Map<string, { key: string; name: string; avatar?: string; count: number; assistant: boolean }>();
    for (const message of messages) {
      if (message.role === 'system') continue;
      const assistant = message.role === 'assistant';
      const name = assistant ? (persona?.name || '鲸鲸') : (message.senderName || '我');
      const key = message.senderId || name;
      const current = map.get(key);
      if (current) current.count += 1;
      else map.set(key, { key, name, avatar: message.avatar, count: 1, assistant });
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [messages, persona?.nickname, persona?.name]);

  const tokenPercent = context && context.maxTokens > 0
    ? Math.min(100, Math.round((context.estimatedTokens / context.maxTokens) * 100))
    : 0;
  const personaStyle = { '--pc': persona?.color || 'var(--brand)' } as CSSProperties;

  if (collapsed) {
    return (
      <aside className="chat-panel chat-panel--insight chat-insight chat-insight--rail">
        <IconButton label="展开记忆与情绪" className="chat-rail__expand" onClick={onToggleCollapse}><ChevronLeft size={17} /></IconButton>
        <ChatAvatar src={personaAvatarUrl(persona)} glyph={persona?.avatar} name={persona?.name} size="sm" />
        <div className="chat-rail__mood" title={'当前心情：' + emotion.mood}>{emotion.moodEmoji}</div>
        <div className="chat-rail__label">记忆<br />与情绪</div>
        <div className="chat-rail__pulse" />
      </aside>
    );
  }

  return (
    <aside className="chat-panel chat-panel--insight chat-insight">
      <div className="chat-insight__head">
        <div>
          <div className="chat-eyebrow">MEMORY &amp; MOOD</div>
          <div className="chat-title-row"><h2 className="chat-title">记忆与情绪</h2></div>
        </div>
        <div className="chat-insight__head-actions">
          <IconButton label="关闭面板" className="chat-insight__close" onClick={onClose}><X size={16} /></IconButton>
          <IconButton label="收起面板" className="chat-insight__collapse" onClick={onToggleCollapse}><ChevronRight size={16} /></IconButton>
        </div>
      </div>

      <div className="chat-insight__scroll">
        {!conversation ? (
          <EmptyState
            icon={<Brain size={21} />}
            title="选一段对话再展开"
            desc="这里会显示鲸鲸对这段关系的记忆、情绪和上下文预算。"
          />
        ) : (
          <>
            <section className="chat-insight-card chat-insight-card--persona" style={personaStyle}>
              <div className="chat-insight-persona">
                <ChatAvatar src={personaAvatarUrl(persona)} glyph={persona?.avatar} name={persona?.name} size="lg" ring />
                <div className="chat-insight-persona__body">
                  <div className="chat-insight-persona__name">
                    {persona?.nickname || persona?.name || '鲸鲸'}
                    <Badge tone="brand">Lv.{growth.level}</Badge>
                  </div>
                  <div className="chat-insight-persona__title">{persona?.title || '你的深海伙伴'}</div>
                  <div className="chat-insight-mood">
                    <span className="chat-insight-mood__emoji">{emotion.moodEmoji}</span>
                    <span>{emotion.mood} · 好感 {Math.round(emotion.affection * 100)}%</span>
                  </div>
                </div>
              </div>
              <div className="chat-insight-mini-grid">
                <div className="chat-insight-mini"><span>关系阶段</span><strong>{growth.stageName || '初见'}</strong></div>
                <div className="chat-insight-mini"><span>陪伴天数</span><strong>{growth.totalDays} 天</strong></div>
                <div className="chat-insight-mini"><span>活跃能量</span><strong>{Math.round(emotion.energy * 100)}%</strong></div>
              </div>
              <div className="chat-insight-progress">
                <div className="chat-insight-progress__label"><span>成长进度</span><span>距下一阶段 {100 - Math.round(growth.stageProgress)}%</span></div>
                <Progress value={growth.stageProgress} thin />
              </div>
              <div className="chat-insight-actions">
                <Button size="sm" variant="ghost" icon={<ArrowUpRight size={13} />} onClick={() => onNavigate('personas')}>人设工坊</Button>
                <Button size="sm" variant="ghost" icon={<ArrowUpRight size={13} />} onClick={() => onNavigate('growth')}>成长记录</Button>
              </div>
            </section>

            <section className="chat-insight-card">
              <div className="chat-insight-card__title">
                <Gauge size={14} /> 上下文预算
                <span className="chat-insight-card__sub">{context ? context.rawMessages + ' 条原文' : '发送后更新'}</span>
              </div>
              {context ? (
                <>
                  <div className="chat-context-nums">
                    <span>{formatNumber(context.estimatedTokens)} / {formatNumber(context.maxTokens)} tokens</span>
                    <strong>{tokenPercent}%</strong>
                  </div>
                  <Progress value={tokenPercent} thin />
                  <div className="chat-context-chips">
                    <span className={cn('chat-mini-chip', context.compacted && 'is-warn')}>{context.compacted ? '已压缩' : '未压缩'}</span>
                    <span className="chat-mini-chip">记忆命中 {context.memoryHits}</span>
                    <span className="chat-mini-chip">摘要 v{context.summaryVersion}</span>
                  </div>
                </>
              ) : (
                <div className="chat-insight-hint">发送一条消息后，这里会显示鲸鲸实际使用的上下文预算与记忆命中情况。</div>
              )}
            </section>

            <section className="chat-insight-card">
              <div className="chat-insight-card__title">
                <Heart size={14} /> 关系温度
                {relationship && <span className="chat-insight-card__sub">{relationship.interactions} 次互动</span>}
              </div>
              {memoryError && !relationship ? (
                <div className="chat-insight-error">
                  <AlertTriangle size={13} />
                  <span>记忆摘要加载失败：{memoryError}</span>
                  <button type="button" className="chat-insight-link" onClick={onRetryMemory}>重试</button>
                </div>
              ) : memoryLoading && !relationship ? (
                <div className="chat-insight-skeleton">
                  <span className="skeleton" style={{ height: 56 }} />
                  <span className="skeleton" style={{ height: 10 }} />
                  <span className="skeleton" style={{ height: 10 }} />
                </div>
              ) : relationship ? (
                <>
                  <div className="chat-relationship">
                    <Ring value={normalizeMetric(relationship.affinity)} label={Math.round(relationship.affinity)} size={62} />
                    <div className="chat-meters">
                      <Meter label="信任" value={relationship.trust} />
                      <Meter label="熟悉" value={relationship.familiarity} />
                      <Meter label="亲密" value={relationship.intimacy} />
                    </div>
                  </div>
                  <div className="chat-relationship__meta">
                    <span>首次相遇 {relationship.firstMetAt ? new Date(relationship.firstMetAt).toLocaleDateString('zh-CN') : '刚刚'}</span>
                    <span>连续 {relationship.streakDays ?? 0} 天</span>
                  </div>
                  {(relationship.notes ?? []).slice(0, 2).map((note, index) => (
                    <div className="chat-insight-note" key={index}>「{note}」</div>
                  ))}
                </>
              ) : (
                <div className="chat-insight-hint">还没有形成关系档案。多聊几轮，鲸鲸会在记忆里慢慢记下你们的关系。</div>
              )}
            </section>

            <section className="chat-insight-card">
              <div className="chat-insight-card__title">
                <Sparkles size={14} /> 记忆片段
                <span className="chat-insight-card__sub">{memoryDoc ? memoryDoc.facts.length + ' 条' : '等待记忆'}</span>
              </div>
              {facts.length > 0 ? (
                <div className="chat-facts">
                  {facts.map((fact) => (
                    <div className="chat-fact" key={fact.id}>
                      <span className={cn('chat-fact__cat', 'is-' + fact.category)}>{MEMORY_CATEGORY_LABEL[fact.category] || '记忆'}</span>
                      <span className="chat-fact__text">{fact.text}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="chat-insight-hint">聊到值得记住的事，鲸鲸会把它写进这段关系的档案里。</div>
              )}
              <button type="button" className="chat-insight-link" onClick={() => onNavigate('memory')}>
                <BookOpen size={13} /> 打开完整记忆库 <ArrowUpRight size={12} />
              </button>
            </section>

            {conversation.scene === 'group' && (
              <section className="chat-insight-card">
                <div className="chat-insight-card__title">
                  <Users size={14} /> 群聊成员
                  <span className="chat-insight-card__sub">{members.length} 位发言</span>
                </div>
                <div className="chat-group-name"># {conversationTitle(conversation)}</div>
                {members.length > 0 ? (
                  <div className="chat-members">
                    {members.map((member) => (
                      <div className="chat-member" key={member.key}>
                        <ChatAvatar src={member.avatar} glyph={member.assistant ? persona?.avatar : undefined} name={member.name} size="xs" />
                        <span className="chat-member__name">{member.name}</span>
                        {member.assistant && <Badge tone="brand">鲸鲸</Badge>}
                        <span className="chat-member__count">{member.count} 条</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="chat-insight-hint">还没有群友发言记录，等第一条群消息吧。</div>
                )}
                <div className="chat-insight-note">群聊里鲸鲸只会在被 @ 或触发唤醒词时接话，避免刷屏；私聊则随时回应。</div>
              </section>
            )}

            <section className="chat-insight-card">
              <div className="chat-insight-card__title">
                <Sparkles size={14} /> 切换对话人设
                <span className="chat-insight-card__sub">仅影响此会话</span>
              </div>
              <div className="chat-persona-switch">
                {personas.map((item) => {
                  const active = item.id === persona?.id;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={cn('chat-persona-chip', active && 'is-active')}
                      disabled={switchingId !== null || active}
                      title={item.title + ' · ' + item.tagline}
                      onClick={() => onSwitchPersona(item.id)}
                    >
                      {switchingId === item.id ? <Loader2 size={14} className="spin" /> : <span className="chat-persona-chip__glyph">{item.avatar}</span>}
                      <span className="chat-persona-chip__name">{item.nickname || item.name}</span>
                    </button>
                  );
                })}
              </div>
              <button type="button" className="chat-insight-link" onClick={() => onNavigate('personas')}>
                <Sparkles size={13} /> 去人设工坊养一位鲸娘 <ArrowUpRight size={12} />
              </button>
            </section>

            {conversation.isDemo && (
              <div className="callout callout--warning">
                <Sparkles size={14} className="callout__icon" />
                <div>这是演示会话。可以放心试聊、切换人设观察不同回复，之后在设置里一键清除演示数据。</div>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}