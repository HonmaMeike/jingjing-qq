import { useState } from 'react';
import { AlertTriangle, GraduationCap, Link2, Loader2, Sparkles } from 'lucide-react';
import type { LearningNote } from '@shared/types';
import { Badge, Button, Card, CardBody, CardHead, EmptyState, Input } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';

interface Props {
  notes: LearningNote[];
  loading: boolean;
  error: string | null;
  learning: boolean;
  lastError: string | null;
  onLearn: (topic: string) => void;
  onRetry: () => void;
  onOpen: (url: string) => void;
}

export default function LearningNotes({ notes, loading, error, learning, lastError, onLearn, onRetry, onOpen }: Props) {
  const [topic, setTopic] = useState('');

  return (
    <div className="gro-learn">
      <Card className="gro-compose">
        <CardHead
          title={<><span className="gro-mini__icon is-amber"><GraduationCap size={14} /></span>让她学点新东西</>}
          desc="她会上网查资料，把学到的内容整理成笔记，也会写上来源。"
        />
        <CardBody>
          <div className="gro-compose__row">
            <Input
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !learning) onLearn(topic); }}
              placeholder="想让她研究什么？留空就按她最近的兴趣自己挑…"
              aria-label="学习主题"
              maxLength={80}
            />
            <Button variant="primary" icon={<Sparkles size={15} />} loading={learning} onClick={() => onLearn(topic)}>开始学习</Button>
          </div>
          {lastError && (
            <div className="callout callout--warning" style={{ marginTop: 12 }}>
              <AlertTriangle size={15} className="callout__icon" />
              <span>{lastError}</span>
            </div>
          )}
          {learning && (
            <div className="gro-learning-hint"><Loader2 size={13} className="spin" />她正在搜索、筛选来源并整理成笔记，可能需要十几秒。</div>
          )}
        </CardBody>
      </Card>

      {error && (
        <div className="gro-inline-error">
          <AlertTriangle size={13} />
          <span className="flex-1">{error}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>重试</Button>
        </div>
      )}

      {loading && notes.length === 0 ? (
        <div className="gro-learn-grid">
          {[0, 1, 2].map((index) => (
            <Card key={index} className="gro-note">
              <div style={{ padding: 18 }}>
                <div className="skeleton" style={{ height: 14, width: '52%' }} />
                <div className="skeleton" style={{ height: 10, width: '88%', marginTop: 14 }} />
                <div className="skeleton" style={{ height: 10, width: '94%', marginTop: 8 }} />
                <div className="skeleton" style={{ height: 10, width: '76%', marginTop: 8 }} />
              </div>
            </Card>
          ))}
        </div>
      ) : notes.length === 0 ? (
        <Card className="gro-section-card">
          <EmptyState
            icon={<GraduationCap size={23} />}
            title="还没有学习笔记"
            desc="当她遇到好奇的问题，会自己去查、去想，然后写成一页笔记。你也可以直接给她一个主题。"
            action={<Button variant="secondary" icon={<Sparkles size={15} />} loading={learning} onClick={() => onLearn('')}>按兴趣学一篇</Button>}
          />
        </Card>
      ) : (
        <div className="gro-learn-grid">
          {notes.map((note) => (
            <Card key={note.id} className="gro-note" hover>
              <div className="gro-note__head">
                <span className="gro-note__topic">{note.topic}</span>
                <Badge tone="warning">{relativeTime(note.createdAt)}</Badge>
              </div>
              <p className="gro-note__summary">{note.summary}</p>
              {note.points.length > 0 && (
                <ol className="gro-note__points">
                  {note.points.map((point, index) => <li key={`${index}-${point.slice(0, 6)}`}>{point}</li>)}
                </ol>
              )}
              {note.sources.length > 0 && (
                <div className="gro-note__sources">
                  <span className="gro-note__sources-label"><Link2 size={12} />来源</span>
                  {note.sources.map((source, index) => (
                    <button type="button" key={`${index}-${source.url}`} className="gro-source" onClick={() => onOpen(source.url)} title={source.url}>
                      {source.title || source.url}
                    </button>
                  ))}
                </div>
              )}
              <div className="gro-note__foot">
                <span className="dim text-xs">{formatDateTime(note.createdAt)}</span>
                <Button variant="ghost" size="sm" loading={learning} onClick={() => onLearn('')} icon={<Sparkles size={12} />} title="按兴趣再学一篇">再学一篇</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
