import { useMemo } from 'react';
import { AlertTriangle, CalendarDays, Lock, PenLine, RefreshCw, Sparkles } from 'lucide-react';
import type { DiaryEntry } from '@shared/types';
import { Badge, Button, Card, CopyButton, EmptyState, MarkdownView, cn } from '@/components/ui';
import { formatDate, moodTone, relativeTime } from '@/lib/format';
import MediaImage from '@/components/growth/MediaImage';
import { sortByTimeDesc, stripMarkdown } from '@/components/growth/meta';

interface Props {
  entries: DiaryEntry[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  writing: boolean;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onWrite: () => void;
}

function RowSkeleton() {
  return (
    <div className="gro-skeleton-row">
      <div className="skeleton" style={{ width: 10, height: 10, borderRadius: '50%' }} />
      <div className="flex-1">
        <div className="skeleton" style={{ height: 12, width: '52%' }} />
        <div className="skeleton" style={{ height: 10, width: '84%', marginTop: 8 }} />
      </div>
    </div>
  );
}

export default function DiaryTimeline({ entries, loading, error, selectedId, writing, onSelect, onRetry, onWrite }: Props) {
  const sorted = useMemo(() => sortByTimeDesc(entries), [entries]);
  const selected = sorted.find((entry) => entry.id === selectedId) ?? sorted[0];

  if (error && sorted.length === 0) {
    return (
      <Card className="gro-section-card">
        <div className="gro-error">
          <AlertTriangle size={22} />
          <div className="gro-error__title">日记本暂时打不开</div>
          <div className="gro-error__desc">{error}</div>
          <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={onRetry}>重新读取</Button>
        </div>
      </Card>
    );
  }

  if (loading && sorted.length === 0) {
    return (
      <div className="gro-diary">
        <Card className="gro-diary__list">
          <div className="gro-list-head">
            <div><div className="gro-list-title">日记时间线</div><div className="gro-list-sub">正在翻阅她的日记本…</div></div>
          </div>
          <div className="gro-diary__list-body">
            {[0, 1, 2, 3, 4].map((index) => <RowSkeleton key={index} />)}
          </div>
        </Card>
        <Card className="gro-diary__reader">
          <div className="gro-reader-skeleton">
            <div className="skeleton" style={{ height: 13, width: '34%' }} />
            <div className="skeleton" style={{ height: 24, width: '62%', marginTop: 14 }} />
            <div className="skeleton" style={{ height: 11, width: '100%', marginTop: 24 }} />
            <div className="skeleton" style={{ height: 11, width: '92%', marginTop: 10 }} />
            <div className="skeleton" style={{ height: 11, width: '96%', marginTop: 10 }} />
          </div>
        </Card>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <Card className="gro-section-card">
        <EmptyState
          icon={<PenLine size={23} />}
          title="日记本还是空的"
          desc="她会在睡前把当天的心情、对话里的小事和想对你说的话写成日记。现在就让她写第一篇吧。"
          action={<Button variant="primary" icon={<PenLine size={15} />} loading={writing} onClick={onWrite}>现在写日记</Button>}
        />
      </Card>
    );
  }

  return (
    <div className="gro-diary">
      <Card className="gro-diary__list">
        <div className="gro-list-head">
          <div>
            <div className="gro-list-title">日记时间线<Badge tone="pink">{sorted.length} 篇</Badge></div>
            <div className="gro-list-sub">她写给自己，也留给你的记录</div>
          </div>
          <Button size="sm" variant="secondary" icon={<PenLine size={13} />} loading={writing} onClick={onWrite}>写一篇</Button>
        </div>
        {error && (
          <div className="gro-inline-error" style={{ margin: '0 12px 8px' }}>
            <AlertTriangle size={13} />
            <span className="flex-1">{error}</span>
            <Button variant="ghost" size="sm" icon={<RefreshCw size={12} />} onClick={onRetry}>重试</Button>
          </div>
        )}
        <div className="gro-diary__list-body">
          <div className="gro-timeline">
            {sorted.map((entry) => {
              const tone = moodTone(entry.mood);
              return (
                <button
                  type="button"
                  key={entry.id}
                  className={cn('gro-diary-item', selected?.id === entry.id && 'is-active', `is-${tone}`)}
                  onClick={() => onSelect(entry.id)}
                >
                  <span className="gro-diary-item__node" />
                  <span className="gro-diary-item__body">
                    <span className="gro-diary-item__date">
                      {formatDate(entry.date || entry.createdAt)}
                      <span className="dim"> · {relativeTime(entry.createdAt)}</span>
                    </span>
                    <span className="gro-diary-item__title">
                      <span className="gro-diary-item__emoji">{entry.moodEmoji || '🐋'}</span>
                      <span className="truncate">{entry.title}</span>
                    </span>
                    <span className="gro-diary-item__snippet">{stripMarkdown(entry.content, 64)}</span>
                    <span className="gro-diary-item__meta">
                      <span className="gro-diary-item__mood">{entry.mood}</span>
                      {entry.highlights.length > 0 && <span className="dim">高光 {entry.highlights.length}</span>}
                      {entry.private && <Lock size={10} className="dim" />}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      <Card className="gro-diary__reader">
        {selected ? (
          <div className="gro-reader">
            <div className="gro-reader__head">
              <div className="gro-reader__date">
                <CalendarDays size={13} />
                {formatDate(selected.date || selected.createdAt)}
                <span className="dim">· {relativeTime(selected.createdAt)}</span>
              </div>
              <h2 className="gro-reader__title">{selected.title}</h2>
              <div className="gro-reader__chips">
                <Badge tone={moodTone(selected.mood) === 'good' ? 'success' : moodTone(selected.mood) === 'bad' ? 'danger' : 'default'}>
                  {selected.moodEmoji} {selected.mood}
                </Badge>
                {selected.private && <Badge tone="warning"><Lock size={10} />仅自己可见</Badge>}
                <span className="spacer" />
                <CopyButton text={selected.content} label="复制全文" />
              </div>
            </div>

            <MarkdownView text={selected.content} className="gro-reader__content" />

            {selected.highlights.length > 0 && (
              <div className="gro-reader__highlights">
                <div className="gro-reader__section-title"><Sparkles size={13} />今天的高光</div>
                <div className="gro-reader__chips">
                  {selected.highlights.map((highlight, index) => (
                    <span className="gro-highlight-chip" key={`${index}-${highlight.slice(0, 6)}`}>{highlight}</span>
                  ))}
                </div>
              </div>
            )}

            {selected.images.length > 0 && (
              <div className="gro-reader__images">
                {selected.images.map((image, index) => (
                  <MediaImage key={`${index}-${image.slice(0, 12)}`} src={image} alt={selected.title} className="gro-reader__image" />
                ))}
              </div>
            )}
          </div>
        ) : (
          <EmptyState icon={<PenLine size={22} />} title="选择一篇日记" desc="左侧时间线里点一篇，就能读到她那天的完整记录。" />
        )}
      </Card>
    </div>
  );
}
