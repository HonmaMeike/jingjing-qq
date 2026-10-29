import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Image as ImageIcon, Music, RefreshCw, Video, Sparkles, Clapperboard } from 'lucide-react';
import { Badge, Button, Card, CardBody, EmptyState, PageHeader, Spinner, cn } from '@/components/ui';
import { api } from '@/lib/api';
import type { CreationItem } from '@shared/types';
import '@/styles/chat.css';

const TABS: { key: 'all' | CreationItem['kind']; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音乐' },
  { key: 'voice', label: '语音' },
];

function kindIcon(kind: CreationItem['kind']) {
  if (kind === 'video') return <Video size={14} />;
  if (kind === 'audio' || kind === 'voice') return <Music size={14} />;
  return <ImageIcon size={14} />;
}

export default function CreativeLibraryPage() {
  const [items, setItems] = useState<CreationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | CreationItem['kind']>('all');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.media.creations());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => items.filter((item) => tab === 'all' || item.kind === tab), [items, tab]);
  const images = filtered.filter((item) => item.kind === 'image');
  const videos = filtered.filter((item) => item.kind === 'video');
  const audios = filtered.filter((item) => item.kind === 'audio' || item.kind === 'voice');

  return (
    <>
      <PageHeader
        eyebrow="CREATIVE ARCHIVE"
        icon={<Clapperboard size={14} />}
        title="创作库"
        desc="她为你画的图、拍的视频、唱的歌和说过的话，都收在这里。"
        actions={<Button variant="secondary" icon={<RefreshCw size={15} className={loading ? 'spin' : ''} />} onClick={() => void load()} disabled={loading}>刷新</Button>}
      />
      <div className="stg-tabs" style={{ marginBottom: 16 }}>
        {TABS.map((item) => (
          <button key={item.key} className={cn('stg-tab', tab === item.key && 'is-active')} onClick={() => setTab(item.key)}>
            {item.label}<span className="dim">{item.key === 'all' ? items.length : items.filter((x) => x.kind === item.key).length}</span>
          </button>
        ))}
      </div>
      {loading ? <Card><CardBody><div style={{ display: 'grid', placeItems: 'center', minHeight: 260 }}><Spinner /></div></CardBody></Card> : error ? (
        <Card><CardBody><EmptyState icon={<Sparkles size={24} />} title="创作库读取失败" desc={error} /></CardBody></Card>
      ) : filtered.length === 0 ? (
        <Card><CardBody><EmptyState icon={<Sparkles size={24} />} title="还没有创作" desc="让她画一张图、唱一首歌，或者发一段语音，这里就会留下记录。" /></CardBody></Card>
      ) : (
        <div className="cr-library">
          {images.length > 0 && <section><h3 className="cr-section-title">图片 · {images.length}</h3><div className="cr-grid">{images.map((item) => <Card key={item.id} className="cr-card" hover><img src={item.url} alt={item.name} loading="lazy" /><div className="cr-card__body"><span className="truncate">{item.name}</span><a href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a></div></Card>)}</div></section>}
          {videos.length > 0 && <section><h3 className="cr-section-title">视频 · {videos.length}</h3><div className="cr-grid">{videos.map((item) => <Card key={item.id} className="cr-card" hover><video src={item.url} controls preload="metadata" /><div className="cr-card__body"><span className="truncate">{item.name}</span><a href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a></div></Card>)}</div></section>}
          {audios.length > 0 && <section><h3 className="cr-section-title">音乐与语音 · {audios.length}</h3><div className="cr-audio-list">{audios.map((item) => <Card key={item.id}><CardBody><div className="cr-audio-row"><Badge tone="mint">{kindIcon(item.kind)}{item.kind === 'voice' ? '语音' : '音乐'}</Badge><span className="truncate">{item.name}</span><span className="dim">{new Date(item.createdAt).toLocaleString()}</span><audio src={item.url} controls preload="none" /></div></CardBody></Card>)}</div></section>}
        </div>
      )}
    </>
  );
}
