import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BookOpen, Brain, Globe, GraduationCap, Image as ImageIcon, MessageCircle,
  MessageSquare, Music, PenLine, Play, RefreshCw, Sparkles, Users, Video, Volume2, Waves,
} from 'lucide-react';
import type { ActivityItem, MemorySummary } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import {
  Badge, Button, Card, CardBody, CardHead, EmptyState, PageHeader, StatTile, cn, useToast,
} from '@/components/ui';
import { formatNumber, relativeTime } from '@/lib/format';
import DashboardHero from '@/components/dashboard/DashboardHero';
import CreationStudio from '@/components/dashboard/CreationStudio';
import { FeatureGuide, RelationshipCard, SystemStatus } from '@/components/dashboard/SidePanels';
import ActivityTypeIcon from '@/components/growth/ActivityTypeIcon';
import { ACTIVITY_META, ACTIVITY_STATUS, sortByTimeDesc, stripMarkdown } from '@/components/growth/meta';
import '@/styles/dashboard.css';

type QuickKind = 'diary' | 'qzone' | 'bili' | null;

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function greetingForHour(hour: number): string {
  if (hour < 5) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  if (hour < 23) return '晚上好';
  return '夜深了';
}

export default function DashboardPage() {
  const {
    data, settings, keyStatus, activePersona, conversations, overview, plugins, integrations,
    napcat, petAssets, refreshOverview, saveSettings,
  } = useApp();
  const toast = useToast();
  const [studioOpen, setStudioOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [quickBusy, setQuickBusy] = useState<QuickKind>(null);
  const [lifeBusy, setLifeBusy] = useState(false);
  const [memoryStats, setMemoryStats] = useState<MemorySummary['stats'] | null>(data?.memory.stats ?? null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let alive = true;
    api.memory.summary()
      .then((summary) => { if (alive) setMemoryStats(summary.stats); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const greeting = greetingForHour(new Date().getHours());
  const ownerName = useMemo(() => {
    const ownerQQ = settings.general.ownerQQ;
    const matched = conversations.find((conversation) => ownerQQ && conversation.peerId === ownerQQ);
    return matched?.peerName?.trim() || '主人';
  }, [conversations, settings.general.ownerQQ]);

  const activities = useMemo(() => sortByTimeDesc(overview.activities ?? []).slice(0, 6), [overview.activities]);
  const latestDiary = useMemo(() => sortByTimeDesc(overview.diaries ?? [])[0], [overview.diaries]);
  const latestQzone = useMemo(() => sortByTimeDesc(overview.qzone ?? [])[0], [overview.qzone]);
  const latestBili = useMemo(() => sortByTimeDesc(overview.bilibili ?? [])[0], [overview.bilibili]);
  const latestLearning = useMemo(() => sortByTimeDesc(overview.learning ?? [])[0], [overview.learning]);

  const messageCount = conversations.reduce((sum, conversation) => sum + conversation.messageCount, 0);
  const creationCount = (overview.diaries?.length ?? 0) + (overview.qzone?.length ?? 0);

  const navigate = (route: string, tab?: string) => {
    window.location.hash = tab ? `/${route}?tab=${tab}` : `/${route}`;
  };

  const listen = async () => {
    if (listening) return;
    if (!keyStatus.breezeblue) {
      toast.warning('先给她安上声音', '在「设置 · API 密钥」里填入 BreezeBlue Key，就能听到她说话。');
      return;
    }
    setListening(true);
    try {
      const text = activePersona?.greeting || activePersona?.catchphrases?.[0] || '你好呀，我是鲸鲸。';
      const result = await api.integrations.tts(text, activePersona?.id, settings.models.breezeVoiceId || undefined);
      if (!result.ok || !result.url) {
        toast.error('暂时听不到她', result.error || '没有拿到音频地址，请检查 BreezeBlue 配置与音色。');
        return;
      }
      audioRef.current?.pause();
      const audio = new Audio(result.url);
      audioRef.current = audio;
      audio.onerror = () => toast.error('音频播放失败', '媒体文件可能已被清理，再试一次看看。');
      await audio.play();
      toast.success('她在说话', text.slice(0, 26) + (text.length > 26 ? '…' : ''));
    } catch (caught) {
      toast.error('语音播放失败', errText(caught));
    } finally {
      setListening(false);
    }
  };

  const runQuick = async (kind: Exclude<QuickKind, null>) => {
    if (quickBusy) return;
    setQuickBusy(kind);
    try {
      if (kind === 'diary') {
        const result = await api.growth.diaryGenerate(true);
        toast.success('日记写好了', result.entry.title);
      } else if (kind === 'qzone') {
        const result = await api.growth.qzoneGenerate(undefined, false);
        if (result.error) toast.warning('说说生成了，但发布没成功', result.error);
        else if (result.posted) toast.success('说说已发布到 QQ 空间');
        else toast.success('说说草稿已生成', '可以去成长页看看');
      } else {
        const list = await api.growth.biliRefresh();
        toast.success('她逛完 B 站回来了', '带回了 ' + list.length + ' 条新发现');
      }
      await refreshOverview();
    } catch (caught) {
      toast.error('这次没有成功', errText(caught));
    } finally {
      setQuickBusy(null);
    }
  };

  const toggleLife = async () => {
    if (lifeBusy) return;
    setLifeBusy(true);
    try {
      const enabled = !settings.autonomy.enabled;
      await saveSettings({ autonomy: { ...settings.autonomy, enabled } });
      toast.success(enabled ? '自主生活已开启' : '自主生活已暂停', enabled ? '她会开始自己写日记、逛 B 站、学新东西。' : '她只在你叫她的时候出现。');
    } catch (caught) {
      toast.error('切换失败', errText(caught));
    } finally {
      setLifeBusy(false);
    }
  };

  const worldCards = [
    {
      key: 'diary',
      label: '日记',
      icon: <BookOpen size={15} />,
      color: 'var(--pink)',
      title: latestDiary?.title,
      desc: latestDiary ? stripMarkdown(latestDiary.content, 64) : '还没有写过日记',
      time: latestDiary ? relativeTime(latestDiary.createdAt) : '',
    },
    {
      key: 'qzone',
      label: 'QQ空间',
      icon: <Globe size={15} />,
      color: 'var(--brand-3)',
      title: latestQzone ? stripMarkdown(latestQzone.content, 24) : undefined,
      desc: latestQzone ? latestQzone.status === 'posted' ? '已发布到空间' : '还只是一条草稿' : '空间里还没有动静',
      time: latestQzone ? relativeTime(latestQzone.createdAt) : '',
    },
    {
      key: 'bili',
      label: 'B站发现',
      icon: <Play size={15} />,
      color: 'var(--mint)',
      title: latestBili?.title,
      desc: latestBili ? (latestBili.upName ? 'UP · ' + latestBili.upName : '她正在 B 站逛') : '还没逛到想分享的视频',
      time: latestBili ? relativeTime(latestBili.createdAt) : '',
    },
    {
      key: 'learning',
      label: '学习笔记',
      icon: <GraduationCap size={15} />,
      color: 'var(--amber)',
      title: latestLearning?.topic,
      desc: latestLearning ? stripMarkdown(latestLearning.summary, 56) : '还没有学习笔记',
      time: latestLearning ? relativeTime(latestLearning.createdAt) : '',
    },
  ];

  const quickActions: { kind: Exclude<QuickKind, null>; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
    { kind: 'diary', label: '写一篇日记', desc: '记录今天的心情', icon: <PenLine size={16} />, color: 'var(--pink)' },
    { kind: 'qzone', label: '发一条说说', desc: '配上她自己选的图', icon: <Globe size={16} />, color: 'var(--brand-3)' },
    { kind: 'bili', label: '去 B 站逛逛', desc: '按兴趣找新视频', icon: <Play size={16} />, color: 'var(--mint)' },
  ];

  return (
    <>
      <PageHeader
        eyebrow="DASHBOARD"
        icon={<Waves size={13} />}
        title={<>{greeting}，{ownerName}</>}
        desc={activePersona ? `${activePersona.name || activePersona.nickname} 在海底等你。去聊两句、听她说句话，或者让她自己生活一会儿。` : '鲸鲸正在海底等你。'}
        actions={(
          <>
            <Badge tone={napcat.kind === 'online' ? 'success' : 'default'} dot>{napcat.kind === 'online' ? 'QQ 在线' : '离线陪伴'}</Badge>
            <Button variant="secondary" icon={<MessageCircle size={15} />} onClick={() => navigate('chat')}>去聊天</Button>
            <Button variant="primary" icon={<Sparkles size={15} />} onClick={() => setStudioOpen(true)}>让她创作</Button>
          </>
        )}
      />

      <DashboardHero
        persona={activePersona}
        petAssets={petAssets}
        overview={overview}
        napcat={napcat}
        listening={listening}
        onListen={() => void listen()}
        onChat={() => navigate('chat')}
        onCreate={() => setStudioOpen(true)}
        onGrowth={() => navigate('growth')}
      />

      <div className="dash-stats">
        <StatTile icon={<MessageSquare size={17} />} label="累计消息" value={formatNumber(messageCount)} sub={`${conversations.length} 个会话`} />
        <StatTile icon={<Brain size={17} />} label="记忆事实" value={formatNumber(memoryStats?.facts ?? 0)} sub="长期记忆里的事实" />
        <StatTile icon={<Users size={17} />} label="认识的人" value={formatNumber(memoryStats?.users ?? 0)} sub="每个联系人都独立成册" />
        <StatTile icon={<ImageIcon size={17} />} label="日记与说说" value={formatNumber(creationCount)} sub={`${overview.diaries?.length ?? 0} 篇日记 · ${overview.qzone?.length ?? 0} 条说说`} />
      </div>

      <div className="dash-main">
        <div className="dash-main__left">
          <Card className="dash-activity">
            <CardHead
              title={<><span className="dash-panel-icon is-mint"><Waves size={14} /></span>正在发生</>}
              desc="自主生活与聊天留下的最近痕迹。"
              extra={<Button variant="ghost" size="sm" icon={<Sparkles size={13} />} onClick={() => navigate('growth')}>成长日记<ArrowRight size={12} /></Button>}
            />
            <CardBody>
              {activities.length === 0 ? (
                <div className="dash-empty">
                  <Sparkles size={22} />
                  <div className="dash-empty__title">她还没有自己做过什么</div>
                  <p>点下面的快捷按钮，让她写第一篇日记或去 B 站逛一圈，这里就会热闹起来。</p>
                  <Button variant="secondary" size="sm" icon={<PenLine size={13} />} loading={quickBusy === 'diary'} onClick={() => void runQuick('diary')}>让她写第一篇日记</Button>
                </div>
              ) : (
                <div className="dash-timeline">
                  {activities.map((item: ActivityItem) => (
                    <div className="dash-timeline__item" key={item.id}>
                      <span className="dash-timeline__node" style={{ color: ACTIVITY_META[item.type].color, background: 'color-mix(in srgb, ' + ACTIVITY_META[item.type].color + ' 12%, transparent)' }}>
                        <ActivityTypeIcon type={item.type} size={13} />
                      </span>
                      <div className="dash-timeline__body">
                        <div className="dash-timeline__top">
                          <span className="dash-timeline__title">{item.title}</span>
                          <Badge tone={ACTIVITY_STATUS[item.status].tone}>{ACTIVITY_STATUS[item.status].label}</Badge>
                          <span className="spacer" />
                          <span className="dim text-xs">{relativeTime(item.createdAt)}</span>
                        </div>
                        <p className="dash-timeline__summary">{item.summary}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="dash-world">
            {worldCards.map((card) => (
              <Card key={card.key} className="dash-world__card" hover onClick={() => navigate('growth')}>
                <div className="dash-world__head">
                  <span className="dash-world__icon" style={{ color: card.color, background: 'color-mix(in srgb, ' + card.color + ' 11%, transparent)' }}>{card.icon}</span>
                  <span className="dash-world__label">{card.label}</span>
                  {card.time && <span className="dash-world__time">{card.time}</span>}
                </div>
                <div className={cn('dash-world__title', !card.title && 'is-empty')}>{card.title || '还没有内容'}</div>
                <p className="dash-world__desc">{card.desc}</p>
                <span className="dash-world__link">去看看<ArrowRight size={12} /></span>
              </Card>
            ))}
          </div>

          <Card className="dash-quick">
            <CardHead title={<><span className="dash-panel-icon is-amber"><Sparkles size={14} /></span>让她做点什么</>} desc="这些不是演示按钮：每次点击都会真实调用模型并写入她的生活记录。" />
            <CardBody>
              <div className="dash-quick__grid">
                {quickActions.map((action) => (
                  <button type="button" key={action.kind} className="dash-quick__btn" disabled={quickBusy !== null} onClick={() => void runQuick(action.kind)}>
                    <span className="dash-quick__icon" style={{ color: action.color, background: 'color-mix(in srgb, ' + action.color + ' 11%, transparent)' }}>
                      {quickBusy === action.kind ? <RefreshCw size={16} className="spin" /> : action.icon}
                    </span>
                    <span className="dash-quick__text"><b>{action.label}</b><span>{quickBusy === action.kind ? '正在进行…' : action.desc}</span></span>
                    <ArrowRight size={14} className="dash-quick__arrow" />
                  </button>
                ))}
              </div>
            </CardBody>
          </Card>
        </div>

        <div className="dash-main__right">
          <FeatureGuide
            settings={settings}
            keyStatus={keyStatus}
            napcat={napcat}
            onNavigate={navigate}
            onToggleLife={() => void toggleLife()}
            lifeBusy={lifeBusy}
          />
          <RelationshipCard relationship={overview.relationship} onChat={() => navigate('chat')} />
          <SystemStatus integrations={integrations} napcat={napcat} plugins={plugins} onNavigate={navigate} />
        </div>
      </div>

      <CreationStudio
        open={studioOpen}
        onClose={() => setStudioOpen(false)}
        persona={activePersona}
        settings={settings}
        onOpenSettings={() => { setStudioOpen(false); navigate('settings', 'keys'); }}
      />
    </>
  );
}
