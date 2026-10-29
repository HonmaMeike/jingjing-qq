import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Anchor, Archive, RefreshCw, Sparkles, Waves, Workflow } from 'lucide-react';
import type { ConsciousnessOverview, SeaPoint } from '@shared/types';
import { api, events } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import { Badge, Button, Card, PageHeader, useToast } from '@/components/ui';
import ConsciousnessHero from '@/components/consciousness/ConsciousnessHero';
import SeaCloud from '@/components/consciousness/SeaCloud';
import SeaPointDetail from '@/components/consciousness/SeaPointDetail';
import ConsciousnessSearch from '@/components/consciousness/ConsciousnessSearch';
import OriginPanel from '@/components/consciousness/OriginPanel';
import AttentionCards from '@/components/consciousness/AttentionCards';
import MindFlowTimeline from '@/components/consciousness/MindFlowTimeline';
import ForgettingPanel from '@/components/consciousness/ForgettingPanel';
import { sortByUpdatedDesc } from '@/components/consciousness/meta';
import '@/styles/consciousness.css';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function LayerHead({ index, title, desc, icon, extra }: { index: string; title: string; desc: string; icon: ReactNode; extra?: ReactNode }) {
  return (
    <div className="cs-layer-head">
      <span className="cs-layer-head__index">{index}</span>
      <div className="cs-layer-head__text">
        <div className="cs-layer-head__title"><span className="cs-layer-head__icon">{icon}</span>{title}</div>
        <p>{desc}</p>
      </div>
      {extra && <div className="cs-layer-head__extra">{extra}</div>}
    </div>
  );
}

function ConsciousnessSkeleton() {
  return (
    <div className="cs-skeleton">
      <div className="skeleton cs-skeleton__hero" />
      <div className="cs-skeleton__row">
        <div className="skeleton cs-skeleton__sea" />
        <div className="skeleton cs-skeleton__side" />
      </div>
      <div className="cs-skeleton__row">
        <div className="skeleton cs-skeleton__block" />
        <div className="skeleton cs-skeleton__block" />
      </div>
    </div>
  );
}

