import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Heart, ImageOff, Images, RefreshCw, Search, Sparkles, Upload, X } from 'lucide-react';
import type { StickerItem, StickerMood, StickerOverview, StickerSettings } from '@shared/types';
import { api, events } from '@/lib/api';
import { normalizeAssetUrl } from '@/lib/assets';
import { useApp } from '@/app/AppProvider';
import {
  Badge, Button, Card, CardBody, EmptyState, IconButton, Input, Modal, PageHeader, Tabs, cn, useToast,
} from '@/components/ui';
import StickerStats from '@/components/stickers/StickerStats';
import StickerSettingsBar from '@/components/stickers/StickerSettingsBar';
import StickerCard from '@/components/stickers/StickerCard';
import StickerEditModal from '@/components/stickers/StickerEditModal';
import StickerPreviewModal from '@/components/stickers/StickerPreviewModal';
import {
  MAX_UPLOAD_BYTES, STICKER_MOOD_META, STICKER_MOOD_ORDER, STICKER_SOURCE_META,
  collectTags, formatFileSize, readFileAsDataUrl,
} from '@/components/stickers/meta';
import '@/styles/stickers.css';

type FilterKey = 'all' | 'favorite' | 'mine' | 'builtin';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface UploadDraft { dataUrl: string; name: string }

