import React from 'react';
import { LayoutDashboard, MessagesSquare, Drama, Brain, Sparkles, Plug, TerminalSquare, Settings, ChevronsLeft, ChevronsRight, Minus, Square, X, Wifi, WifiOff, ShieldCheck, Search, Command, Activity, Wallet, Waves, BrainCircuit, Sticker, Clapperboard } from 'lucide-react';
import { cn, IconButton, Badge, Avatar } from './components/ui';
import { useApp } from './app/AppProvider';
import { useHashRoute, type RouteKey } from './hooks/useHashRoute';
import { assetUrl } from './lib/assets';
import { personaAvatarUrl } from './lib/persona';
import { api, windowControls } from './lib/api';
import DashboardPage from './pages/DashboardPage';
import ChatPage from './pages/ChatPage';
import PersonasPage from './pages/PersonasPage';
import MemoryPage from './pages/MemoryPage';
import ConsciousnessPage from './pages/ConsciousnessPage';
import StickerPage from './pages/StickerPage';
import CreativeLibraryPage from './pages/CreativeLibraryPage';
import GrowthPage from './pages/GrowthPage';
import NeuralPage from './pages/NeuralPage';
import CostsPage from './pages/CostsPage';
import PluginsPage from './pages/PluginsPage';
import NapCatPage from './pages/NapCatPage';
import SettingsPage from './pages/SettingsPage';
import OnboardingWizard from './components/OnboardingWizard';

const NAV: { group: string; items: { key: RouteKey; label: string; icon: React.ReactNode }[] }[] = [
  { group: '陪伴', items: [
    { key: 'dashboard', label: '首页', icon: <LayoutDashboard size={19} /> },
    { key: 'chat', label: '聊天', icon: <MessagesSquare size={19} /> },
    { key: 'personas', label: '人设', icon: <Drama size={19} /> },
  ]},
  { group: '心智', items: [
    { key: 'memory', label: '记忆库', icon: <Brain size={19} /> },
    { key: 'consciousness', label: '意识海', icon: <Waves size={19} /> },
    { key: 'stickers', label: '表情包库', icon: <Sticker size={19} /> },
    { key: 'creations', label: '创作库', icon: <Clapperboard size={19} /> },
    { key: 'growth', label: '成长日记', icon: <Sparkles size={19} /> },
    { key: 'neural', label: '神经中枢', icon: <BrainCircuit size={19} /> },
  ]},
  { group: '系统', items: [
    { key: 'plugins', label: '插件', icon: <Plug size={19} /> },
    { key: 'napcat', label: 'NapCat', icon: <TerminalSquare size={19} /> },
    { key: 'costs', label: '费用账本', icon: <Wallet size={19} /> },
    { key: 'settings', label: '设置', icon: <Settings size={19} /> },
  ]},
];

function TitleBar() {
  const [maximized, setMaximized] = React.useState(false);
  const { napcat, activePersona } = useApp();
  React.useEffect(() => {
    void windowControls.isMaximized().then(setMaximized);
    return windowControls.onMaximizeChange(setMaximized);
  }, []);
  const online = napcat.kind === 'online';
  return (
    <div className="titlebar">
      <div className="titlebar__brand">
        <img className="titlebar__logo" src={assetUrl('memes/可爱.png')} alt="鲸鲸" />
        <div>
          <div className="titlebar__title">鲸鲸 <span className="dim" style={{ fontWeight: 400 }}>· QQ 智能伙伴</span></div>
          <div className="titlebar__sub">DeepSeek · NapCat · BreezeBlue</div>
        </div>
      </div>
      <div className="titlebar__drag" />
      <div className="titlebar__status">
        <Badge tone={online ? 'success' : 'default'} dot>{online ? 'QQ 在线' : napcat.kind === 'waiting-login' ? '等待登录' : '离线演示'}</Badge>
        <span className="dim text-xs">{activePersona?.name ?? '鲸鲸'} 正在陪伴</span>
      </div>
      <div className="titlebar__actions">
        <button className="win-btn" onClick={() => void windowControls.minimize()} aria-label="最小化"><Minus size={15} /></button>
        <button className="win-btn" onClick={() => void windowControls.toggleMaximize()} aria-label="最大化"><Square size={12} /></button>
        <button className="win-btn win-btn--close" onClick={() => void windowControls.close()} aria-label="关闭"><X size={15} /></button>
      </div>
    </div>
  );
}