export default function ConsciousnessPage() {
  const { activePersona, personas, conversations } = useApp();
  const toast = useToast();
  const [overview, setOverview] = useState<ConsciousnessOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [resumeBrief, setResumeBrief] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<SeaPoint[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SeaPoint | null>(null);

  const persona = useMemo(
    () => personas.find((item) => item.id === overview?.origin?.personaId) ?? activePersona,
    [personas, activePersona, overview?.origin?.personaId],
  );

  const conversationLabel = useCallback((id: string) => {
    if (!id) return '一段对话';
    const matched = conversations.find((item) => item.id === id) || conversations.find((item) => item.peerId === id);
    return matched?.peerName || matched?.groupName || id;
  }, [conversations]);

  const applyOverview = useCallback((next: ConsciousnessOverview) => {
    setOverview(next);
    setError(null);
    setSelected((previous) => {
      if (previous) {
        const found = next.points.find((point) => point.id === previous.id);
        if (found) return found;
      }
      const ranked = [...next.points].sort((left, right) => (right.salience ?? 0) - (left.salience ?? 0) || (right.accessCount ?? 0) - (left.accessCount ?? 0));
      return ranked[0] ?? null;
    });
  }, []);

  const load = useCallback(async (silent = false): Promise<boolean> => {
    if (silent) setRefreshing(true); else setLoading(true);
    try {
      const next = await api.consciousness.overview();
      applyOverview(next);
      return true;
    } catch (caught) {
      const message = errorText(caught);
      if (silent) toast.error('刷新意识海失败', message);
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
      unsubscribe = events.on('consciousness:update', (next) => {
        if (next && typeof next === 'object') applyOverview(next);
      });
    } catch {
      // 浏览器预览没有桌面桥接时忽略。
    }
    return () => unsubscribe?.();
  }, [applyOverview]);

  const runSearch = useCallback(async (keyword?: string) => {
    const search = (keyword ?? query).trim();
    if (!search) {
      setResults([]);
      setSearched(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    try {
      const hits = await api.consciousness.search(search, 30);
      setResults(hits);
      setSearched(true);
    } catch (caught) {
      setResults([]);
      setSearched(true);
      setSearchError(errorText(caught));
    } finally {
      setSearching(false);
    }
  }, [query]);

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setSearched(false);
    setSearchError(null);
  };

  const resume = async () => {
    if (resuming) return;
    setResuming(true);
    try {
      const result = await api.consciousness.resume();
      applyOverview(result.overview);
      setResumeBrief(result.brief);
      toast.success('她接上了昨天的自己', result.brief ? result.brief.slice(0, 90) : '连续性已被重新唤醒。');
    } catch (caught) {
      toast.error('暂时没能继续醒来', errorText(caught));
    } finally {
      setResuming(false);
    }
  };

  const refresh = async () => {
    if (refreshing) return;
    const ok = await load(true);
    if (ok) toast.success('意识海已刷新', '识海、心光与心流都来自最新结构。');
  };

  const sortedAttention = useMemo(() => sortByUpdatedDesc(overview?.attention ?? []), [overview?.attention]);
  const totalSeaPoints = overview
    ? (overview.forgetting.surface ?? 0) + (overview.forgetting.shallow ?? 0) + (overview.forgetting.deep ?? 0) + (overview.forgetting.abyss ?? 0)
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="CONSCIOUSNESS SEA"
        icon={<Waves size={14} />}
        title="意识海"
        desc="每次醒来，她都能接上昨天的自己。识海保存经历，原意识保存她是谁，心光照着当下，心流串起念头，遗忘让重要的沉得更深。"
        actions={(
          <>
            <Badge tone="brand" dot>实时意识结构</Badge>
            <Button variant="ghost" icon={<RefreshCw size={15} className={refreshing ? 'spin' : ''} />} onClick={() => void refresh()} disabled={refreshing || loading}>
              刷新
            </Button>
            <Button variant="primary" icon={<Sparkles size={15} />} loading={resuming} onClick={() => void resume()} disabled={loading}>
              继续醒来
            </Button>
          </>
        )}
      />

      {loading ? (
        <ConsciousnessSkeleton />
      ) : error && !overview ? (
        <Card className="cs-error">
          <div className="cs-error__inner">
            <AlertTriangle size={24} />
            <div className="cs-error__title">意识海暂时没有回应</div>
            <div className="cs-error__desc">{error}</div>
            <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void load(false)}>重新连接</Button>
          </div>
        </Card>
      ) : overview ? (
        <>
          <ConsciousnessHero overview={overview} persona={persona} resumeBrief={resumeBrief} />

          {error && (
            <div className="cs-inline-error">
              <AlertTriangle size={13} />
              <span>{error}</span>
              <Button variant="ghost" size="sm" onClick={() => void refresh()}>重试</Button>
            </div>
          )}

          <section className="cs-layer">
            <LayerHead
              index="01"
              title="识海"
              desc="她经历过的每件事，都会变成识海里的一个点。越重要，点越亮、沉得越深；点与点之间，是还没说出口的联想。"
              icon={<Waves size={15} />}
              extra={<Badge tone="brand">{overview.points.length} 个记忆点</Badge>}
            />
            {totalSeaPoints > overview.points.length && (
              <div className="cs-sea-note">
                <Waves size={12} />
                <span>星图优先展示显著度最高的 {overview.points.length} 个点；全部 {totalSeaPoints} 个点的深度分布见「05 遗忘」。点云可按深度筛选。</span>
              </div>
            )}
            <ConsciousnessSearch
              query={query}
              onQueryChange={setQuery}
              onSearch={() => void runSearch()}
              onClear={clearSearch}
              searching={searching}
              searched={searched}
              results={results}
              error={searchError}
              onPick={(point) => setSelected(point)}
            />
            <div className="cs-sea-layout">
              <Card className="cs-sea-card">
                <SeaCloud
                  points={overview.points}
                  selectedId={selected?.id ?? null}
                  highlightIds={results.map((point) => point.id)}
                  onSelect={(point) => setSelected(point)}
                />
              </Card>
              <SeaPointDetail
                point={selected}
                onClear={() => setSelected(null)}
                onSearchTag={(tag) => { setQuery(tag); void runSearch(tag); }}
              />
            </div>
          </section>

          <section className="cs-layer">
            <LayerHead
              index="02"
              title="原意识"
              desc="最深处的她。身份、价值、承诺与最初的相遇构成灯塔锚点，把漂浮的记忆固定成「她是谁」。"
              icon={<Anchor size={15} />}
              extra={<Badge tone="pink">{overview.origin.anchors.length} 个锚点</Badge>}
            />
            <OriginPanel origin={overview.origin} persona={persona} />
          </section>

          <section className="cs-layer">
            <LayerHead
              index="03"
              title="心光"
              desc="此刻她的注意力照向哪里。焦点、正在聊的话题、还没解决的事和当下的情绪，构成这一束光。"
              icon={<Sparkles size={15} />}
              extra={<Badge tone="warning">{sortedAttention.length} 束心光</Badge>}
            />
            <AttentionCards attention={overview.attention} conversationLabel={conversationLabel} />
          </section>

          <section className="cs-layer">
            <LayerHead
              index="04"
              title="心流"
              desc="一个念头牵出下一个念头。感知 → 联想 → 回忆 → 推理 → 回应 → 反思，串成她对你的回应。"
              icon={<Workflow size={15} />}
              extra={<Badge tone="mint">{overview.flows.length} 条链</Badge>}
            />
            <MindFlowTimeline flows={overview.flows} conversationLabel={conversationLabel} />
          </section>

          <section className="cs-layer">
            <LayerHead
              index="05"
              title="遗忘"
              desc="细节会淡，重要的反而沉得更深。她不会删除原文，只是让记忆沉降到需要时再被打捞的地方。"
              icon={<Archive size={15} />}
              extra={<Badge>{overview.forgetting.fadedThisWeek ?? 0} 条本周淡化</Badge>}
            />
            <ForgettingPanel stat={overview.forgetting} />
          </section>
        </>
      ) : null}
    </>
  );
}
