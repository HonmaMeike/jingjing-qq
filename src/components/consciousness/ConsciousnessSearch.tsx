import { Search, X, Sparkles, AlertTriangle } from 'lucide-react';
import type { SeaPoint } from '@shared/types';
import { Badge, Button, Card, CardBody, CardHead, IconButton, Input, Spinner } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import { SEA_DEPTH_META, SEA_KIND_META } from '@/components/consciousness/meta';

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onClear: () => void;
  searching: boolean;
  searched: boolean;
  results: SeaPoint[];
  error: string | null;
  onPick: (point: SeaPoint) => void;
}

/** 后端没有返回分值，按命中顺序给出可解释的相关度展示。 */
function relevanceOf(index: number, total: number): number {
  if (total <= 1) return 100;
  return Math.max(35, Math.round(100 - (index * 60) / (total - 1)));
}

export default function ConsciousnessSearch(props: Props) {
  const { query, onQueryChange, onSearch, onClear, searching, searched, results, error, onPick } = props;
  const showPanel = searched || searching || Boolean(error);

  return (
    <Card className="cs-search">
      <CardHead
        title={<><span className="cs-search__icon"><Search size={14} /></span>在识海里打捞一段记忆</>}
        desc="搜索她经历过的片段、原话、日记与学习笔记；命中的点会在下方星图中亮起来。"
        extra={<Badge tone="brand">全文检索</Badge>}
      />
      <CardBody>
        <div className="cs-search__bar">
          <Search size={15} className="cs-search__bar-icon" />
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onSearch(); }}
            placeholder="比如：白饭、加班、第一次、说好…"
            aria-label="搜索识海记忆"
          />
          {query && <IconButton label="清空搜索" onClick={onClear}><X size={14} /></IconButton>}
          <Button variant="primary" icon={<Search size={14} />} loading={searching} onClick={onSearch} disabled={!query.trim()}>搜索</Button>
        </div>

        {showPanel && (
          <div className="cs-search__results">
            <div className="cs-search__results-head">
              <span><Sparkles size={12} />{searching ? '正在打捞…' : `命中 ${results.length} 个记忆点`}</span>
              <span className="dim">按后端命中顺序展示{results.length > 0 ? ' · 相关度为顺序估算' : ''}</span>
            </div>

            {error && (
              <div className="cs-search__error">
                <AlertTriangle size={14} />
                <span>{error}</span>
                <Button variant="ghost" size="sm" onClick={onSearch}>重试</Button>
              </div>
            )}

            {!error && searching && results.length === 0 && (
              <div className="cs-search__loading">
                <Spinner label="正在潜下去看看…" />
              </div>
            )}

            {!error && !searching && searched && results.length === 0 && (
              <div className="cs-search__empty">
                <Search size={19} />
                <div>没有打捞到和「{query.trim()}」有关的记忆</div>
                <span>换个更短的关键词，或者试试她更容易记住的词：白饭、晚安、公园、第一次。</span>
              </div>
            )}

            {results.length > 0 && (
              <div className="cs-search__grid">
                {results.map((point, index) => {
                  const kind = SEA_KIND_META[point.kind] ?? SEA_KIND_META.episode;
                  const depth = SEA_DEPTH_META[point.depth] ?? SEA_DEPTH_META.surface;
                  const relevance = relevanceOf(index, results.length);
                  return (
                    <button type="button" key={point.id} className="cs-hit" onClick={() => onPick(point)}>
                      <span className="cs-hit__rank">{String(index + 1).padStart(2, '0')}</span>
                      <span className="cs-hit__body">
                        <span className="cs-hit__top">
                          <span className="cs-hit__title">{point.title || '一段记忆'}</span>
                          <span className="cs-hit__kind" style={{ color: kind.color }}>{kind.label}</span>
                          <span className="cs-hit__depth" style={{ color: depth.color }}>{depth.label}</span>
                        </span>
                        <span className="cs-hit__text">{point.text}</span>
                        <span className="cs-hit__meta">
                          <span>{formatDateTime(point.at)}</span>
                          <span>被想起 {point.accessCount} 次</span>
                          <span className="cs-hit__relevance">
                            <i style={{ width: relevance + '%' }} />
                            <em>相关度 {relevance}</em>
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
