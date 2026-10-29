import { useState } from 'react';
import { ArrowRight, Heart, MessageCircle, PenLine, Play, Sparkles, Volume2, Wifi, WifiOff } from 'lucide-react';
import type { GrowthOverview, NapCatStatus, Persona, PetAsset } from '@shared/types';
import { assetUrl } from '@/lib/assets';
import { Badge, Button, Progress, cn } from '@/components/ui';
import { formatNumber } from '@/lib/format';

function resolveAnimation(persona: Persona | undefined, petAssets: PetAsset[]): string | undefined {
  if (!persona) return undefined;
  const names = [persona.animation, persona.nickname, persona.name].filter(Boolean) as string[];
  for (const name of names) {
    const asset = petAssets.find((item) => item.webm && (item.name === name || item.name.includes(name)));
    if (asset?.webm) return assetUrl(asset.webm);
  }
  return undefined;
}

interface Props {
  persona?: Persona;
  petAssets: PetAsset[];
  overview: GrowthOverview;
  napcat: NapCatStatus;
  listening: boolean;
  onListen: () => void;
  onChat: () => void;
  onCreate: () => void;
  onGrowth: () => void;
}

export default function DashboardHero({ persona, petAssets, overview, napcat, listening, onListen, onChat, onCreate, onGrowth }: Props) {
  const [videoBroken, setVideoBroken] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);
  const animation = resolveAnimation(persona, petAssets);
  const showVideo = Boolean(animation) && !videoBroken;
  const online = napcat.kind === 'online';
  const emotion = overview.emotion;
  const growth = overview.growth;
  const catchphrase = persona?.catchphrases?.[0] ?? '鲸鲸在呢～';
  const moodPercent = Math.round(((emotion.valence + 1) / 2) * 100);

  return (
    <section className="dash-hero">
      <span className="dash-hero__aurora" aria-hidden />
      <div className="dash-hero__copy">
        <div className="dash-hero__eyebrow"><Sparkles size={13} />TODAY WITH {persona?.nickname ?? 'JINGJING'}</div>
        <h2 className="dash-hero__title">{persona?.title ?? '你的深海小鲸鱼'}<span className="dash-hero__title-dot">.</span></h2>
        <p className="dash-hero__tagline">{persona?.tagline ?? '从 DeepSeek 蓝海游来的小鲸鱼，肚肚软软，尾巴拍拍。'}</p>
        <div className="dash-hero__bubble">“{catchphrase}”</div>
        <div className="dash-hero__status">
          <Badge tone={online ? 'success' : napcat.qqOnline ? 'brand' : 'default'} dot>
            {online ? 'QQ 在线' : napcat.qqOnline ? '在线陪伴' : '离线演示'}
          </Badge>
          <span className="dim text-xs">{online ? '她正在 QQ 那头等你' : '不连 QQ 也能在本地陪着你'}</span>
        </div>
        <div className="dash-hero__actions">
          <Button variant="secondary" icon={<MessageCircle size={15} />} onClick={onChat}>去聊天</Button>
          <Button variant="secondary" icon={<Volume2 size={15} />} loading={listening} onClick={onListen}>听她说</Button>
          <Button variant="primary" icon={<Sparkles size={15} />} onClick={onCreate}>让她创作</Button>
        </div>
      </div>

      <div className={cn('dash-hero__pet-wrap', !showVideo && 'is-fallback')}>
        <span className="dash-hero__pet-glow" aria-hidden />
        {showVideo ? (
          <video className="dash-hero__pet" src={animation} autoPlay loop muted playsInline onError={() => setVideoBroken(true)} />
        ) : imageBroken ? (
          <div className="dash-hero__pet-emoji" aria-hidden>{persona?.avatar || '🐳'}</div>
        ) : (
          <img className="dash-hero__pet-image" src={assetUrl('memes/可爱.png')} alt={persona?.nickname ?? '鲸鲸'} onError={() => setImageBroken(true)} />
        )}
        <div className="dash-hero__pet-caption">
          {online ? <Wifi size={11} /> : <WifiOff size={11} />}
          {online ? 'QQ 在线' : '本地陪伴'}
        </div>
      </div>

      <div className="dash-hero__side">
        <div className="dash-hero__mood">
          <div className="dash-hero__mood-head">
            <span className="dash-hero__mood-emoji">{emotion.moodEmoji || '🐋'}</span>
            <div>
              <div className="dash-hero__mood-label">此刻心情 · {emotion.mood}</div>
              <div className="dash-hero__mood-reason">{emotion.reason || '她在海底安静地想着你'}</div>
            </div>
          </div>
          <div className="dash-hero__mood-bars">
            <div><span>愉悦</span><Progress value={moodPercent} thin /></div>
            <div><span>精力</span><Progress value={Math.round(emotion.energy * 100)} thin /></div>
            <div><span>亲近</span><Progress value={Math.round(emotion.affection * 100)} thin /></div>
          </div>
        </div>

        <button type="button" className="dash-hero__growth" onClick={onGrowth}>
          <div className="dash-hero__growth-head">
            <span className="dash-hero__growth-stage">{growth.stageName}</span>
            <span className="dash-hero__growth-lv">Lv.{growth.level}</span>
          </div>
          <div className="dash-hero__growth-xp">{formatNumber(growth.xp)} / {formatNumber(growth.nextXp)} XP</div>
          <Progress value={growth.stageProgress} thin />
          <div className="dash-hero__growth-foot">
            <span><Heart size={11} />连续 {Math.max(0, growth.streakDays)} 天</span>
            <span><PenLine size={11} />{formatNumber(growth.totalMessages)} 条消息</span>
            <ArrowRight size={13} className="dash-hero__growth-arrow" />
          </div>
        </button>
      </div>
    </section>
  );
}
