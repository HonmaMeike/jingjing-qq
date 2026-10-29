import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Brain, FolderOpen, RefreshCw, Search, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import type { MemoryDoc, MemoryReadResult, MemorySearchHit, MemorySummary } from '@shared/types';
import { api, events } from '@/lib/api';
import { Button, Card, EmptyState, Field, IconButton, Input, Modal, PageHeader, Select, Spinner, useToast } from '@/components/ui';
import MemoryStats from '@/components/memory/MemoryStats';
import MemoryTree from '@/components/memory/MemoryTree';
import MemoryDocView from '@/components/memory/MemoryDocView';
import { pickInitialDoc } from '@/components/memory/meta';
import '@/styles/memory.css';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pickerLabel(doc: MemoryDoc): string {
  if (doc.scope === 'global' || doc.scope === 'persona') return `【自我】${doc.displayName}`;
  if (doc.scope === 'group') return `【群记忆】${doc.displayName}`;
  if (doc.groupId) return `【群 · ${doc.groupName ?? doc.groupId}】${doc.displayName}`;
  return doc.displayName;
}

export default function MemoryPage() {
  const toast = useToast();
  const [summary, setSummary] = useState<MemorySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [read, setRead] = useState<MemoryReadResult | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const docRequest = useRef(0);

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MemorySearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchRequest = useRef(0);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [forgettingId, setForgettingId] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingSelect, setPendingSelect] = useState<string | null>(null);

  const dirty = editing && read !== null && draft !== read.markdown;

  const loadDoc = useCallback(async (docId: string) => {
    const request = ++docRequest.current;
    setDocLoading(true);
    setDocError(null);
    try {
      const result = await api.memory.read(docId);
      if (docRequest.current !== request) return;
      setRead(result);
      setEditing(false);
      setDraft('');
    } catch (caught) {
      if (docRequest.current !== request) return;
      setRead(null);
      setDocError(errorMessage(caught));
    } finally {
      if (docRequest.current === request) setDocLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async (silent = false): Promise<MemorySummary | null> => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const next = await api.memory.summary();
      setSummary(next);
      setError(null);
      return next;
    } catch (caught) {
      const message = errorMessage(caught);
      if (silent) toast.error('刷新记忆库失败', message); else setError(message);
      return null;
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const next = await api.memory.summary();
        if (!alive) return;
        setSummary(next);
        setError(null);
        setSelectedId((prev) => prev ?? pickInitialDoc(next));
      } catch (caught) {
        if (alive) setError(errorMessage(caught));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = events.on('memory:update', () => {
        void api.memory.summary().then(setSummary).catch(() => undefined);
      });
    } catch {
      // 浏览器预览没有桌面桥接，忽略即可。
    }
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setRead(null);
      setDocLoading(false);
      return;
    }
    void loadDoc(selectedId);
  }, [selectedId, loadDoc]);

  useEffect(() => {
    if (!summary) return;
    if (selectedId && !(summary.docs ?? []).some((doc) => doc.id === selectedId)) {
      setSelectedId(pickInitialDoc(summary));
    }
  }, [summary, selectedId]);

  useEffect(() => {
    const keyword = query.trim();
    if (!keyword) {
      searchRequest.current += 1;
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const request = ++searchRequest.current;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(() => {
      void api.memory.search(keyword)
        .then((result) => {
          if (searchRequest.current !== request) return;
          setHits(result);
        })
        .catch((caught: unknown) => {
          if (searchRequest.current !== request) return;
          setHits([]);
          setSearchError(errorMessage(caught));
        })
        .finally(() => {
          if (searchRequest.current === request) setSearching(false);
        });
    }, 320);
    return () => clearTimeout(timer);
  }, [query]);

  const requestSelect = (docId: string) => {
    if (!docId || docId === selectedId) return;
    if (dirty) {
      setPendingSelect(docId);
      return;
    }
    setSelectedId(docId);
  };

  const handleRefreshAll = async () => {
    if (dirty) {
      toast.warning('还有未保存的修改', '先保存或取消编辑，再刷新记忆库');
      return;
    }
    const next = await loadSummary(true);
    if (next && selectedId && next.docs.some((doc) => doc.id === selectedId)) {
      await loadDoc(selectedId);
    }
  };

  const handleOpenFolder = async () => {
    try {
      await api.memory.openFolder();
    } catch (caught) {
      toast.error('无法打开记忆文件夹', errorMessage(caught));
    }
  };

  const handleSave = async () => {
    if (!read) return;
    setSaving(true);
    try {
      const result = await api.memory.save(read.doc.id, draft);
      setRead(result);
      setEditing(false);
      setDraft('');
      toast.success('记忆已保存', '已写回本地 Markdown 文档');
      void loadSummary(true);
    } catch (caught) {
      toast.error('保存失败', errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const handleForget = async (factId: string) => {
    if (!read) return;
    setForgettingId(factId);
    try {
      const result = await api.memory.forget(read.doc.id, factId);
      setRead(result);
      toast.success('已忘记这条事实', '它不会再出现在之后的对话上下文里');
      void loadSummary(true);
    } catch (caught) {
      toast.error('忘记失败', errorMessage(caught));
    } finally {
      setForgettingId(null);
    }
  };

  const handleDelete = async () => {
    if (!read) return;
    setDeleting(true);
    try {
      await api.memory.remove(read.doc.id);
      toast.success('记忆档案已删除', `「${read.doc.displayName}」的记忆与归档已移除`);
      setDeleteOpen(false);
      setRead(null);
      setEditing(false);
      setDraft('');
      const next = await api.memory.summary();
      setSummary(next);
      setSelectedId(pickInitialDoc(next));
    } catch (caught) {
      toast.error('删除失败', errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  };

  const confirmDiscard = () => {
    const next = pendingSelect;
    setPendingSelect(null);
    setEditing(false);
    setDraft('');
    if (next) setSelectedId(next);
  };

  const docs = summary?.docs ?? [];
  const hasDocs = docs.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="LONG-TERM MEMORY"
        icon={<Brain size={14} />}
        title="记忆库"
        desc="每个联系人一份独立的记忆文档，集中保存为本地 Markdown。群聊记忆单独成册，绝不会串场。"
        actions={(
          <>
            <Button variant="ghost" icon={<RefreshCw size={15} className={refreshing ? 'spin' : ''} />} onClick={() => void handleRefreshAll()} disabled={refreshing || loading}>
              刷新
            </Button>
            <Button variant="secondary" icon={<FolderOpen size={15} />} onClick={() => void handleOpenFolder()}>
              记忆文件夹
            </Button>
          </>
        )}
      />

      {loading ? (
        <>
          <MemoryStats summary={null} loading />
          <div className="mem-loading-layout">
            <div className="skeleton mem-loading-tree" />
            <div className="skeleton mem-loading-viewer" />
          </div>
        </>
      ) : error ? (
        <Card className="mem-page-message">
          <div className="mem-doc-error">
            <AlertTriangle size={24} />
            <div className="mem-doc-error__title">记忆库加载失败</div>
            <div className="mem-doc-error__desc">{error}</div>
            <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void loadSummary()}>重新加载</Button>
          </div>
        </Card>
      ) : (
        <>
          <MemoryStats summary={summary} loading={false} />

          {!hasDocs ? (
            <Card className="mem-page-message mem-empty-library">
              <EmptyState
                icon={<Sparkles size={24} />}
                title="记忆库还是空的"
                desc="鲸鲸还没有记住任何人。去「聊天」里说几句话，或者先打开记忆文件夹看看数据会落在哪里——每段关系都会有自己的独立档案。"
                action={(
                  <div className="row" style={{ justifyContent: 'center', marginTop: 6 }}>
                    <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={() => void handleRefreshAll()}>刷新看看</Button>
                    <Button variant="primary" icon={<FolderOpen size={15} />} onClick={() => void handleOpenFolder()}>打开记忆文件夹</Button>
                  </div>
                )}
              />
            </Card>
          ) : (
            <>
              <div className="mem-picker-wrap">
                <div className="mem-narrow-search">
                  <div className="mem-search">
                    <Search size={14} className="mem-search__icon" />
                    <Input
                      className="mem-search__input"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索记忆、事实或原话…"
                      aria-label="搜索记忆"
                    />
                    {query && (
                      <IconButton label="清空搜索" className="mem-search__clear" onClick={() => setQuery('')}>
                        <X size={14} />
                      </IconButton>
                    )}
                  </div>
                  {query.trim() && (
                    <div className="mem-narrow-hits">
                      {searching ? (
                        <Spinner label="检索中" />
                      ) : searchError ? (
                        <div className="mem-inline-error">{searchError}</div>
                      ) : hits.length === 0 ? (
                        <div className="mem-hits__empty">没有找到相关记忆，换个更短的关键词试试。</div>
                      ) : (
                        hits.slice(0, 8).map((hit, index) => (
                          <button type="button" key={`${hit.docId}-${index}`} className="mem-narrow-hit" onClick={() => requestSelect(hit.docId)}>
                            <span className="mem-narrow-hit__name">{hit.displayName}</span>
                            <span className="mem-narrow-hit__snippet">{hit.snippet}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                <Field label="切换记忆档案" hint="窄屏下用下拉切换，每份档案依然彼此隔离。">
                  <Select value={selectedId ?? ''} onChange={(event) => requestSelect(event.target.value)} aria-label="切换记忆档案">
                    <option value="">选择一份记忆档案</option>
                    {docs.map((doc) => <option key={doc.id} value={doc.id}>{pickerLabel(doc)}</option>)}
                  </Select>
                </Field>
              </div>

              <div className="mem-layout">
                <MemoryTree
                  summary={summary as MemorySummary}
                  selectedId={selectedId}
                  onSelect={requestSelect}
                  query={query}
                  onQueryChange={setQuery}
                  hits={hits}
                  searching={searching}
                  searchError={searchError}
                />
                <MemoryDocView
                  read={read}
                  loading={docLoading}
                  error={docError}
                  editing={editing}
                  draft={draft}
                  dirty={dirty}
                  saving={saving}
                  forgettingId={forgettingId}
                  onRetry={() => { if (selectedId) void loadDoc(selectedId); }}
                  onStartEdit={() => { setDraft(read?.markdown ?? ''); setEditing(true); }}
                  onCancelEdit={() => { setEditing(false); setDraft(''); }}
                  onDraftChange={setDraft}
                  onSave={() => void handleSave()}
                  onRefresh={() => { if (selectedId) void loadDoc(selectedId); }}
                  onForget={(factId) => void handleForget(factId)}
                  onRequestDelete={() => setDeleteOpen(true)}
                  onOpenFolder={() => void handleOpenFolder()}
                />
              </div>
            </>
          )}
        </>
      )}

      <Modal
        open={deleteOpen}
        onClose={() => { if (!deleting) setDeleteOpen(false); }}
        title="删除这份记忆档案？"
        desc="文档、摘要版本和原始消息归档会一起移除，且无法恢复。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>再想想</Button>
            <Button variant="danger" icon={<Trash2 size={14} />} loading={deleting} onClick={() => void handleDelete()}>确认删除</Button>
          </>
        )}
      >
        {read && (
          <div className="mem-confirm">
            <div className="mem-confirm__name">{read.doc.displayName}</div>
            <div className="mem-confirm__meta">
              {read.doc.facts.length} 条事实 · {read.doc.episodeCount} 段经历 · 最后更新 {new Date(read.doc.updatedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        )}
        <div className="callout callout--warning" style={{ marginTop: 14 }}>
          <AlertTriangle size={15} className="callout__icon" />
          <span>如果只是不想让某条信息再被想起，建议回档案里使用「忘记单条事实」，而不是整份删除。</span>
        </div>
      </Modal>

      <Modal
        open={pendingSelect !== null}
        onClose={() => setPendingSelect(null)}
        title="放弃未保存的修改？"
        desc="正在编辑的记忆还没有保存，切换档案会丢失这些修改。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setPendingSelect(null)}>继续编辑</Button>
            <Button variant="danger" onClick={confirmDiscard}>放弃并切换</Button>
          </>
        )}
      >
        <div className="callout callout--brand">
          <ShieldCheck size={15} className="callout__icon" />
          <span>磁盘上的记忆文档仍然是上一次保存的版本，这次修改不会写入。</span>
        </div>
      </Modal>
    </>
  );
}
