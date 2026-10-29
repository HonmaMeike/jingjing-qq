import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Play, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { VoiceInfo } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import {
  Badge, Button, Card, CardBody, CardHead, EmptyState, Field, Input, Select, Spinner, Toggle, useToast,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';
import type { PatchSection } from '@/components/settings/settingsMeta';

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function VoiceCard({ settings, patch }: { settings: import('@shared/types').AppSettings; patch: PatchSection }) {
  const { activePersona, keyStatus } = useApp();
  const toast = useToast();
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [latestVoiceId, setLatestVoiceId] = useState<string | undefined>(undefined);
  const [syncedAt, setSyncedAt] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [voiceQuery, setVoiceQuery] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loadedRef = useRef(false);

  const loadVoices = useCallback(async (refresh = false) => {
    if (refresh) setSyncing(true); else setLoading(true);
    setError(null);
    try {
      const result = await api.integrations.voices(refresh);
      setVoices(result.voices ?? []);
      setLatestVoiceId(result.latestVoiceId);
      setSyncedAt(result.syncedAt);
      if (refresh) toast.success('音色库已同步', result.total ? '共 ' + result.total + ' 个音色' : '暂时没有可用音色');
    } catch (caught) {
      setError(errText(caught));
    } finally {
      if (refresh) setSyncing(false); else setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void loadVoices(false);
  }, [loadVoices]);

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null; }, []);

  const selected = voices.find((voice) => voice.voiceId === settings.models.breezeVoiceId);
  const keyword = voiceQuery.trim().toLowerCase();
  const filteredVoices = keyword
    ? voices.filter((voice) => [voice.name, voice.language, voice.gender, voice.accent, voice.voiceId].filter(Boolean).join(' ').toLowerCase().includes(keyword))
    : voices;

  const preview = async () => {
    if (previewing) return;
    const text = previewText.trim() || activePersona?.greeting || activePersona?.catchphrases?.[0] || '你好呀，我是鲸鲸。';
    setPreviewing(true);
    try {
      const result = await api.integrations.tts(text, activePersona?.id, settings.models.breezeVoiceId || undefined);
      if (!result.ok || !result.url) {
        toast.error('试听失败', result.error || '没有拿到音频地址，请检查 BreezeBlue 配置或音色');
        return;
      }
      audioRef.current?.pause();
      const audio = new Audio(result.url);
      audioRef.current = audio;
      audio.onerror = () => toast.error('音频播放失败', '媒体文件可能已被删除，重新试听一次试试');
      await audio.play();
      toast.success('正在播放她的声音', text.slice(0, 24) + (text.length > 24 ? '…' : ''));
    } catch (caught) {
      toast.error('试听失败', errText(caught));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <Card className="stg-voice">
      <CardHead
        title={<><span className="stg-card-icon is-mint"><AudioLines size={15} /></span>声音与音色</>}
        desc={'BreezeBlue 提供中文语音；当前音色会绑定到「' + (activePersona?.name || '当前人设') + '」，切换人设时自动跟随，也可随时手动更改。'}
        extra={<Badge tone={keyStatus.breezeblue ? 'success' : 'default'}>{keyStatus.breezeblue ? 'BreezeBlue 已配置' : '未配置 BreezeBlue'}</Badge>}
      />
      <CardBody>
        <div className="stg-voice__status">
          <div>
            <div className="stg-voice__count">{voices.length}<span>个音色</span></div>
            <div className="stg-voice__meta">
              {syncedAt ? '上次同步 ' + relativeTime(syncedAt) : '还没有同步过音色库'}
              {latestVoiceId ? ' · 最新 ' + (voices.find((voice) => voice.voiceId === latestVoiceId)?.name ?? latestVoiceId) : ''}
            </div>
          </div>
          <div className="row no-wrap">
            <Button variant="secondary" size="sm" icon={<RefreshCw size={13} className={syncing ? 'spin' : ''} />} loading={syncing} onClick={() => void loadVoices(true)}>
              同步音色库
            </Button>
            <Button variant="primary" size="sm" icon={<Play size={13} />} loading={previewing} onClick={() => void preview()} disabled={!keyStatus.breezeblue}>
              试听
            </Button>
          </div>
        </div>

        {error && (
          <div className="stg-inline-error">
            {error}
            <Button variant="ghost" size="sm" onClick={() => void loadVoices(false)}>重试</Button>
          </div>
        )}

        {loading ? (
          <Spinner label="正在读取音色库" />
        ) : voices.length === 0 ? (
          <EmptyState
            icon={<AudioLines size={21} />}
            title="音色库还是空的"
            desc={keyStatus.breezeblue ? '点「同步音色库」从 BreezeBlue 拉取可用音色。' : '先在「API 密钥」里配置 BreezeBlue，再回来同步音色。'}
            action={<Button variant="secondary" icon={<RefreshCw size={13} />} loading={syncing} onClick={() => void loadVoices(true)}>同步音色库</Button>}
          />
        ) : (
          <>
            <div className="stg-voice__search">
              <Input value={voiceQuery} onChange={(event) => setVoiceQuery(event.target.value)} placeholder="搜索音色名、语言或性别…" aria-label="搜索音色" />
              {keyword && <span className="dim text-xs">{filteredVoices.length} 个匹配</span>}
            </div>
            <div className="stg-form stg-form--3">
              <Field label="语音模型" hint="BreezeBlue TTS 模型 id">
                <Input value={settings.models.breezeTts} onChange={(event) => patch('models', { breezeTts: event.target.value })} placeholder="breeze-tts-2-multilingual" />
              </Field>
              <Field label="当前音色" hint={(selected ? [selected.language, selected.gender, selected.accent].filter(Boolean).join(' · ') : '从同步到的音色里挑一个') + ' · 仅绑定当前人设'}>
                <Select
                  value={settings.models.breezeVoiceId}
                  onChange={(event) => {
                    const next = voices.find((voice) => voice.voiceId === event.target.value);
                    patch('models', { breezeVoiceId: event.target.value, breezeVoiceName: next?.name ?? '' });
                  }}
                >
                  <option value="">让鲸鲸自己挑（默认最新）</option>
                  {filteredVoices.map((voice) => (
                    <option key={voice.voiceId} value={voice.voiceId}>
                      {voice.name}{voice.language ? ' · ' + voice.language : ''}{voice.gender ? ' · ' + voice.gender : ''}{voice.voiceId === latestVoiceId ? ' · 最新' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="试听文本" hint="留空就用她的问候语；试听会消耗一次 TTS 调用。">
                <Input value={previewText} onChange={(event) => setPreviewText(event.target.value)} placeholder={activePersona?.greeting || '你好呀，我是鲸鲸。'} maxLength={200} />
              </Field>
            </div>

            <div className="stg-voice__toggles">
              <label className="stg-switch"><Toggle checked={settings.tts.enabled} onChange={(value) => patch('tts', { enabled: value })} label="启用语音回复" /><span>启用语音回复</span></label>
              <label className="stg-switch"><Toggle checked={settings.tts.sendVoiceInQQ} onChange={(value) => patch('tts', { sendVoiceInQQ: value })} label="在 QQ 里发语音" /><span>在 QQ 里发语音</span></label>
              <label className="stg-switch"><Toggle checked={settings.tts.playLocally} onChange={(value) => patch('tts', { playLocally: value })} label="本地播放" /><span>本地播放</span></label>
              <label className="stg-switch"><Toggle checked={settings.tts.autoSyncVoices} onChange={(value) => patch('tts', { autoSyncVoices: value })} label="自动同步音色" /><span>自动同步音色</span></label>
              <label className="stg-switch"><Toggle checked={settings.tts.preferLatestVoice} onChange={(value) => patch('tts', { preferLatestVoice: value })} label="优先最新音色" /><span>优先最新音色</span></label>
            </div>

            <div className="stg-form stg-form--3">
              <Field label="语音回复概率" hint="0–1，越高越常发语音">
                <Input type="number" min={0} max={1} step={0.01} value={settings.tts.voiceReplyChance} onChange={(event) => patch('tts', { voiceReplyChance: Number(event.target.value) })} />
              </Field>
              <Field label="朗读指令强度" hint="BreezeBlue guidanceScale">
                <Input type="number" min={0.5} max={4} step={0.1} value={settings.tts.guidanceScale} onChange={(event) => patch('tts', { guidanceScale: Number(event.target.value) })} />
              </Field>
              <Field label="语速倍率" hint="0.5–2.0，默认 1.15；调快可减少语音拖沓感">
                <Input type="number" min={0.5} max={2} step={0.05} value={settings.tts.speed ?? 1.15} onChange={(event) => patch('tts', { speed: Number(event.target.value) })} />
              </Field>
              <Field label="单条最多字数">
                <Input type="number" min={40} max={600} step={10} value={settings.tts.maxChars} onChange={(event) => patch('tts', { maxChars: Number(event.target.value) })} />
              </Field>
              <Field label="输出格式">
                <Select value={settings.tts.outputFormat} onChange={(event) => patch('tts', { outputFormat: event.target.value as 'mp3' | 'wav' })}>
                  <option value="mp3">mp3</option>
                  <option value="wav">wav</option>
                </Select>
              </Field>
              <Field label="朗读语言">
                <Input value={settings.tts.language} onChange={(event) => patch('tts', { language: event.target.value })} />
              </Field>
            </div>

            <Field label="额外朗读指令" hint="会与角色语气指令拼接后传给 TTS，例如停顿、情绪、口癖。">
              <textarea className="textarea" rows={3} value={settings.tts.instructions} onChange={(event) => patch('tts', { instructions: event.target.value })} />
            </Field>

            <div className="stg-voice__foot">
              <ShieldCheck size={13} />
              <span>音色列表缓存在本地；点「试听」会用当前音色真实合成一段音频。</span>
              <Sparkles size={13} />
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
