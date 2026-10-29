import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Film, Image as ImageIcon, Loader2, Music, Send, Sparkles, Wand2, XCircle,
} from 'lucide-react';
import type { AppSettings, MediaJob, Persona } from '@shared/types';
import { api } from '@/lib/api';
import { useApp } from '@/app/AppProvider';
import {
  Badge, Button, Field, Input, Modal, Select, Spinner, Tabs, Textarea, Toggle, useToast,
} from '@/components/ui';
import MediaImage from '@/components/growth/MediaImage';
import { MINIMAX_VIDEO_MODELS, VIDEO_ASPECTS, videoCapabilities } from '@/components/settings/settingsMeta';

type StudioTab = 'image' | 'video' | 'music';

const IMAGE_ASPECTS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

const EXAMPLES: Record<StudioTab, string[]> = {
  image: ['鲸鲸在深海图书馆里看书，蓝色 bioluminescence，电影感', '雨夜窗边，小鲸鱼捧着一碗热白饭', '鲸落海的极光下，鲸鱼尾巴扫过泡泡'],
  video: ['鲸鲸在珊瑚间追泡泡，镜头缓慢推进，蓝色调', '蓝鲸跃出海面，慢镜头，阳光穿过浪花', '深海图书馆的书页被水流轻轻翻开'],
  music: ['一首关于深海和晚安的温柔民谣，木吉他，轻声', '轻快的海底爵士，鲸鱼尾巴打节拍，女声哼唱', '写给熬夜的人的一首安静钢琴曲'],
};

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Props {
  open: boolean;
  onClose: () => void;
  persona?: Persona;
  settings: AppSettings;
  onOpenSettings: () => void;
}