function Sidebar({ route, navigate, collapsed, onToggle }: { route: RouteKey; navigate: (r: RouteKey) => void; collapsed: boolean; onToggle: () => void }) {
  const { activePersona, conversations, napcat, overview } = useApp();
  const unread = conversations.reduce((sum, c) => sum + c.unread, 0);
  const avatar = personaAvatarUrl(activePersona);
  return (
    <aside className={cn('sidebar', collapsed && 'sidebar--collapsed')}>
      <div className="sidebar__profile">
        <div className="sidebar__avatar-wrap">
          {avatar ? <img className="sidebar__avatar" src={avatar} alt={activePersona?.name} /> : <div className="sidebar__avatar" style={{ display: 'grid', placeItems: 'center', fontSize: 20 }}>{activePersona?.avatar || '🐋'}</div>}
          <span className={cn('sidebar__online')} style={{ background: napcat.qqOnline ? 'var(--success)' : 'var(--text-3)' }} />
        </div>
        <div className="sidebar__identity flex-1">
          <div className="sidebar__name-row"><span className="sidebar__name">{activePersona?.name ?? '鲸鲸'}</span><Badge tone="brand" className="text-xs">Lv.{overview.growth?.level ?? 1}</Badge></div>
          <div className="sidebar__meta">{activePersona?.title ?? '你的深海小鲸鱼'}</div>
        </div>
      </div>
      <nav className="sidebar__nav">
        {NAV.map((group) => (
          <React.Fragment key={group.group}>
            <div className="sidebar__group-label">{group.group}</div>
            {group.items.map((item) => {
              const badge = item.key === 'chat' && unread > 0 ? (unread > 99 ? '99+' : String(unread)) : null;
              return (
                <button key={item.key} className={cn('nav-item', route === item.key && 'nav-item--active')} onClick={() => navigate(item.key)} title={collapsed ? item.label : undefined}>
                  <span className="nav-item__icon">{item.icon}</span>
                  <span className="nav-item__label">{item.label}</span>
                  {badge && <span className="nav-item__badge">{badge}</span>}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </nav>
      <div className="sidebar__foot">
        <button className="sidebar__foot-btn" onClick={onToggle} title={collapsed ? '展开侧边栏' : '收起侧边栏'}>
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}<span className="sidebar__foot-label">收起侧边栏</span>
        </button>
        <button className="sidebar__foot-btn" onClick={() => void api.openPath('')} title="打开数据目录">
          <ShieldCheck size={16} /><span className="sidebar__foot-label">本地数据 · 私密存储</span>
        </button>
      </div>
    </aside>
  );
}

function LoadingScreen() {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--app-bg)' }}>
      <div className="stack" style={{ alignItems: 'center', gap: 18 }}>
        <div style={{ width: 154, height: 154, position: 'relative' }}>
          <video src={assetUrl('animations/蓝鲸现世.webm')} autoPlay loop muted playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', filter: 'drop-shadow(0 18px 36px rgba(77,141,255,.35))' }} />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, letterSpacing: '.08em' }}>正在唤醒鲸鲸…</div>
        <div className="dim text-sm">连接到深海记忆与 QQ 世界</div>
        <div className="progress" style={{ width: 220 }}><div className="progress__bar" style={{ width: '62%', animation: 'shimmer 2s infinite' }} /></div>
      </div>
    </div>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div style={{ height: '100%', display: 'grid', placeItems: 'center', background: 'var(--app-bg)' }}>
      <div className="card card__pad--lg" style={{ maxWidth: 480, textAlign: 'center' }}>
        <div style={{ fontSize: 36 }}>🌊</div>
        <div className="text-lg bold" style={{ marginTop: 8 }}>深海信号中断了</div>
        <div className="muted text-sm" style={{ marginTop: 6, wordBreak: 'break-word' }}>{message}</div>
        <button className="btn btn--primary" style={{ marginTop: 18 }} onClick={onRetry}>重新连接</button>
      </div>
    </div>
  );
}

export default function App() {
  const { loading, error, reload, data, onboardingOpen, settings, saveSettings } = useApp();
  const [route, navigate] = useHashRoute();
  const [collapsed, setCollapsed] = React.useState(settings.ui?.sidebarCollapsed ?? false);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => { scrollRef.current?.scrollTo({ top: 0, behavior: 'auto' }); }, [route]);

  React.useEffect(() => {
    if (data && route !== 'dashboard') { /* keep hash */ }
  }, [data, route]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCommandOpen((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggleCollapsed = () => { const v = !collapsed; setCollapsed(v); void saveSettings({ ui: { ...settings.ui, sidebarCollapsed: v } }); };

  if (loading) return <><div className="app-bg-glow" /><LoadingScreen /></>;
  if (error || !data) return <><div className="app-bg-glow" /><ErrorScreen message={error ?? '未知错误'} onRetry={() => void reload()} /></>;
  return (
    <div className="app-frame">
      <div className="app-bg-glow" />
      <div className="app-noise" />
      <TitleBar />
      <div className="app-body">
        <Sidebar route={route} navigate={navigate} collapsed={collapsed} onToggle={toggleCollapsed} />
        <main className="main-area">
          <div className="main-scroll" key={route} ref={scrollRef}>
            <div className={cn('page', (route === 'chat' || route === 'napcat') && 'page--wide')} style={route === 'chat' ? { height: 'calc(100vh - var(--titlebar-height))', paddingBottom: 22, display: 'flex', flexDirection: 'column' } : undefined}>
              {route === 'dashboard' && <DashboardPage />}
              {route === 'chat' && <ChatPage />}
              {route === 'personas' && <PersonasPage />}
              {route === 'memory' && <MemoryPage />}
              {route === 'consciousness' && <ConsciousnessPage />}
              {route === 'stickers' && <StickerPage />}
              {route === 'creations' && <CreativeLibraryPage />}
              {route === 'growth' && <GrowthPage />}
              {route === 'neural' && <NeuralPage />}
              {route === 'costs' && <CostsPage />}
              {route === 'plugins' && <PluginsPage />}
              {route === 'napcat' && <NapCatPage />}
              {route === 'settings' && <SettingsPage />}
            </div>
          </div>
        </main>
      </div>
      {onboardingOpen && <OnboardingWizard />}
      {commandOpen && <CommandPalette onClose={() => setCommandOpen(false)} navigate={navigate} />}
    </div>
  );
}

function CommandPalette({ onClose, navigate }: { onClose: () => void; navigate: (r: RouteKey) => void }) {
  const [q, setQ] = React.useState('');
  const items = NAV.flatMap((g) => g.items).filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" style={{ width: 'min(560px, 92vw)', alignSelf: 'flex-start', marginTop: '12vh' }}>
        <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <Search size={17} className="dim" />
          <input autoFocus className="input" style={{ border: 'none', background: 'transparent', padding: 0, height: 28 }} placeholder="搜索页面或功能…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }} />
          <span className="kbd">ESC</span>
        </div>
        <div style={{ padding: 8, maxHeight: 340, overflowY: 'auto' }}>
          {items.map((item) => <button key={item.key} className="nav-item" onClick={() => { navigate(item.key); onClose(); }}>{item.icon}<span>{item.label}</span><span className="spacer" /><Command size={13} className="dim" /></button>)}
          {!items.length && <div className="empty-state" style={{ padding: 30 }}>没有找到相关页面</div>}
        </div>
      </div>
    </div>
  );
}
