import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, PenLine, RefreshCw, Sparkles } from 'lucide-react';
import type { ActivityType, DiaryEntry, LearningNote, QzonePost, BiliDiscovery } from '@shared/types';
import { api } from '@/lib/api';
import { Button, Card, PageHeader, Tabs, useToast } from '@/components/ui';
import GrowthHero from '@/components/growth/GrowthHero';
import GrowthHighlights from '@/components/growth/GrowthHighlights';
import DiaryTimeline from '@/components/growth/DiaryTimeline';
import QzoneFeed from '@/components/growth/QzoneFeed';
import BiliGrid from '@/components/growth/BiliGrid';
import LearningNotes from '@/components/growth/LearningNotes';
import ActivityTimeline from '@/components/growth/ActivityTimeline';
import { mergeNew } from '@/components/growth/meta';
import { personaAvatarUrl } from '@/lib/persona';
import { useApp } from '@/app/AppProvider';
import '@/styles/growth.css';

type TabKey = 'diary' | 'qzone' | 'bili' | 'learn' | 'activity';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function GrowthSkeleton() {
  return (
    <div className="gro-skeleton-page">
      <div className="skeleton gro-skeleton-page__hero" />
      <div className="gro-skeleton-page__row">
        <div className="skeleton gro-skeleton-page__mini" />
        <div className="skeleton gro-skeleton-page__mini" />
        <div className="skeleton gro-skeleton-page__mini" />
      </div>
      <div className="skeleton gro-skeleton-page__panel" />
    </div>
  );
}

