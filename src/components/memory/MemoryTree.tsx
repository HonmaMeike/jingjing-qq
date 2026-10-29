import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Pin, Search, ShieldCheck, Sparkles, UsersRound, X, Database } from 'lucide-react';
import type { MemoryDoc, MemorySearchHit, MemorySummary } from '@shared/types';
import { Avatar, Badge, Card, IconButton, Input, Spinner, cn } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { scopeShortLabel, timeValue } from '@/components/memory/meta';

interface GroupEntry {
  id: string;
  name: string;
  memberCount: number;
  updatedAt: string;
  preview: string;
  doc?: MemoryDoc;
  members: MemoryDoc[];
}

interface Props {
  summary: MemorySummary;
  selectedId: string | null;
  onSelect: (docId: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
  hits: MemorySearchHit[];
  searching: boolean;
  searchError: string | null;
}

function buildGroups(summary: MemorySummary): GroupEntry[] {
  const docs = summary.docs ?? [];
  const entries: GroupEntry[] = summary.groups.map((group) => ({
    id: group.id,
    name: group.name,
    memberCount: group.memberCount,
    updatedAt: group.updatedAt,
    preview: group.preview,
    doc: docs.find((doc) => doc.scope === 'group' && (doc.externalId === group.id || doc.id === group.id)),
    members: docs.filter((doc) => doc.scope === 'user' && doc.groupId === group.id),
  }));
  for (const doc of docs) {
    if (doc.scope !== 'group') continue;
    const exists = entries.some((entry) => entry.doc?.id === doc.id || entry.id === doc.externalId);
    if (exists) continue;
    entries.push({
      id: doc.externalId,
      name: doc.displayName,
      memberCount: docs.filter((member) => member.scope === 'user' && member.groupId === doc.externalId).length,
      updatedAt: doc.updatedAt,
      preview: doc.preview,
      doc,
      members: docs.filter((member) => member.scope === 'user' && member.groupId === doc.externalId),
    });
  }
  return entries.sort((left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt));
}

function DocRow({ doc, active, onSelect, depth = 0, label }: { doc: MemoryDoc; active: boolean; onSelect: (id: string) => void; depth?: number; label?: string }) {
  const isGlobal = doc.scope === 'global' || doc.scope === 'persona';
  const isGroupDoc = doc.scope === 'group';
  return (
    <button
      type="button"
      className={cn('mem-doc-row', active && 'is-active')}
      style={depth ? { paddingLeft: 9 + depth * 14 } : undefined}
      onClick={() => onSelect(doc.id)}
      title={doc.preview || doc.displayName}
    >
      <span className="mem-doc-row__icon">
        {isGlobal ? (
          <span className="mem-doc-row__glyph is-global"><Sparkles size={15} /></span>
        ) : isGroupDoc ? (
          <span className="mem-doc-row__glyph is-group"><UsersRound size={15} /></span>
        ) : (
          <Avatar src={doc.avatar} name={doc.displayName} size="sm" />
        )}
      </span>
      <span className="mem-doc-row__body">
        <span className="mem-doc-row__name">
          <span className="truncate">{label ?? doc.displayName}</span>
          {doc.pinned && <Pin size={11} className="mem-doc-row__pin" />}
        </span>
        <span className="mem-doc-row__sub">
          {doc.facts.length} 条事实 · {relativeTime(doc.updatedAt)}
        </span>
      </span>
      {doc.scope === 'group' && <span className="mem-doc-row__flag">群</span>}
    </button>
  );
}

export default function MemoryTree({ summary, selectedId, onSelect, query, onQueryChange, hits, searching, searchError }: Props) {
  const groups = useMemo(() => buildGroups(summary), [summary]);
  const privateDocs = useMemo(
    () => (summary.docs ?? []).filter((doc) => doc.scope === 'user' && !doc.groupId).sort((left, right) => {
      if (Boolean(left.pinned) !== Boolean(right.pinned)) return left.pinned ? -1 : 1;
      return timeValue(right.updatedAt) - timeValue(left.updatedAt);
    }),
    [summary],
  );
  const selfDocs = useMemo(
    () => (summary.docs ?? []).filter((doc) => doc.scope === 'global' || doc.scope === 'persona'),
    [summary],
  );
  const [expanded, setExpanded] = useState<string[]>(() => groups.slice(0, 1).map((group) => group.id));
  const searchingNow = Boolean(query.trim());

  useEffect(() => {
    if (!selectedId) return;
    const doc = (summary.docs ?? []).find((item) => item.id === selectedId);
    if (!doc) return;
    const groupId = doc.groupId ?? (doc.scope === 'group' ? doc.externalId : undefined);
    if (!groupId) return;
    setExpanded((prev) => (prev.includes(groupId) ? prev : [...prev, groupId]));
  }, [selectedId, summary.docs]);

  const toggleGroup = (groupId: string) => {
    setExpanded((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  };

  return (
    <Card className="mem-tree">
      <div className="mem-tree__head">
        <div>
          <div className="mem-tree__title"><Database size={15} />记忆档案树</div>
          <div className="mem-tree__caption">按 QQ 号独立成册 · 集中存放在本机</div>
        </div>
        <Badge tone="brand">{summary.stats.docs} 份</Badge>
      </div>

      <div className="mem-search">
        <Search size={14} className="mem-search__icon" />
        <Input
          className="mem-search__input"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索记忆、事实或原话…"
          aria-label="搜索记忆"
        />
        {query && (
          <IconButton label="清空搜索" className="mem-search__clear" onClick={() => onQueryChange('')}>
            <X size={14} />
          </IconButton>
        )}
      </div>

      {searchingNow && (
        <div className="mem-hits">
          <div className="mem-hits__head">
            <span>搜索结果</span>
            {searching ? <Spinner label="检索中" /> : <span className="dim text-xs">{hits.length} 条命中</span>}
          </div>
          {searchError && <div className="mem-inline-error">{searchError}</div>}
          {!searching && !searchError && hits.length === 0 && (
            <div className="mem-hits__empty">没有找到相关记忆，换个更短的关键词试试。</div>
          )}
          <div className="mem-hits__list">
            {hits.map((hit, index) => (
              <button
                type="button"
                key={`${hit.docId}-${index}`}
                className={cn('mem-hit', hit.docId === selectedId && 'is-active')}
                onClick={() => onSelect(hit.docId)}
              >
                <span className="mem-hit__top">
                  <span className="mem-hit__name truncate">{hit.displayName}</span>
                  <span className="mem-hit__scope">{scopeShortLabel(hit.scope)}</span>
                </span>
                <span className="mem-hit__snippet">{hit.snippet}</span>
                <span className="mem-hit__score">
                  <span style={{ width: `${Math.round(Math.max(0, Math.min(1, hit.score)) * 100)}%` }} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mem-tree__scroll">
        {selfDocs.length > 0 && (
          <div className="mem-tree__section">
            <div className="mem-tree__label"><Sparkles size={12} />自我档案</div>
            {selfDocs.map((doc) => (
              <DocRow key={doc.id} doc={doc} active={doc.id === selectedId} onSelect={onSelect} />
            ))}
          </div>
        )}

        <div className="mem-tree__section">
          <div className="mem-tree__label"><UsersRound size={12} />私聊联系人<span className="dim">{privateDocs.length}</span></div>
          {privateDocs.length === 0 ? (
            <div className="mem-tree__hint">还没有私聊记忆。和鲸鲸私聊几句，这里就会多出一本只属于对方的小册子。</div>
          ) : (
            privateDocs.map((doc) => (
              <DocRow key={doc.id} doc={doc} active={doc.id === selectedId} onSelect={onSelect} />
            ))
          )}
        </div>

        <div className="mem-tree__section">
          <div className="mem-tree__label"><UsersRound size={12} />群聊档案<span className="dim">{groups.length}</span></div>
          {groups.length === 0 ? (
            <div className="mem-tree__hint">还没有群聊记忆。群里的对话会单独成册，不会和私聊混在一起。</div>
          ) : (
            groups.map((group) => {
              const open = expanded.includes(group.id);
              return (
                <div key={group.id} className={cn('mem-group', open && 'is-open')}>
                  <button type="button" className="mem-group__head" onClick={() => toggleGroup(group.id)} aria-expanded={open}>
                    <ChevronRight size={13} className="mem-group__chev" />
                    <span className="mem-group__glyph"><UsersRound size={14} /></span>
                    <span className="mem-group__body">
                      <span className="mem-group__name truncate">{group.name}</span>
                      <span className="mem-group__sub">{group.memberCount} 位成员 · {relativeTime(group.updatedAt)}</span>
                    </span>
                  </button>
                  {open && (
                    <div className="mem-group__members">
                      {group.doc ? (
                        <DocRow doc={group.doc} active={group.doc.id === selectedId} label="群整体记忆（不是成员）" onSelect={onSelect} />
                      ) : (
                        <div className="mem-tree__hint">群记忆文档还没生成。</div>
                      )}
                      {group.members.length === 0 ? (
                        <div className="mem-tree__hint">暂无群成员档案，等她在这个群里多聊几次。</div>
                      ) : (
                        group.members.map((member) => (
                          <DocRow key={member.id} doc={member} active={member.id === selectedId} onSelect={onSelect} />
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div className="mem-isolation">
            <ShieldCheck size={14} />
            <span>群成员记忆只在该群内生效，和私聊、其他群完全隔离，不会串场。</span>
          </div>
        </div>
      </div>

      <div className="mem-tree__foot">
        <ShieldCheck size={13} />
        全部档案以 Markdown 落盘，只存在这台电脑上
      </div>
    </Card>
  );
}
