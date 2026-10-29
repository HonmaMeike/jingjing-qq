import type { ApiKeyStatus, AppSettings, IntegrationStatus, NapCatStatus, PluginInfo, RelationshipState } from '@shared/types';
import {
  ArrowRight, Check, CheckCircle2, Circle, Cpu, Heart, MessageCircle, Plug, ShieldCheck,
  Sparkles, TerminalSquare, Wifi, WifiOff,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHead, Progress, Ring, Toggle, cn } from '@/components/ui';
import { formatDate, formatNumber, relativeTime } from '@/lib/format';

export function FeatureGuide({
  settings, keyStatus, napcat, onNavigate, onToggleLife, lifeBusy,
}: {
  settings: AppSettings;
  keyStatus: ApiKeyStatus;
  napcat: NapCatStatus;
  onNavigate: (route: string, tab?: string) => void;
  onToggleLife: () => void;
  lifeBusy: boolean;
}) {
  const owner = settings.general.ownerQQ || settings.permissions.owners[0] || '';
  const qqOnline = napcat.kind === 'online' || napcat.qqOnline;
  const steps = [
    {
      key: 'deepseek',
      title: '配置 DeepSeek 大脑',
      desc: keyStatus.deepseek ? '对话、日记与反思都可用' : '没有密钥时只能跑演示回复',
      done: keyStatus.deepseek,
      action: () => onNavigate('settings', 'keys'),
      icon: <Cpu size={14} />,
    },
    {
      key: 'qq',
      title: '让 QQ 通道上线',
      desc: qqOnline ? '她正在 QQ 那头等你' : napcat.kind === 'waiting-login' ? '等待扫码登录 QQ' : napcat.installed ? '已安装，等待启动' : '还没有安装 NapCat',
      done: qqOnline,
      action: () => onNavigate('napcat'),
      icon: <TerminalSquare size={14} />,
    },
    {
      key: 'owner',
      title: '设置主人 QQ',
      desc: owner ? '已绑定 ' + owner : '没有主人，她认不出你',
      done: Boolean(owner),
      action: () => onNavigate('settings', 'basic'),
      icon: <ShieldCheck size={14} />,
    },
    {
      key: 'voice',
      title: '挑选她的声音',
      desc: settings.models.breezeVoiceId || settings.models.breezeVoiceName ? '音色已选：' + (settings.models.breezeVoiceName || settings.models.breezeVoiceId) : '同步 BreezeBlue 音色库后试听',
      done: Boolean(settings.models.breezeVoiceId || settings.models.breezeVoiceName),
      action: () => onNavigate('settings', 'models'),
      icon: <Sparkles size={14} />,
    },
    {
      key: 'life',
      title: '开启自主生活',
      desc: settings.autonomy.enabled ? '她会自己写日记、发说说、逛 B 站' : '关闭时她只在你叫她时出现',
      done: settings.autonomy.enabled,
      action: () => onToggleLife(),
      icon: <Heart size={14} />,
    },
  ];
  const doneCount = steps.filter((step) => step.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);

  return (
    <Card className="dash-guide">
      <CardHead
        title={<><span className="dash-panel-icon is-brand"><Sparkles size={14} /></span>功能引导</>}
        desc="把鲸鲸完整地唤醒，只差这几步。"
        extra={<Badge tone={doneCount === steps.length ? 'success' : 'brand'}>{doneCount} / {steps.length}</Badge>}
      />
      <CardBody>
        <div className="dash-guide__progress">
          <Ring value={percent} label={<>{percent}<span className="dash-guide__ring-unit">%</span></>} size={64} />
          <div className="dash-guide__progress-text">
            <div className="dash-guide__progress-title">{doneCount === steps.length ? '已经全部就绪' : '还差 ' + (steps.length - doneCount) + ' 步'}</div>
            <Progress value={percent} thin />
            <div className="dim text-xs">点任意一步可以跳到对应页面，自主生活可以直接开关。</div>
          </div>
        </div>
        <div className="dash-guide__steps">
          {steps.map((step) => (
            <div className={cn('dash-guide__step', step.done && 'is-done')} key={step.key}>
              <button type="button" className="dash-guide__main" onClick={step.action}>
                <span className="dash-guide__mark">{step.done ? <Check size={12} /> : <Circle size={11} />}</span>
                <span className="dash-guide__text">
                  <span className="dash-guide__title">{step.icon}{step.title}</span>
                  <span className="dash-guide__desc">{step.desc}</span>
                </span>
              </button>
              {step.key === 'life' ? (
                <Toggle checked={settings.autonomy.enabled} onChange={() => onToggleLife()} disabled={lifeBusy} label="自主生活" />
              ) : (
                <ArrowRight size={14} className="dash-guide__arrow" />
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

export function RelationshipCard({ relationship, onChat }: { relationship?: RelationshipState; onChat: () => void }) {
  const hasData = Boolean(relationship && (relationship.interactions > 0 || relationship.affinity > 0 || relationship.notes.length));
  return (
    <Card className="dash-relation">
      <CardHead title={<><span className="dash-panel-icon is-pink"><Heart size={14} /></span>与你的关系</>} desc="她记得你们一起走过的时间。" />
      <CardBody>
        {!hasData || !relationship ? (
          <div className="dash-relation__empty">
            <Heart size={22} />
            <div>关系还在最初的样子。</div>
            <p>去聊几句，好感、信任和熟悉度会慢慢长出来。</p>
            <Button variant="secondary" size="sm" icon={<MessageCircle size={13} />} onClick={onChat}>去和她说说话</Button>
          </div>
        ) : (
          <>
            <div className="dash-relation__top">
              <Ring value={Math.max(0, Math.min(100, relationship.affinity))} label={Math.round(relationship.affinity)} size={62} />
              <div>
                <div className="dash-relation__level">好感 {Math.round(relationship.affinity)} · 信任 {Math.round(relationship.trust)}</div>
                <div className="dim text-xs">最近互动 {relativeTime(relationship.lastInteractionAt) || '刚刚'}</div>
                <div className="dim text-xs">初识 {formatDate(relationship.firstMetAt) || '刚刚'}</div>
              </div>
            </div>
            <div className="dash-relation__stats">
              <div><b>{formatNumber(relationship.interactions)}</b><span>互动</span></div>
              <div><b>{Math.max(0, relationship.streakDays)} 天</b><span>连续陪伴</span></div>
              <div><b>{relationship.lastMood || '平静'}</b><span>最近情绪</span></div>
            </div>
            {relationship.notes.length > 0 && (
              <div className="dash-relation__note">“{relationship.notes[relationship.notes.length - 1]}”</div>
            )}
            <Button variant="ghost" size="sm" icon={<MessageCircle size={13} />} onClick={onChat}>继续聊天</Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

const NAPCAT_LABEL: Record<NapCatStatus['kind'], string> = {
  stopped: '未启动',
  starting: '启动中',
  running: '运行中',
  online: 'QQ 在线',
  error: '异常',
  installing: '安装中',
  'waiting-login': '等待登录',
};

export function SystemStatus({
  integrations, napcat, plugins, onNavigate,
}: {
  integrations: IntegrationStatus[];
  napcat: NapCatStatus;
  plugins: PluginInfo[];
  onNavigate: (route: string, tab?: string) => void;
}) {
  const find = (id: string) => integrations.find((item) => item.id === id);
  const deepseek = find('deepseek');
  const breeze = find('breezeblue');
  const enabledPlugins = plugins.filter((plugin) => plugin.enabled).length;
  const rows = [
    {
      key: 'deepseek',
      icon: <Cpu size={14} />,
      label: 'DeepSeek',
      detail: deepseek?.connected ? '已连接' : deepseek?.configured ? '已配置 · 未检测' : '未配置',
      ok: Boolean(deepseek?.configured),
      action: () => onNavigate('settings', 'keys'),
    },
    {
      key: 'napcat',
      icon: <TerminalSquare size={14} />,
      label: 'NapCat',
      detail: NAPCAT_LABEL[napcat.kind] ?? napcat.kind,
      ok: napcat.kind === 'online' || napcat.qqOnline,
      action: () => onNavigate('napcat'),
    },
    {
      key: 'breeze',
      icon: <Sparkles size={14} />,
      label: 'BreezeBlue',
      detail: breeze?.connected ? '已连接' : breeze?.configured ? '已配置 · 未检测' : '未配置',
      ok: Boolean(breeze?.configured),
      action: () => onNavigate('settings', 'models'),
    },
    {
      key: 'plugins',
      icon: <Plug size={14} />,
      label: '插件',
      detail: enabledPlugins + ' / ' + plugins.length + ' 已启用',
      ok: enabledPlugins > 0,
      action: () => onNavigate('plugins'),
    },
  ];

  return (
    <Card className="dash-system">
      <CardHead title={<><span className="dash-panel-icon is-mint"><CheckCircle2 size={14} /></span>系统状态</>} desc="她此刻能用到哪些能力。" />
      <CardBody>
        <div className="dash-system__rows">
          {rows.map((row) => (
            <button type="button" key={row.key} className="dash-system__row" onClick={row.action}>
              <span className={cn('dash-system__icon', row.ok && 'is-ok')}>{row.icon}</span>
              <span className="dash-system__label">{row.label}</span>
              <span className={cn('dash-system__detail', row.ok && 'is-ok')}>{row.ok ? <Wifi size={11} /> : <WifiOff size={11} />}{row.detail}</span>
            </button>
          ))}
        </div>
        <div className="dash-system__foot">
          <ShieldCheck size={12} />
          <span>所有状态都来自本机主进程的实时快照。</span>
        </div>
      </CardBody>
    </Card>
  );
}