export default function GrowthPage() {
  const { overview, refreshOverview, activePersona, petAssets, settings } = useApp();
  const toast = useToast();
  const persona = activePersona;
  const hasGrowth = Boolean(overview.growth?.lastGrownAt);

  const [tab, setTab] = useState<TabKey>('diary');
  const [refreshing, setRefreshing] = useState(false);
  const [bootLoading, setBootLoading] = useState(!hasGrowth);
  const [bootError, setBootError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);

  const [diaries, setDiaries] = useState<DiaryEntry[]>(() => overview.diaries ?? []);
  const [diaryId, setDiaryId] = useState<string | null>(() => overview.diaries?.[0]?.id ?? null);
  const [diaryLoading, setDiaryLoading] = useState(false);
  const [diaryError, setDiaryError] = useState<string | null>(null);
  const diaryInFlight = useRef(false);
  const diaryLoaded = useRef(false);

  const [qzone, setQzone] = useState<QzonePost[]>(() => overview.qzone ?? []);
  const [qzoneLoading, setQzoneLoading] = useState(false);
  const [qzoneError, setQzoneError] = useState<string | null>(null);
  const [qzoneBusy, setQzoneBusy] = useState(false);
  const [qzoneNotice, setQzoneNotice] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [autoPost, setAutoPost] = useState(false);
  const qzoneInFlight = useRef(false);
  const qzoneLoaded = useRef(false);

  const [bili, setBili] = useState<BiliDiscovery[]>(() => overview.bilibili ?? []);
  const [biliBusy, setBiliBusy] = useState(false);
  const [biliError, setBiliError] = useState<string | null>(null);

  const [learning, setLearning] = useState<LearningNote[]>(() => overview.learning ?? []);
  const [learningBusy, setLearningBusy] = useState(false);
  const [learningError, setLearningError] = useState<string | null>(null);
  const [learnNotice, setLearnNotice] = useState<string | null>(null);

  const [activities, setActivities] = useState(() => overview.activities ?? []);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [triggering, setTriggering] = useState<ActivityType | null>(null);
  const activityInFlight = useRef(false);
  const activityLoaded = useRef(false);

  const boot = useCallback(async () => {
    setBootLoading(true);
    try {
      await refreshOverview();
      setBootError(null);
    } catch (caught) {
      setBootError(errorMessage(caught));
    } finally {
      setBootLoading(false);
    }
  }, [refreshOverview]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    setDiaries((previous) => mergeNew(overview.diaries ?? [], previous));
    setQzone((previous) => mergeNew(overview.qzone ?? [], previous));
    setBili((previous) => mergeNew(overview.bilibili ?? [], previous));
    setLearning((previous) => mergeNew(overview.learning ?? [], previous));
    setActivities((previous) => mergeNew(overview.activities ?? [], previous));
  }, [overview.diaries, overview.qzone, overview.bilibili, overview.learning, overview.activities]);

  useEffect(() => {
    if (!diaryId && diaries.length > 0) setDiaryId(diaries[0]!.id);
  }, [diaryId, diaries]);

  const loadDiaries = useCallback(async (silent = false) => {
    if (diaryInFlight.current) return;
    diaryInFlight.current = true;
    if (!silent) setDiaryLoading(true);
    setDiaryError(null);
    try {
      const list = await api.growth.diaryList();
      setDiaries((previous) => {
        const ids = new Set(list.map((entry) => entry.id));
        return [...list, ...previous.filter((entry) => !ids.has(entry.id))];
      });
      setDiaryId((previous) => {
        if (previous && list.some((entry) => entry.id === previous)) return previous;
        return list[0]?.id ?? previous;
      });
    } catch (caught) {
      if (!silent) setDiaryError(errorMessage(caught));
    } finally {
      diaryInFlight.current = false;
      if (!silent) setDiaryLoading(false);
    }
  }, []);

  const loadQzone = useCallback(async (silent = false) => {
    if (qzoneInFlight.current) return;
    qzoneInFlight.current = true;
    if (!silent) setQzoneLoading(true);
    setQzoneError(null);
    try {
      const list = await api.growth.qzoneList();
      setQzone((previous) => {
        const ids = new Set(list.map((post) => post.id));
        return [...list, ...previous.filter((post) => !ids.has(post.id))];
      });
    } catch (caught) {
      if (!silent) setQzoneError(errorMessage(caught));
    } finally {
      qzoneInFlight.current = false;
      if (!silent) setQzoneLoading(false);
    }
  }, []);

  const loadActivities = useCallback(async (silent = false) => {
    if (activityInFlight.current) return;
    activityInFlight.current = true;
    if (!silent) setActivityLoading(true);
    setActivityError(null);
    try {
      const list = await api.growth.activityList(60);
      setActivities((previous) => {
        const ids = new Set(list.map((item) => item.id));
        return [...list, ...previous.filter((item) => !ids.has(item.id))];
      });
    } catch (caught) {
      if (!silent) setActivityError(errorMessage(caught));
    } finally {
      activityInFlight.current = false;
      if (!silent) setActivityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'diary' && !diaryLoaded.current) {
      diaryLoaded.current = true;
      void loadDiaries();
    }
    if (tab === 'qzone' && !qzoneLoaded.current) {
      qzoneLoaded.current = true;
      void loadQzone();
    }
    if (tab === 'activity' && !activityLoaded.current) {
      activityLoaded.current = true;
      void loadActivities();
    }
  }, [tab, loadDiaries, loadQzone, loadActivities]);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshOverview();
      if (tab === 'diary') await loadDiaries(true);
      if (tab === 'qzone') await loadQzone(true);
      if (tab === 'activity') await loadActivities(true);
      toast.success('成长档案已刷新', '她的情绪、阶段和生活记录已同步');
    } catch (caught) {
      toast.error('刷新失败', errorMessage(caught));
    } finally {
      setRefreshing(false);
    }
  };

  const handleWriteDiary = async () => {
    if (writing) return;
    setWriting(true);
    setDiaryError(null);
    try {
      const result = await api.growth.diaryGenerate(true);
      setDiaries((previous) => [result.entry, ...previous.filter((entry) => entry.id !== result.entry.id)]);
      setDiaryId(result.entry.id);
      setTab('diary');
      toast.success('今天的日记写好了', result.entry.title);
      await refreshOverview();
      await loadDiaries(true);
    } catch (caught) {
      const message = errorMessage(caught);
      setDiaryError(message);
      toast.error('写日记失败', message);
    } finally {
      setWriting(false);
    }
  };

  const handleQzoneGenerate = async () => {
    if (qzoneBusy) return;
    setQzoneBusy(true);
    setQzoneError(null);
    setQzoneNotice(null);
    try {
      const result = await api.growth.qzoneGenerate(prompt.trim() || undefined, autoPost);
      setQzone((previous) => [result.post, ...previous.filter((post) => post.id !== result.post.id)]);
      setPrompt('');
      if (result.error) {
        setQzoneNotice(result.error);
        toast.warning('说说生成了，但发布没成功', result.error);
      } else if (result.posted) {
        toast.success('说说已发布到 QQ 空间', '去空间看看她写了什么');
      } else {
        toast.success('说说草稿已生成', autoPost ? '自动发布未完成，草稿已保留' : '可以在空间里手动发布');
      }
      await refreshOverview();
      await loadQzone(true);
    } catch (caught) {
      const message = errorMessage(caught);
      setQzoneError(message);
      toast.error('生成说说失败', message);
    } finally {
      setQzoneBusy(false);
    }
  };

  const handleBiliRefresh = async () => {
    if (biliBusy) return;
    setBiliBusy(true);
    setBiliError(null);
    try {
      const list = await api.growth.biliRefresh();
      setBili(list);
      toast.success('B 站雷达刷新完成', `带回了 ${list.length} 条新发现`);
      await refreshOverview();
    } catch (caught) {
      const message = errorMessage(caught);
      setBiliError(message);
      toast.error('刷新 B 站失败', message);
    } finally {
      setBiliBusy(false);
    }
  };

  const handleLearn = async (topic: string) => {
    if (learningBusy) return;
    setLearningBusy(true);
    setLearningError(null);
    setLearnNotice(null);
    try {
      const result = await api.growth.learn(topic.trim() || undefined);
      if ('error' in result) {
        setLearnNotice(result.error);
        toast.error('学习失败了', result.error);
      } else {
        setLearning((previous) => [result, ...previous.filter((note) => note.id !== result.id)]);
        toast.success(`学完了：${result.topic}`, result.summary);
        await refreshOverview();
      }
    } catch (caught) {
      const message = errorMessage(caught);
      setLearningError(message);
      toast.error('学习失败', message);
    } finally {
      setLearningBusy(false);
    }
  };

  const handleTrigger = async (kind: ActivityType) => {
    if (triggering) return;
    setTriggering(kind);
    try {
      const result = await api.growth.trigger(kind, true);
      if (result.activity) {
        setActivities((previous) => [result.activity!, ...previous.filter((item) => item.id !== result.activity!.id)]);
        toast.success(result.activity.title, result.activity.summary);
      }
      if (result.message) toast.info('鲸鲸想跟你说', result.message);
      if (result.skippedReason) toast.warning('这次先跳过', result.skippedReason);
      await refreshOverview();
      await loadActivities(true);
    } catch (caught) {
      toast.error('触发失败', errorMessage(caught));
    } finally {
      setTriggering(null);
    }
  };

  const openExternal = async (url: string) => {
    if (!url) return;
    try {
      await api.openExternal(url);
    } catch (caught) {
      toast.error('打开链接失败', errorMessage(caught));
    }
  };

  const openDiary = (id: string) => {
    setTab('diary');
    setDiaryId(id);
    if (!diaryLoaded.current) {
      diaryLoaded.current = true;
      void loadDiaries();
    }
  };

  const tabs = useMemo(() => ([
    { value: 'diary' as TabKey, label: '日记', count: diaries.length },
    { value: 'qzone' as TabKey, label: 'QQ空间', count: qzone.length },
    { value: 'bili' as TabKey, label: 'B站发现', count: bili.length },
    { value: 'learn' as TabKey, label: '学习笔记', count: learning.length },
    { value: 'activity' as TabKey, label: '活动轨迹', count: activities.length },
  ]), [diaries.length, qzone.length, bili.length, learning.length, activities.length]);

  if (bootLoading && !hasGrowth) return <GrowthSkeleton />;

  if (bootError && !hasGrowth) {
    return (
      <Card className="gro-section-card">
        <div className="gro-error">
          <AlertTriangle size={23} />
          <div className="gro-error__title">成长档案加载失败</div>
          <div className="gro-error__desc">{bootError}</div>
          <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void boot()}>重新连接</Button>
        </div>
      </Card>
    );
  }

  const autonomy = settings.autonomy;
  const biliEnabled = settings.bilibili?.enabled ?? true;

  return (
    <>
      <PageHeader
        eyebrow="GROWTH JOURNAL"
        icon={<Sparkles size={14} />}
        title="成长日记"
        desc="她不是一段固定的人设，而是会记住、会犯错、也会自己生活的伙伴。这里记录她的情绪、日记，以及她独自做过的事。"
        actions={(
          <>
            <Button variant="ghost" icon={<RefreshCw size={15} className={refreshing ? 'spin' : ''} />} onClick={() => void handleRefresh()} disabled={refreshing}>
              刷新
            </Button>
            <Button variant="primary" icon={<PenLine size={15} />} loading={writing} onClick={() => void handleWriteDiary()}>
              现在写日记
            </Button>
          </>
        )}
      />

      <GrowthHero overview={overview} persona={persona} petAssets={petAssets} />

      <GrowthHighlights
        overview={overview}
        onOpenDiary={openDiary}
        onOpenActivity={() => { setTab('activity'); if (!activityLoaded.current) { activityLoaded.current = true; void loadActivities(); } }}
      />

      <section className="gro-tabs-section">
        <div className="gro-tabs-head">
          <Tabs value={tab} onChange={setTab} items={tabs} />
          <span className="dim text-xs gro-tabs-hint">所有内容都由她真实生成，不是占位示例</span>
        </div>

        <div className="gro-tab-panel" key={tab}>
          {tab === 'diary' && (
            <DiaryTimeline
              entries={diaries}
              loading={diaryLoading}
              error={diaryError}
              selectedId={diaryId}
              writing={writing}
              onSelect={setDiaryId}
              onRetry={() => void loadDiaries()}
              onWrite={() => void handleWriteDiary()}
            />
          )}

          {tab === 'qzone' && (
            <QzoneFeed
              posts={qzone}
              loading={qzoneLoading}
              error={qzoneError}
              generating={qzoneBusy}
              notice={qzoneNotice}
              prompt={prompt}
              autoPost={autoPost}
              autonomy={autonomy}
              personaName={persona?.name ?? '鲸鲸'}
              personaAvatar={personaAvatarUrl(persona)}
              onPromptChange={setPrompt}
              onAutoPostChange={setAutoPost}
              onGenerate={() => void handleQzoneGenerate()}
              onRetry={() => void loadQzone()}
            />
          )}

          {tab === 'bili' && (
            <BiliGrid
              items={bili}
              loading={false}
              error={biliError}
              refreshing={biliBusy}
              interests={settings.bilibili?.interests ?? []}
              enabled={biliEnabled}
              onRefresh={() => void handleBiliRefresh()}
              onOpen={(url) => void openExternal(url)}
            />
          )}

          {tab === 'learn' && (
            <LearningNotes
              notes={learning}
              loading={false}
              error={learningError}
              learning={learningBusy}
              lastError={learnNotice}
              onLearn={(topic) => void handleLearn(topic)}
              onRetry={() => void handleLearn('')}
              onOpen={(url) => void openExternal(url)}
            />
          )}

          {tab === 'activity' && (
            <ActivityTimeline
              activities={activities}
              loading={activityLoading}
              error={activityError}
              triggering={triggering}
              onTrigger={(kind) => void handleTrigger(kind)}
              onRetry={() => void loadActivities()}
              onOpen={(url) => void openExternal(url)}
            />
          )}
        </div>
      </section>

      {bootError && hasGrowth && (
        <div className="gro-inline-error gro-boot-error">
          <AlertTriangle size={13} />{bootError}
          <Button variant="ghost" size="sm" onClick={() => void boot()}>重试</Button>
        </div>
      )}
    </>
  );
}
