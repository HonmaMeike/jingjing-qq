import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlertTriangle, BookOpen, Clock, FileText, FolderOpen, MessageSquare, Pencil, Pin,
  RefreshCw, Save, ShieldCheck, Sparkles, Trash2, X,
} from 'lucide-react';
import type { MemoryReadResult } from '@shared/types';
import {
  Avatar, Badge, Button, Card, CopyButton, EmptyState, IconButton, MarkdownView,
  Spinner, Tabs, Textarea, cn,
} from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import MemoryFacts from '@/components/memory/MemoryFacts';
import RelationshipPanel from '@/components/memory/RelationshipPanel';
import { docScopeMeta } from '@/components/memory/meta';

type DocTab = 'doc' | 'facts' | 'relation';

interface Props {
  read: MemoryReadResult | null;
  loading: boolean;
  error: string | null;
  editing: boolean;
  draft: string;
  dirty: boolean;
  saving: boolean;
  forgettingId: string | null;
  onRetry: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onRefresh: () => void;
  onForget: (factId: string) => void;
  onRequestDelete: () => void;
  onOpenFolder: () => void;
}

function ViewerSkeleton() {
  return (
    <Card className="mem-viewer">
      <div className="mem-skeleton">
        <div className="mem-skeleton__head">
          <div className="skeleton mem-skeleton__avatar" />
          <div className="flex-1">
            <div className="skeleton mem-skeleton__title" />
            <div className="skeleton mem-skeleton__line" style={{ width: '58%' }} />
          </div>
        </div>
        <div className="skeleton mem-skeleton__bar" />
        {[92, 82, 96, 74, 88, 61].map((width, index) => (
          <div className="skeleton mem-skeleton__line" key={index} style={{ width: `${width}%`, marginTop: index === 0 ? 26 : 10 }} />
        ))}
      </div>
    </Card>
  );
}

export default function MemoryDocView(props: Props) {
  const {
    read, loading, error, editing, draft, dirty, saving, forgettingId,
    onRetry, onStartEdit, onCancelEdit, onDraftChange, onSave, onRefresh, onForget, onRequestDelete, onOpenFolder,
  } = props;
  const [tab, setTab] = useState<DocTab>('doc');

  useEffect(() => {
    setTab('doc');
  }, [read?.doc.id]);

  useEffect(() => {
    if (editing) setTab('doc');
  }, [editing]);

  if (loading && !read) return <ViewerSkeleton />;

  if (error && !read) {
    return (
      <Card className="mem-viewer mem-viewer--message">
        <div className="mem-doc-error">
          <AlertTriangle size={22} />
          <div className="mem-doc-error__title">这份记忆档案读取失败</div>
          <div className="mem-doc-error__desc">{error}</div>
          <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={onRetry}>重新读取</Button>
        </div>
      </Card>
    );
  }

  if (!read) {
    return (
      <Card className="mem-viewer mem-viewer--message">
        <EmptyState
          icon={<BookOpen size={22} />}
          title="选择一份记忆档案"
          desc="左侧是鲸鲸的记忆档案树：私聊联系人、群聊成员和她的自我档案各自独立成册。"
        />
      </Card>
    );
  }

  const { doc, markdown } = read;
  const scope = docScopeMeta(doc);
  const tabs: { value: DocTab; label: ReactNode; count?: number }[] = [
    { value: 'doc', label: '记忆文档' },
    { value: 'facts', label: '重要事实', count: doc.facts.length },
    { value: 'relation', label: '关系状态' },
  ];

  return (
    <Card className="mem-viewer">
      <div className="mem-viewer__head">
        <Avatar src={doc.avatar} name={doc.displayName} size="lg" ring />
        <div className="mem-viewer__identity">
          <div className="mem-viewer__title-row">
            <h2 className="mem-viewer__name">{doc.displayName}</h2>
            <Badge tone={scope.tone}>{scope.label}</Badge>
            {doc.groupName && <Badge tone="mint">群 · {doc.groupName}</Badge>}
            {doc.pinned && <Badge tone="warning"><Pin size={10} />置顶</Badge>}
            {editing && (dirty ? <Badge tone="warning">未保存</Badge> : <Badge tone="success">已同步</Badge>)}
          </div>
          <div className="mem-viewer__meta">
            <span title={formatDateTime(doc.updatedAt)}><Clock size={12} />{relativeTime(doc.updatedAt)}更新</span>
            <span><MessageSquare size={12} />{doc.messageCount} 条消息</span>
            <span><Sparkles size={12} />{doc.facts.length} 条事实</span>
            <span><BookOpen size={12} />{doc.episodeCount} 段共同经历</span>
          </div>
          {doc.tags.length > 0 && (
            <div className="mem-viewer__tags">
              {doc.tags.map((tag) => <span className="mem-tag" key={tag}>#{tag}</span>)}
            </div>
          )}
        </div>
        <div className="mem-viewer__actions">
          {editing ? (
            <>
              <Button variant="primary" size="sm" icon={<Save size={14} />} loading={saving} disabled={!dirty} onClick={onSave}>保存</Button>
              <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={onCancelEdit} disabled={saving}>取消</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={onStartEdit}>编辑</Button>
              <IconButton label="刷新这份档案" title="刷新这份档案" onClick={onRefresh} disabled={loading}>
                <RefreshCw size={15} className={cn(loading && 'spin')} />
              </IconButton>
              <IconButton label="删除这份档案" title="删除这份档案" onClick={onRequestDelete}>
                <Trash2 size={15} />
              </IconButton>
              <IconButton label="打开记忆文件夹" title="打开记忆文件夹" onClick={onOpenFolder}>
                <FolderOpen size={15} />
              </IconButton>
            </>
          )}
        </div>
      </div>

      <div className="mem-pathbar">
        <FileText size={12} />
        <code title={doc.filePath}>{doc.filePath}</code>
        <CopyButton text={doc.filePath} label="复制路径" />
      </div>

      <div className="mem-tabsbar">
        <Tabs value={tab} onChange={setTab} items={tabs} />
        <div className="mem-tabsbar__right">
          {loading && <Spinner label="同步中" />}
          <span className="mem-tabsbar__hint">最后写入 {formatDateTime(doc.updatedAt)}</span>
        </div>
      </div>

      <div className="mem-body">
        {tab === 'doc' && (
          <div className="mem-doc">
            <div className="callout callout--brand mem-doc-callout">
              <ShieldCheck size={15} className="callout__icon" />
              <span>{scope.hint}</span>
            </div>
            {editing ? (
              <>
                <div className="mem-edit-bar">
                  <Pencil size={14} />
                  <span>正在编辑 Markdown 原文，保存后会原子写回本地记忆文档。</span>
                  <span className="spacer" />
                  {dirty ? <Badge tone="warning">有未保存修改</Badge> : <Badge tone="success">内容一致</Badge>}
                </div>
                <Textarea
                  className="mem-editor"
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  spellCheck={false}
                  aria-label="记忆文档 Markdown 编辑器"
                />
              </>
            ) : (
              <MarkdownView text={markdown} className="mem-markdown" />
            )}
          </div>
        )}

        {tab === 'facts' && (
          <MemoryFacts facts={doc.facts} onForget={onForget} forgettingId={forgettingId} />
        )}

        {tab === 'relation' && <RelationshipPanel relationship={doc.relationship} />}
      </div>
    </Card>
  );
}
