import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  ArrowLeft, ArrowRight, Brain, Check, CheckCircle2, Drama, Heart, KeyRound, Loader2,
  RefreshCw, ShieldCheck, Sparkles, TerminalSquare, Users, Wifi, X, Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import { Badge, Button, Field, Input, Toggle, cn, useToast } from '@/components/ui';
import { assetUrl } from '@/lib/assets';
import { personaAvatarUrl } from '@/lib/persona';
import '@/styles/onboarding.css';

const STEPS = [
  { key: 'welcome', eyebrow: 'WELCOME', title: '你好，我是鲸鲸' },
  { key: 'brain', eyebrow: 'BRAIN', title: '先给我一颗大脑' },
  { key: 'qq', eyebrow: 'QQ CHANNEL', title: '让我游进 QQ' },
  { key: 'persona', eyebrow: 'PERSONALITY', title: '挑一个性格的我' },
  { key: 'life', eyebrow: 'BOUNDARIES & LIFE', title: '告诉我怎么陪你' },
  { key: 'done', eyebrow: 'READY', title: '一切就绪' },
] as const;

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function OnboardingWizard() {
  const {
    settings, keyStatus, personas, activePersona, napcat, refreshNapcat, saveSettings,
    setSettings, setOnboardingDone,
  } = useApp();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [maxVisited, setMaxVisited] = useState(0);
  const [deepseekKey, setDeepseekKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [keyResult, setKeyResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null);
  const [selectedPersonaId, setSelectedPersonaId] = useState(activePersona?.id ?? personas[0]?.id ?? '');
  const [ownerQQ, setOwnerQQ] = useState(settings.general.ownerQQ || '');
  const [lifeEnabled, setLifeEnabled] = useState(settings.autonomy.enabled);
  const [proactiveEnabled, setProactiveEnabled] = useState(settings.autonomy.proactiveEnabled);
  const [installing, setInstalling] = useState(false);
  const [napcatMessage, setNapcatMessage] = useState<string | null>(null);
  const [welcomeBroken, setWelcomeBroken] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPersonaId && personas[0]) setSelectedPersonaId(personas[0].id);
  }, [personas, selectedPersonaId]);

  const selectedPersona = useMemo(() => personas.find((persona) => persona.id === selectedPersonaId) ?? activePersona, [personas, selectedPersonaId, activePersona]);
  const qqOnline = napcat.kind === 'online' || napcat.qqOnline;

  const goTo = (next: number) => {
    const bounded = Math.max(0, Math.min(STEPS.length - 1, next));
    setStep(bounded);
    setMaxVisited((previous) => Math.max(previous, bounded));
  };

  const testKey = async () => {
    if (testingKey) return;
    setTestingKey(true);
    setKeyResult(null);
    try {
      const draft = deepseekKey.trim();
      if (draft) {
        await saveSettings(undefined, { deepseek: draft });
        setDeepseekKey('');
        toast.success('DeepSeek Key 已保存', '之后也可以在设置页替换。');
      }
      const result = await api.settings.test('deepseek');
      setKeyResult(result);
      if (result.ok) toast.success('大脑连接正常', result.latencyMs !== undefined ? '耗时 ' + result.latencyMs + ' ms' : result.message);
      else toast.error('大脑还没连上', result.message);
    } catch (caught) {
      setKeyResult({ ok: false, message: errText(caught) });
      toast.error('测试失败', errText(caught));
    } finally {
      setTestingKey(false);
    }
  };

  const installNapcat = async () => {
    if (installing) return;
    setInstalling(true);
    setNapcatMessage(null);
    try {
      const result = await api.napcat.install('onekey');
      setNapcatMessage(result.message);
      if (result.ok) {
        await refreshNapcat();
        toast.success('NapCat 安装完成', result.message);
      } else {
        toast.warning('安装没有完成', result.message);
      }
    } catch (caught) {
      const message = errText(caught);
      setNapcatMessage(message);
      toast.error('安装 NapCat 失败', message);
    } finally {
      setInstalling(false);
    }
  };

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    try {
      const owner = ownerQQ.trim();
      const owners = owner ? Array.from(new Set([...(settings.permissions.owners ?? []), owner])) : settings.permissions.owners;
      await saveSettings({
        general: { ...settings.general, ownerQQ: owner || settings.general.ownerQQ },
        permissions: { ...settings.permissions, owners },
        autonomy: {
          ...settings.autonomy,
          enabled: lifeEnabled,
          proactiveEnabled: lifeEnabled ? proactiveEnabled : false,
        },
        persona: { ...settings.persona, activeId: selectedPersonaId || settings.persona.activeId },
      });
      if (deepseekKey.trim()) await saveSettings(undefined, { deepseek: deepseekKey.trim() });
      if (selectedPersonaId && selectedPersonaId !== activePersona?.id) {
        const result = await api.personas.setActive(selectedPersonaId);
        setSettings(result.settings);
      }
      await setOnboardingDone();
      toast.success('欢迎来到鲸鲸的世界', '引导已完成。之后可以在「设置」里重新观看。');
      window.location.hash = '/dashboard';
    } catch (caught) {
      const message = errText(caught);
      setError(message);
      toast.error('保存引导设置失败', message);
    } finally {
      setFinishing(false);
    }
  };

  const badgeStatus = keyStatus.deepseek || keyResult?.ok;

  return (
    <div className="ob-backdrop" role="dialog" aria-modal="true" aria-label="首次使用引导">
      <div className="ob-bubble ob-bubble--1" aria-hidden />
      <div className="ob-bubble ob-bubble--2" aria-hidden />
      <div className="ob-bubble ob-bubble--3" aria-hidden />

      <div className="ob-shell">
        <div className="ob-top">
          <div className="ob-brand">
            <div className="ob-brand__logo">
              {logoBroken ? <span className="ob-brand__logo-fallback" aria-hidden>🐳</span> : <img src={assetUrl('memes/可爱.png')} alt="鲸鲸" onError={() => setLogoBroken(true)} />}
            </div>
            <div>
              <div className="ob-brand__name">鲸鲸 <span>· QQ 智能伙伴</span></div>
              <div className="ob-brand__sub">首次使用引导 · 大约 2 分钟</div>
            </div>
          </div>
          <div className="ob-top__right">
            <div className="ob-dots" role="tablist" aria-label="引导进度">
              {STEPS.map((item, index) => (
                <button
                  type="button"
                  key={item.key}
                  className={cn('ob-dot', index === step && 'is-active', index < step && 'is-past', index > maxVisited && 'is-locked')}
                  onClick={() => { if (index <= maxVisited) goTo(index); }}
                  aria-label={'第 ' + (index + 1) + ' 步：' + item.title}
                  aria-current={index === step}
                />
              ))}
            </div>
            <button type="button" className="ob-later" onClick={() => void finish()} disabled={finishing}>稍后再说</button>
            <button type="button" className="ob-close" onClick={() => void finish()} disabled={finishing} aria-label="关闭引导并保存当前设置"><X size={17} /></button>
          </div>
        </div>

        <div className="ob-body">
          <div className="ob-content">
            <div className="ob-eyebrow">{STEPS[step].eyebrow}</div>
            <h1 className="ob-title">{STEPS[step].title}</h1>

            {step === 0 && (
              <div className="ob-welcome">
                <div className="ob-welcome__pet">
                  <span className="ob-welcome__glow" />
                  {welcomeBroken ? (
                    <span className="ob-welcome__emoji" aria-hidden>🐋</span>
                  ) : (
                    <video className="ob-welcome__video" src={assetUrl('animations/蓝鲸现世.webm')} autoPlay loop muted playsInline onError={() => setWelcomeBroken(true)} />
                  )}
                </div>
                <p className="ob-lead">我从 DeepSeek 的蓝海里游来，是住在你电脑里的小鲸鱼。我会记住你在意的小事，也会在你不在的时候，自己写日记、听歌、学习，慢慢长大。</p>
                <div className="ob-caps">
                  {[
                    { icon: <Heart size={15} />, title: '陪你聊天', desc: 'QQ 私聊与群聊，语气像真的朋友' },
                    { icon: <Brain size={15} />, title: '长期记忆', desc: '每个联系人与群聊独立成册' },
                    { icon: <Sparkles size={15} />, title: '自主成长', desc: '情绪、日记与自己的小生活' },
                    { icon: <Zap size={15} />, title: '多模态创作', desc: '图片、视频、音乐和语音' },
                  ].map((cap) => (
                    <div className="ob-cap" key={cap.title}>
                      <span className="ob-cap__icon">{cap.icon}</span>
                      <b>{cap.title}</b>
                      <span>{cap.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="ob-step">
                <div className="ob-keybox">
                  <div className="ob-keybox__head">
                    <span className="ob-keybox__icon"><KeyRound size={17} /></span>
                    <div>
                      <div className="ob-keybox__title">DeepSeek API Key</div>
                      <div className="ob-keybox__desc">对话、日记、反思和人设生成都由它驱动。</div>
                    </div>
                    <Badge tone={badgeStatus ? 'success' : 'default'}>{badgeStatus ? '已配置' : '未配置'}</Badge>
                  </div>
                  <div className="ob-keybox__row">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={deepseekKey}
                      onChange={(event) => setDeepseekKey(event.target.value)}
                      placeholder={keyStatus.deepseek ? '已保存，输入新 Key 可替换' : '粘贴 sk-… 开头的 DeepSeek Key'}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="DeepSeek API Key"
                    />
                    <Button variant="ghost" size="sm" onClick={() => setShowKey((value) => !value)}>{showKey ? '隐藏' : '显示'}</Button>
                    <Button variant="secondary" size="sm" icon={testingKey ? <Loader2 size={13} className="spin" /> : <Zap size={13} />} loading={testingKey} onClick={() => void testKey()}>测试</Button>
                  </div>
                  {keyResult && <div className={keyResult.ok ? 'ob-result is-ok' : 'ob-result is-bad'}>{keyResult.ok ? <CheckCircle2 size={13} /> : <X size={13} />}{keyResult.message}{keyResult.latencyMs !== undefined ? ' · ' + keyResult.latencyMs + ' ms' : ''}</div>}
                  <div className="ob-keybox__foot"><ShieldCheck size={12} />密钥会经系统安全存储加密，只保存在本机。<button type="button" className="ob-link" onClick={() => void api.openExternal('https://platform.deepseek.com/api_keys').catch(() => undefined)}>去 DeepSeek 获取 Key</button></div>
                </div>
                <div className="ob-note"><Sparkles size={14} /><span>也可以先跳过。没有 Key 时鲸鲸只能跑本地演示回复，配置后她会立刻变得聪明。</span></div>
              </div>
            )}

            {step === 2 && (
              <div className="ob-step">
                <div className="ob-napcat">
                  <div className="ob-napcat__head">
                    <span className={cn('ob-napcat__icon', qqOnline && 'is-ok')}><TerminalSquare size={18} /></span>
                    <div>
                      <div className="ob-napcat__title">NapCat / OneBot 协议端</div>
                      <div className="ob-napcat__desc">负责把鲸鲸接到真实的 QQ：私聊、群聊、语音和图片都通过它。</div>
                    </div>
                    <Badge tone={qqOnline ? 'success' : napcat.installed ? 'warning' : 'default'}>{qqOnline ? 'QQ 在线' : napcat.installed ? '已安装' : '未安装'}</Badge>
                  </div>
                  <div className="ob-napcat__rows">
                    <div><span>当前状态</span><b>{napcat.kind === 'online' ? 'QQ 在线' : napcat.kind === 'waiting-login' ? '等待扫码登录' : napcat.kind === 'running' ? '运行中' : napcat.installed ? '已安装，未启动' : '尚未安装'}</b></div>
                    <div><span>安装目录</span><b className="mono" title={napcat.installDir}>{napcat.installDir || '还没有设置目录'}</b></div>
                    {napcat.lastError && <div><span>最近错误</span><b className="is-error">{napcat.lastError}</b></div>}
                  </div>
                  {napcatMessage && <div className="ob-result">{napcatMessage}</div>}
                  <div className="ob-napcat__actions">
                    <Button variant="secondary" icon={installing ? <Loader2 size={14} className="spin" /> : napcat.installed ? <RefreshCw size={14} /> : <TerminalSquare size={14} />} loading={installing} onClick={() => (napcat.installed ? void refreshNapcat().catch((error) => toast.error('刷新状态失败', errText(error))) : void installNapcat())}>
                      {napcat.installed ? '检查连接状态' : '一键安装 NapCat'}
                    </Button>
                    <span className="dim text-xs">安装完成后需要扫码登录 QQ；不建议使用主号。</span>
                  </div>
                </div>
                <div className="ob-note"><ShieldCheck size={14} /><span>接入 QQ 有账号风控风险，请自行评估。暂时跳过也可以，本地聊天与全部记忆功能仍然可用。</span></div>
              </div>
            )}

            {step === 3 && (
              <div className="ob-step">
                <p className="ob-lead">八位鲸娘同源而生，性格却完全不同。先挑一位开始，之后随时可以在人设工坊切换，或者养一位新的。</p>
                <div className="ob-personas">
                  {personas.map((persona) => {
                    const avatar = personaAvatarUrl(persona);
                    const active = persona.id === selectedPersonaId;
                    return (
                      <button
                        type="button"
                        key={persona.id}
                        className={cn('ob-persona', active && 'is-active')}
                        onClick={() => setSelectedPersonaId(persona.id)}
                        style={{ ['--p-c' as string]: persona.color || 'var(--brand)' } as CSSProperties}
                      >
                        <span className="ob-persona__avatar">
                          {avatar ? <img src={avatar} alt={persona.name} /> : <span>{persona.avatar || '🐋'}</span>}
                        </span>
                        <span className="ob-persona__name">{persona.name}</span>
                        <span className="ob-persona__title">{persona.title}</span>
                        <span className="ob-persona__tagline">{persona.tagline}</span>
                        <span className="ob-persona__traits">{persona.traits.slice(0, 3).map((trait) => <i key={trait}>{trait}</i>)}</span>
                        {active && <span className="ob-persona__check"><Check size={12} /></span>}
                      </button>
                    );
                  })}
                </div>
                {selectedPersona && <div className="ob-note"><Drama size={14} /><span>你选中了「{selectedPersona.nickname || selectedPersona.name}」：{selectedPersona.tagline}</span></div>}
              </div>
            )}

            {step === 4 && (
              <div className="ob-step">
                <div className="ob-life">
                  <div className="ob-life__section">
                    <div className="ob-life__head"><Users size={15} /><b>我是谁</b></div>
                    <Field label="主人 QQ" hint="用来认出你，并给你最高权限。之后可以在设置里添加管理员和白名单。">
                      <Input value={ownerQQ} onChange={(event) => setOwnerQQ(event.target.value.replace(/[^0-9]/g, ''))} placeholder="输入你的 QQ 号" inputMode="numeric" maxLength={20} />
                    </Field>
                  </div>
                  <div className="ob-life__section">
                    <div className="ob-life__head"><Sparkles size={15} /><b>她怎么生活</b></div>
                    <div className="ob-switch-row"><div><b>开启自主生活</b><span>她会在你不在时写日记、发说说、逛 B 站、学习。</span></div><Toggle checked={lifeEnabled} onChange={setLifeEnabled} label="自主生活" /></div>
                    <div className={cn('ob-switch-row', !lifeEnabled && 'is-disabled')}><div><b>主动来找你</b><span>在她觉得合适的时候先开口，安静时段除外。</span></div><Toggle checked={proactiveEnabled} onChange={setProactiveEnabled} disabled={!lifeEnabled} label="主动消息" /></div>
                    <div className="ob-quiet"><span>安静时段</span><b>{settings.autonomy.quietStart} – {settings.autonomy.quietEnd}</b><span className="dim">之后可在设置里调整</span></div>
                  </div>
                </div>
                <div className="ob-note"><Heart size={14} /><span>这些都可以随时修改。鲸鲸会先学会尊重你的作息，再慢慢靠近。</span></div>
              </div>
            )}

            {step === 5 && (
              <div className="ob-step">
                <div className="ob-summary">
                  {[
                    { label: 'DeepSeek 大脑', value: keyStatus.deepseek ? '已配置' : keyResult?.ok ? '已配置' : deepseekKey.trim() ? '完成引导时保存' : '稍后配置', ok: Boolean(keyStatus.deepseek || keyResult?.ok || deepseekKey.trim()) },
                    { label: 'QQ 通道', value: qqOnline ? '已在线' : napcat.installed ? '已安装，待登录' : '稍后设置', ok: qqOnline },
                    { label: '性格', value: selectedPersona ? (selectedPersona.nickname || selectedPersona.name) : '保持默认', ok: true },
                    { label: '主人 QQ', value: ownerQQ || '稍后设置', ok: Boolean(ownerQQ) },
                    { label: '自主生活', value: lifeEnabled ? (proactiveEnabled ? '已开启 · 会主动找你' : '已开启 · 不主动打扰') : '已关闭', ok: lifeEnabled },
                  ].map((row) => (
                    <div className="ob-summary__row" key={row.label}>
                      <span className={cn('ob-summary__mark', row.ok && 'is-ok')}>{row.ok ? <Check size={12} /> : <span />}</span>
                      <span className="ob-summary__label">{row.label}</span>
                      <span className="ob-summary__value">{row.value}</span>
                    </div>
                  ))}
                </div>
                {error && <div className="ob-result is-bad">{error}</div>}
                <p className="ob-lead">点下面的按钮后，所有内容会真实写入本地设置。想重新看一遍引导，可以随时在「设置 · 上下文与数据」里打开。</p>
              </div>
            )}
          </div>

          <aside className="ob-side">
            <div className="ob-side__card">
              <div className="ob-side__eyebrow">她的世界</div>
              <div className="ob-side__name">{selectedPersona?.nickname || selectedPersona?.name || '鲸鲸'}</div>
              <div className="ob-side__title">{selectedPersona?.title || 'DeepSeek 蓝鲸娘'}</div>
              <div className="ob-side__stats">
                <div><b>{keyStatus.deepseek || keyResult?.ok || deepseekKey.trim() ? '✓' : '—'}</b><span>大脑</span></div>
                <div><b>{qqOnline ? '✓' : napcat.installed ? '…' : '—'}</b><span>QQ</span></div>
                <div><b>{lifeEnabled ? '✓' : '—'}</b><span>生活</span></div>
              </div>
              <div className="ob-side__hint"><Wifi size={12} />{qqOnline ? 'QQ 通道已在线' : '可以先在本地陪着你'}</div>
            </div>
            <div className="ob-side__quote">“{selectedPersona?.catchphrases?.[0] || '鲸鲸在呢～'}”</div>
            <div className="ob-side__foot"><ShieldCheck size={12} />所有设置只保存在本机</div>
          </aside>
        </div>

        <div className="ob-footer">
          <div className="ob-progress"><span style={{ width: ((step + 1) / STEPS.length) * 100 + '%' }} /></div>
          <div className="ob-footer__actions">
            <Button variant="ghost" icon={<ArrowLeft size={14} />} onClick={() => goTo(step - 1)} disabled={step === 0 || finishing}>上一步</Button>
            <span className="dim text-xs">第 {step + 1} / {STEPS.length} 步</span>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" icon={<ArrowRight size={14} />} onClick={() => goTo(step + 1)} disabled={finishing}>下一步</Button>
            ) : (
              <Button variant="primary" icon={finishing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />} loading={finishing} onClick={() => void finish()}>进入鲸鲸的世界</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