export default function StickerPage() {
  const { settings } = useApp();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [overview, setOverview] = useState<StickerOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [moodFilter, setMoodFilter] = useState<StickerMood | 'all'>('all');
  const [tagFilter, setTagFilter] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<StickerItem | null>(null);
  const [editing, setEditing] = useState<StickerItem | null>(null);
  const [upload, setUpload] = useState<UploadDraft | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StickerItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [settingsOverride, setSettingsOverride] = useState<StickerSettings | null>(null);

  const applyOverview = useCallback((next: StickerOverview) => {
    setOverview(next);
    setError(null);
    setPreview((previous) => (previous ? next.items.find((item) => item.id === previous.id) ?? null : previous));
    setEditing((previous) => (previous ? next.items.find((item) => item.id === previous.id) ?? null : previous));
  }, []);

  const load = useCallback(async (silent = false): Promise<boolean> => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const next = await api.stickers.overview();
      applyOverview(next);
      return true;
    } catch (caught) {
      const message = errorText(caught);
      if (silent) toast.error('刷新表情包库失败', message);
      else setError(message);
      return false;
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [applyOverview, toast]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = events.on('stickers:update', (next) => {
        applyOverview(next);
        setLoading(false);
      });
    } catch {
      // 浏览器预览没有桌面桥接时忽略。
    }
    return () => unsubscribe?.();
  }, [applyOverview]);

  const items = overview?.items ?? [];
  const tags = useMemo(() => collectTags(items, overview?.tags ?? []), [items, overview?.tags]);
  const itemCounts = useMemo(() => {
    let favorite = 0;
    let mine = 0;
    let builtin = 0;
    for (const item of items) {
      if (item.favorite) favorite += 1;
      if (item.source === 'generated' || item.source === 'collected') mine += 1;
      if (item.source === 'builtin') builtin += 1;
    }
    return { favorite, mine, builtin };
  }, [items]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return items
      .filter((item) => {
        if (filter === 'favorite' && !item.favorite) return false;
        if (filter === 'mine' && item.source !== 'generated' && item.source !== 'collected') return false;
        if (filter === 'builtin' && item.source !== 'builtin') return false;
        if (moodFilter !== 'all' && !(item.moods ?? []).includes(moodFilter)) return false;
        if (tagFilter !== 'all' && !(item.tags ?? []).includes(tagFilter)) return false;
        if (keyword) {
          const haystack = [item.name, item.description ?? '', ...(item.tags ?? [])].join(' ').toLowerCase();
          if (!haystack.includes(keyword)) return false;
        }
        return true;
      });
  }, [items, filter, moodFilter, tagFilter, query]);

  const patchItem = (updated: StickerItem) => {
    setOverview((previous) => {
      if (!previous) return previous;
      const nextItems = previous.items.map((item) => (item.id === updated.id ? updated : item));
      return {
        ...previous,
        items: nextItems,
        total: nextItems.length,
        favorites: nextItems.filter((item) => item.favorite).length,
        generated: nextItems.filter((item) => item.source === 'generated' || item.source === 'collected').length,
      };
    });
    setPreview((previous) => (previous?.id === updated.id ? updated : previous));
  };

  const prependItem = (item: StickerItem) => {
    setOverview((previous) => {
      if (!previous) return previous;
      const nextItems = [item, ...previous.items.filter((entry) => entry.id !== item.id)];
      return {
        ...previous,
        items: nextItems,
        total: nextItems.length,
        favorites: nextItems.filter((entry) => entry.favorite).length,
        generated: nextItems.filter((entry) => entry.source === 'generated' || entry.source === 'collected').length,
        todayGenerated: previous.todayGenerated + (item.source === 'generated' || item.source === 'collected' ? 1 : 0),
        lastCollectedAt: item.createdAt,
      };
    });
  };

  const toggleFavorite = async (item: StickerItem) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const updated = await api.stickers.update(item.id, { favorite: !item.favorite });
      if (!updated) {
        toast.warning('这张表情可能已经不在了', '刷新一下看看。');
        void load(true);
        return;
      }
      patchItem(updated);
      toast.success(updated.favorite ? '已放进最爱' : '已取消收藏', updated.name);
    } catch (caught) {
      toast.error('收藏操作失败', errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (item: StickerItem) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      const updated = await api.stickers.update(item.id, { enabled: !item.enabled });
      if (!updated) {
        toast.warning('这张表情可能已经不在了', '刷新一下看看。');
        void load(true);
        return;
      }
      patchItem(updated);
      toast.success(updated.enabled ? '表情已启用' : '表情已停用', updated.enabled ? '聊天和说说会重新挑到它。' : '它会留在库里，但不会被自动使用。');
    } catch (caught) {
      toast.error('切换启用状态失败', errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  const collect = async () => {
    if (collecting) return;
    setCollecting(true);
    try {
      const item = await api.stickers.collect();
      if (!item) {
        toast.warning('这次没有收到新表情', '需要 MiniMax Key，或她在设置里开启了自主收集。');
        return;
      }
      prependItem(item);
      toast.success('她收进了一张新表情', item.name + (item.source === 'generated' ? ' · 她自己画的' : ' · 她挑的'));
      void load(true);
    } catch (caught) {
      toast.error('自主收集失败', errorText(caught));
    } finally {
      setCollecting(false);
    }
  };

  const chooseFile = () => fileRef.current?.click();

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('只能上传图片', '支持 png / jpg / webp / gif。');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('图片太大了', '单张不能超过 8 MB，这张是 ' + formatFileSize(file.size) + '。');
      return;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const name = file.name.replace(/\.[^.]+$/, '').slice(0, 30) || '鲸鱼娘表情';
      setUpload({ dataUrl, name });
    } catch (caught) {
      toast.error('读取图片失败', errorText(caught));
    }
  };

  const deleteSticker = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const ok = await api.stickers.remove(deleteTarget.id);
      if (!ok) {
        toast.warning('没有删掉这张表情', '内置表情不能删除，可以改为停用。');
        return;
      }
      const removedId = deleteTarget.id;
      setOverview((previous) => {
        if (!previous) return previous;
        const nextItems = previous.items.filter((item) => item.id !== removedId);
        return { ...previous, items: nextItems, total: nextItems.length, favorites: nextItems.filter((item) => item.favorite).length, generated: nextItems.filter((item) => item.source === 'generated' || item.source === 'collected').length };
      });
      setDeleteTarget(null);
      setPreview(null);
      toast.success('表情已从库里移除');
    } catch (caught) {
      toast.error('删除失败', errorText(caught));
    } finally {
      setDeleting(false);
    }
  };

  const savedSettings = settingsOverride ?? settings.stickers;
  const resetFilters = () => {
    setFilter('all');
    setMoodFilter('all');
    setTagFilter('all');
    setQuery('');
  };
  const filtersActive = filter !== 'all' || moodFilter !== 'all' || tagFilter !== 'all' || Boolean(query.trim());

  return (
    <>
      <PageHeader
        eyebrow="STICKER SHELF"
        icon={<Images size={14} />}
        title="表情包库"
        desc="她会把喜欢的鲸鱼娘表情包收进来，在聊天和说说里自己挑一张。你也可以亲手收几张，教她什么时候用。"
        actions={(
          <>
            <Badge tone={overview?.autoCollect ? 'mint' : 'default'} dot>{overview?.autoCollect ? '自主收集开着' : '自主收集已关'}</Badge>
            <Button variant="ghost" icon={<RefreshCw size={14} className={refreshing ? 'spin' : ''} />} onClick={() => void load(true)} disabled={refreshing || loading}>刷新</Button>
            <Button variant="secondary" icon={<Upload size={15} />} onClick={chooseFile}>上传表情包</Button>
            <Button variant="primary" icon={<Sparkles size={15} />} loading={collecting} onClick={() => void collect()}>让她自己收集一张</Button>
          </>
        )}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="stk-file-input"
        onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void handleFile(file); }}
      />

      {loading ? (
        <div className="stk-skeleton">
          <div className="stk-skeleton__stats">{[0, 1, 2, 3].map((index) => <div className="skeleton" key={index} />)}</div>
          <div className="skeleton stk-skeleton__settings" />
          <div className="stk-skeleton__grid">{[0, 1, 2, 3, 4, 5, 6, 7].map((index) => <div className="skeleton" key={index} />)}</div>
        </div>
      ) : error && !overview ? (
        <Card className="stk-error">
          <div className="stk-error__inner">
            <AlertTriangle size={24} />
            <div className="stk-error__title">表情册暂时翻不开</div>
            <div className="stk-error__desc">{error}</div>
            <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void load(false)}>重新加载</Button>
          </div>
        </Card>
      ) : overview ? (
        <>
          <StickerStats overview={overview} loading={false} />

          {error && (
            <div className="stk-inline-error">
              <AlertTriangle size={13} />
              <span>{error}</span>
              <Button variant="ghost" size="sm" onClick={() => void load(true)}>重试</Button>
            </div>
          )}

          <StickerSettingsBar
            settings={savedSettings}
            onSaved={(next) => {
              setSettingsOverride(next);
              setOverview((previous) => (previous ? { ...previous, autoCollect: next.autoCollect } : previous));
            }}
          />

          <Card className="stk-toolbar">
            <div className="stk-toolbar__top">
              <Tabs<FilterKey>
                value={filter}
                onChange={setFilter}
                items={[
                  { value: 'all', label: '全部', count: items.length },
                  { value: 'favorite', label: '收藏', count: itemCounts.favorite },
                  { value: 'mine', label: '她收集的', count: itemCounts.mine },
                  { value: 'builtin', label: '内置', count: itemCounts.builtin },
                ]}
              />
              <div className="stk-search">
                <Search size={14} className="stk-search__icon" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名字、标签或描述…" aria-label="搜索表情包" />
                {query && <IconButton label="清空搜索" className="stk-search__clear" onClick={() => setQuery('')}><X size={14} /></IconButton>}
              </div>
            </div>
            <div className="stk-toolbar__filters">
              <div className="stk-filter-row">
                <span className="stk-filter-label">心情</span>
                <button type="button" className={cn('stk-filter', moodFilter === 'all' && 'is-active')} onClick={() => setMoodFilter('all')}>全部</button>
                {STICKER_MOOD_ORDER.map((mood) => {
                  const meta = STICKER_MOOD_META[mood];
                  return (
                    <button
                      type="button"
                      key={mood}
                      className={cn('stk-filter', moodFilter === mood && 'is-active')}
                      style={moodFilter === mood ? { color: meta.color, borderColor: 'color-mix(in srgb, ' + meta.color + ' 34%, transparent)' } : undefined}
                      onClick={() => setMoodFilter(moodFilter === mood ? 'all' : mood)}
                    >
                      <i style={{ background: meta.color }} />{meta.label}
                    </button>
                  );
                })}
              </div>
              {tags.length > 0 && (
                <div className="stk-filter-row">
                  <span className="stk-filter-label">标签</span>
                  <button type="button" className={cn('stk-filter', tagFilter === 'all' && 'is-active')} onClick={() => setTagFilter('all')}>全部</button>
                  {tags.slice(0, 14).map((tag) => (
                    <button type="button" key={tag} className={cn('stk-filter', tagFilter === tag && 'is-active')} onClick={() => setTagFilter(tagFilter === tag ? 'all' : tag)}>#{tag}</button>
                  ))}
                </div>
              )}
              {filtersActive && <Button variant="ghost" size="sm" icon={<X size={12} />} onClick={resetFilters}>清除筛选</Button>}
            </div>
          </Card>

          <div className="stk-result-head">
            <span><Images size={13} />{filtered.length} 张表情</span>
            {overview.lastCollectedAt && <span className="dim text-xs">最近收集 {new Date(overview.lastCollectedAt).toLocaleString('zh-CN')}</span>}
          </div>

          {items.length === 0 ? (
            <Card className="stk-section-card">
              <EmptyState
                icon={<ImageOff size={23} />}
                title="表情册还是空的"
                desc="上传一张你的鲸鱼娘表情，或者让她自己画一张。之后她会在聊天和说说里按心情自己挑。"
                action={(
                  <div className="row" style={{ justifyContent: 'center' }}>
                    <Button variant="secondary" icon={<Upload size={14} />} onClick={chooseFile}>上传表情包</Button>
                    <Button variant="primary" icon={<Sparkles size={14} />} loading={collecting} onClick={() => void collect()}>让她自己收集一张</Button>
                  </div>
                )}
              />
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="stk-section-card">
              <EmptyState
                icon={<Search size={22} />}
                title="没有找到匹配的表情"
                desc="换一个关键词，或者清掉心情/标签筛选再看看。"
                action={<Button variant="secondary" icon={<X size={13} />} onClick={resetFilters}>清除筛选</Button>}
              />
            </Card>
          ) : (
            <div className="stk-grid">
              {filtered.map((item) => (
                <StickerCard
                  key={item.id}
                  item={item}
                  busy={busyId === item.id}
                  onPreview={setPreview}
                  onFavorite={(next) => void toggleFavorite(next)}
                  onToggleEnabled={(next) => void toggleEnabled(next)}
                  onEdit={(next) => { setPreview(null); setEditing(next); }}
                  onDelete={(next) => { setPreview(null); setDeleteTarget(next); }}
                />
              ))}
            </div>
          )}
        </>
      ) : null}

      <StickerPreviewModal
        item={preview}
        busy={Boolean(busyId)}
        onClose={() => setPreview(null)}
        onFavorite={(item) => void toggleFavorite(item)}
        onToggleEnabled={(item) => void toggleEnabled(item)}
        onEdit={(item) => { setPreview(null); setEditing(item); }}
        onDelete={(item) => { setPreview(null); setDeleteTarget(item); }}
      />

      <StickerEditModal
        open={Boolean(editing) || Boolean(upload)}
        mode={editing ? 'edit' : 'upload'}
        item={editing}
        dataUrl={upload?.dataUrl}
        defaultName={upload?.name}
        onClose={() => { setEditing(null); setUpload(null); }}
        onSaved={(saved) => {
          if (editing) patchItem(saved);
          else prependItem(saved);
          setEditing(null);
          setUpload(null);
          void load(true);
        }}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        title="把这张表情移出库？"
        desc="删除后她不会再在聊天和说说里挑到它；已发送出去的消息不受影响。"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
            <Button variant="danger" loading={deleting} onClick={() => void deleteSticker()}>确认删除</Button>
          </>
        )}
      >
        {deleteTarget && (
          <div className="stk-confirm">
            <div className="stk-confirm__thumb">
              {deleteTarget.url ? <img src={normalizeAssetUrl(deleteTarget.url)} alt={deleteTarget.name} /> : <ImageOff size={20} />}
            </div>
            <div>
              <div className="stk-confirm__name">{deleteTarget.name}</div>
              <div className="stk-confirm__meta">{STICKER_SOURCE_META[deleteTarget.source]?.label} · 被用过 {deleteTarget.useCount} 次</div>
            </div>
          </div>
        )}
        <div className="callout callout--warning" style={{ marginTop: 12 }}>
          <AlertTriangle size={15} className="callout__icon" />
          <span>内置表情不能删除。如果只是暂时不想用，可以改成「停用」，它仍会留在库里。</span>
        </div>
        <div className="stk-confirm__note"><Heart size={12} />删除不可撤销，但不会影响已经收藏在聊天里的旧消息。</div>
      </Modal>
    </>
  );
}