export default function CreationStudio({ open, onClose, persona, settings, onOpenSettings }: Props) {
  const toast = useToast();
  const { saveSettings, keyStatus } = useApp();
  const [tab, setTab] = useState<StudioTab>('image');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState(settings.media.imageAspectRatio || '4:3');
  const [resolution, setResolution] = useState(settings.models.minimaxVideoResolution || '2K');
  const [duration, setDuration] = useState(settings.models.minimaxVideoDuration || 6);
  const [videoModel, setVideoModel] = useState(settings.models.minimaxVideo || 'MiniMax-H3');
  const [videoAspect, setVideoAspect] = useState(settings.media.videoAspectRatio || '16:9');
  const [instrumental, setInstrumental] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missingKey, setMissingKey] = useState(false);
  const [result, setResult] = useState<MediaJob | null>(null);
  const [sharing, setSharing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!busy) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [busy]);

  const switchTab = (next: StudioTab) => {
    if (busy) return;
    setTab(next);
    setError(null);
    setMissingKey(false);
    setResult(null);
  };

  const handleClose = () => {
    if (busy) {
      toast.info('正在生成，请稍候', '关闭窗口不会中断任务，作品会保存在本地媒体目录。');
      return;
    }
    onClose();
  };


  const shareResult = async () => {
    if (!result || sharing) return;
    const url = tab === 'music' ? result.result?.audioUrl : result.result?.urls?.[0];
    if (!url) { toast.warning('还没有可发送的作品', '等生成完成后再发到聊天。'); return; }
    setSharing(true);
    try {
      await api.chat.shareCreation({ kind: tab === 'music' ? 'music' : tab === 'video' ? 'video' : 'image', url, title: result.result?.title || prompt.slice(0, 40) });
      toast.success('已发送到聊天', '打开聊天页就能看到这件作品。');
    } catch (error) {
      toast.error('发送失败', error instanceof Error ? error.message : String(error));
    } finally {
      setSharing(false);
    }
  };

  const generate = async () => {
    if (busy) return;
    const idea = prompt.trim();
    if (!idea) {
      toast.warning('先写一点灵感', '描述画面、镜头或音乐氛围，她才能开始创作。');
      return;
    }
    setBusy(true);
    setError(null);
    setMissingKey(false);
    setResult(null);
    try {
      let job: MediaJob;
      if (tab === 'image') {
        job = await api.integrations.image(idea, aspect);
      } else if (tab === 'video') {
        if (videoModel !== settings.models.minimaxVideo || videoAspect !== settings.media.videoAspectRatio) {
          await saveSettings({
            models: { ...settings.models, minimaxVideo: videoModel, minimaxVideoResolution: resolution, minimaxVideoDuration: duration },
            media: { ...settings.media, videoAspectRatio: videoAspect },
          });
        }
        job = await api.integrations.video(idea, duration, resolution);
      } else {
        job = await api.integrations.music({ prompt: idea, instrumental });
      }
      if (job.status === 'failed') {
        const message = job.error || '生成失败';
        setError(message);
        setMissingKey(/API Key|密钥|配置/i.test(message));
        toast.error('这次没有生成成功', message);
        return;
      }
      setResult(job);
      const shareUrl = tab === 'music' ? job.result?.audioUrl : job.result?.urls?.[0];
      if (job.status === 'done' && shareUrl) {
        void api.chat.shareCreation({ kind: tab === 'music' ? 'music' : tab === 'video' ? 'video' : 'image', url: shareUrl, title: job.result?.title || idea.slice(0, 40) })
          .then(() => toast.success('已同步到聊天', '打开聊天页即可看到这件作品。'))
          .catch(() => undefined);
      }
      toast.success('创作完成', tab === 'video' ? '视频已保存到本地媒体目录' : '作品已保存在本地媒体目录');
      try {
        if (tab === 'image' && aspect !== settings.media.imageAspectRatio) {
          await saveSettings({ media: { ...settings.media, imageAspectRatio: aspect } });
        }
        if (tab === 'video' && (resolution !== settings.models.minimaxVideoResolution || duration !== settings.models.minimaxVideoDuration || videoModel !== settings.models.minimaxVideo || videoAspect !== settings.media.videoAspectRatio)) {
          await saveSettings({
            models: { ...settings.models, minimaxVideo: videoModel, minimaxVideoResolution: resolution, minimaxVideoDuration: duration },
            media: { ...settings.media, videoAspectRatio: videoAspect },
          });
        }
      } catch {
        // 作品已生成成功，偏好保存失败不影响本次结果。
      }
    } catch (caught) {
      const message = errText(caught);
      setError(message);
      setMissingKey(/API Key|密钥|配置/i.test(message));
      toast.error('生成失败', message);
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { value: 'image' as StudioTab, label: <><ImageIcon size={14} />文生图</> },
    { value: 'video' as StudioTab, label: <><Film size={14} />文生视频</> },
    { value: 'music' as StudioTab, label: <><Music size={14} />AI 音乐</> },
  ];

  const provider = tab === 'image' ? 'MiniMax' : tab === 'video' ? 'MiniMax' : 'Suno';
  const configured = tab === 'music' ? keyStatus.suno : keyStatus.minimax;

  return (
    <Modal open={open} onClose={handleClose} wide title="创作工坊" desc="给她一个念头，她会用 MiniMax 或 Suno 把它变成图片、视频和歌。">
      <div className="dash-studio">
        <div className="dash-studio__head">
          <Tabs value={tab} onChange={switchTab} items={tabs} />
          <Badge tone={configured ? 'success' : 'warning'}>{provider} · {configured ? '已配置' : '未配置'}</Badge>
        </div>

        <div className="dash-studio__body">
          <div className="dash-studio__form">
            <Field label="创作提示词" hint="越具体越好：主体、场景、光线、镜头、情绪。">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
                maxLength={600}
                placeholder={tab === 'image' ? '例如：鲸鲸在深海图书馆里看书，蓝色荧光，电影感…' : tab === 'video' ? '例如：蓝鲸跃出海面，慢镜头，阳光穿过浪花…' : '例如：一首写给熬夜的人的安静钢琴曲…'}
              />
            </Field>
            <div className="dash-studio__examples">
              <span className="dim text-xs">试试这些：</span>
              {EXAMPLES[tab].map((example) => (
                <button type="button" key={example} className="dash-studio__example" onClick={() => setPrompt(example)}>{example}</button>
              ))}
            </div>

            {tab === 'image' && (
              <div className="dash-studio__options">
                <Field label="画幅">
                  <Select value={aspect} onChange={(event) => setAspect(event.target.value)}>
                    {IMAGE_ASPECTS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Select>
                </Field>
                <Field label="生成数量"><Input value={String(settings.media.imageCount)} readOnly /></Field>
              </div>
            )}

            {tab === 'video' && (
              <div className="dash-studio__options dash-studio__options--3">
                <Field label="模型">
                  <Select value={videoModel} onChange={(event) => {
                    const next = event.target.value;
                    const caps = videoCapabilities(next);
                    setVideoModel(next);
                    if (!caps.resolutions.includes(resolution)) setResolution(caps.resolutions[0]);
                    if (!caps.durations.includes(duration)) setDuration(caps.durations[0]);
                  }}>
                    {MINIMAX_VIDEO_MODELS.map((model) => <option key={model.value} value={model.value}>{model.label}</option>)}
                  </Select>
                </Field>
                <Field label="分辨率">
                  <Select value={resolution} onChange={(event) => setResolution(event.target.value)}>
                    {videoCapabilities(videoModel).resolutions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Select>
                </Field>
                <Field label="时长">
                  <Select value={String(duration)} onChange={(event) => setDuration(Number(event.target.value))}>
                    {videoCapabilities(videoModel).durations.map((item) => <option key={item} value={String(item)}>{item} 秒</option>)}
                  </Select>
                </Field>
                <Field label="画幅">
                  <Select value={videoAspect} onChange={(event) => setVideoAspect(event.target.value)}>
                    {VIDEO_ASPECTS.map((item) => <option key={item} value={item}>{item}</option>)}
                  </Select>
                </Field>
              </div>
            )}

            {tab === 'music' && (
              <div className="dash-studio__options dash-studio__options--2">
                <div className="dash-studio__switch">
                  <Toggle checked={instrumental} onChange={setInstrumental} label="纯音乐" />
                  <div><b>纯音乐</b><span>关闭则生成带演唱的歌曲</span></div>
                </div>
                <Field label="模型"><Input value={settings.models.suno} readOnly /></Field>
              </div>
            )}

            {tab === 'video' && <div className="dash-studio__hint"><AlertTriangle size={13} />视频生成可能需要数分钟，保持窗口打开体验更好。</div>}
            {!configured && (
              <div className="dash-studio__hint is-warning"><AlertTriangle size={13} />还没有配置 {provider} 的 API Key，保存后即可生成。</div>
            )}
            {error && (
              <div className="dash-studio__error">
                <XCircle size={14} />
                <span>{error}</span>
                {missingKey && <Button variant="ghost" size="sm" onClick={onOpenSettings}>去设置密钥</Button>}
              </div>
            )}

            <div className="dash-studio__actions">
              <span className="dim text-xs">作品会写入本地媒体目录，不经过第三方云盘。</span>
              <span className="spacer" />
              <Button variant="ghost" onClick={handleClose} disabled={busy}>取消</Button>
              <Button variant="primary" icon={busy ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} loading={busy} onClick={() => void generate()} disabled={busy || !prompt.trim()}>
                {busy ? '正在创作…' : '开始创作'}
              </Button>
            </div>
          </div>

          <div className="dash-studio__result">
            <div className="dash-studio__result-head">
              <span><Sparkles size={13} />生成结果</span>
              {result && <span className="dim text-xs">{result.provider} · {new Date(result.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>}
              {result && <Button size="sm" variant="secondary" icon={<Send size={13} />} loading={sharing} onClick={() => void shareResult()}>发送到聊天</Button>}
            </div>
            {busy ? (
              <div className="dash-studio__loading">
                <Loader2 size={26} className="spin" />
                <div className="dash-studio__loading-title">{tab === 'video' ? '正在渲染视频' : tab === 'music' ? '正在编曲和演唱' : '正在画图'}</div>
                <div className="dim text-sm">{elapsed}s · {tab === 'video' ? '视频通常需要 2–8 分钟' : tab === 'music' ? '音乐通常需要 1–4 分钟' : '图片通常需要 10–40 秒'}</div>
              </div>
            ) : !result ? (
              <div className="dash-studio__placeholder">
                {tab === 'image' ? <ImageIcon size={26} /> : tab === 'video' ? <Film size={26} /> : <Music size={26} />}
                <div>生成的{tab === 'image' ? '图片' : tab === 'video' ? '视频' : '音乐'}会出现在这里</div>
                <span>先左边写一句灵感，再点「开始创作」。</span>
              </div>
            ) : (
              <div className="dash-studio__work">
                {tab === 'image' && (
                  <div className={result.result?.urls && result.result.urls.length > 1 ? 'dash-studio__images is-multi' : 'dash-studio__images'}>
                    {(result.result?.urls ?? []).map((url, index) => (
                      <MediaImage key={index} src={url} alt={result.prompt} className="dash-studio__image" />
                    ))}
                  </div>
                )}
                {tab === 'video' && result.result?.urls?.[0] && (
                  <video className="dash-studio__video" src={result.result.urls[0]} controls playsInline />
                )}
                {tab === 'music' && (
                  <div className="dash-studio__music">
                    {result.result?.coverUrl && <MediaImage src={result.result.coverUrl} alt={result.result.title ?? '封面'} className="dash-studio__cover" />}
                    <div className="dash-studio__music-meta">
                      <div className="dash-studio__music-title">{result.result?.title || prompt.slice(0, 30)}</div>
                      <div className="dim text-xs">{result.result?.durationSec ? Math.round(result.result.durationSec) + ' 秒' : '时长未知'} · Suno</div>
                      {result.result?.audioUrl && <audio className="dash-studio__audio" src={result.result.audioUrl} controls />}
                    </div>
                  </div>
                )}
                <div className="dash-studio__prompt">“{result.prompt || prompt}”</div>
              </div>
            )}
            <div className="dash-studio__result-foot">
              <span><Sparkles size={12} />{settings.media.promptOptimizer ? '提示词自动优化已开启' : '使用原始提示词'}</span>
              <span className="dim text-xs">{result ? '作品已保存在本地媒体目录' : '生成后会保存到本地媒体目录'}</span>
            </div>
          </div>
        </div>

        {busy && (
          <div className="dash-studio__busybar">
            <Spinner label={tab === 'video' ? '视频生成可能需要数分钟，请耐心等等她…' : tab === 'music' ? 'Suno 正在创作音乐…' : 'MiniMax 正在作画…'} />
          </div>
        )}
      </div>
    </Modal>
  );
}
