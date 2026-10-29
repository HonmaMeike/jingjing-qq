import type { CSSProperties, ReactNode } from 'react';
import { CalendarDays, Check, Flame, Heart, MessageSquare, Quote } from 'lucide-react';
import type { GrowthOverview, Persona, PetAsset } from '@shared/types';
import { Progress, cn } from '@/components/ui';
import { formatNumber, relativeTime } from '@/lib/format';
import { personaAnimation } from '@/lib/persona';
import { percentOf } from '@/components/growth/meta';

function Gauge({ label, value, color }: { label: string; value: number; color: string }) {
  const percent = Math.max(0, Math.min(100, value));
  return (
    <div className="gro-gauge" style={{ ['--p' as string]: percent, ['--c' as string]: color } as CSSProperties}>
      <div className="gro-gauge__ring">
        <div className="gro-gauge__inner">
          <b>{Math.round(percent)}</b>
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}

function EmotionBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="gro-emotion-bar">
      <div className="gro-emotion-bar__head"><span>{label}</span><span className="mono">{value}</span></div>
      <div className="gro-emotion-bar__track">
        <span style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function HeroStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="gro-hero__stat">
      <span className="gro-hero__stat-icon">{icon}</span>
      <div>
        <div className="gro-hero__stat-value">{value}</div>
        <div className="gro-hero__stat-label">{label}</div>
      </div>
    </div>
  );
}

export default function GrowthHero({ overview, persona, petAssets }: { overview: GrowthOverview; persona?: Persona; petAssets: PetAsset[] }) {
  const { emotion, growth, stages, relationship } = overview;
  const animation = personaAnimation(persona, petAssets);
  const currentStage = stages.find((stage) => stage.key === growth.stage);
  const stageColor = currentStage?.color ?? 'var(--brand-2)';
  const reflections = growth.reflections ?? [];
  const notes = growth.evolutionNotes ?? [];
  const dailyLine = reflections[reflections.length - 1] ?? notes[notes.length - 1] ?? persona?.catchphrases?.[0] ?? growth.selfImage ?? '';
  const traits = Object.entries(growth.traits ?? {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4);

  return (
    <section className="gro-hero">
      <span className="gro-hero__aurora" aria-hidden />
      <span className="gro-hero__aurora gro-hero__aurora--second" aria-hidden />

      <div className="gro-hero__main">
        <div className="gro-hero__persona">
          <div className="gro-hero__pet-wrap">
            {animation ? (
              <video className="gro-hero__pet" src={animation} autoPlay loop muted playsInline />
            ) : (
              <div className="gro-hero__pet gro-hero__pet--fallback">{persona?.avatar || '🐋'}</div>
            )}
            <span
              className="gro-hero__stage-badge"
              style={{
                color: stageColor,
                borderColor: `color-mix(in srgb, ${stageColor} 34%, transparent)`,
                background: `color-mix(in srgb, ${stageColor} 12%, transparent)`,
              }}
            >
              <span className="dot" style={{ background: stageColor }} />
              {growth.stageName}
            </span>
          </div>

          <div className="gro-hero__identity">
            <div className="gro-hero__name-row">
              <span className="gro-hero__name">{persona?.nickname ?? '鲸鲸'}</span>
              <span className="gro-hero__lv">Lv.{growth.level}</span>
            </div>
            <div className="gro-hero__title">{persona?.title ?? '你的深海小鲸鱼'}</div>
            <p className="gro-hero__self">{growth.selfImage || persona?.tagline || '一条还在学习如何陪伴人类的小鲸鱼。'}</p>
            {traits.length > 0 && (
              <div className="gro-hero__traits">
                {traits.map(([label, value]) => (
                  <span className="gro-hero__trait" key={label}>{label}<b>{Math.round(value)}</b></span>
                ))}
              </div>
            )}

            <div className="gro-hero__xp">
              <div className="gro-hero__xp-head">
                <span>阶段进度 · {growth.stageName}</span>
                <span className="mono">{formatNumber(growth.xp)} / {formatNumber(growth.nextXp)} XP</span>
              </div>
              <Progress value={growth.stageProgress} />
              <div className="gro-hero__xp-foot">
                <span>{growth.stageProgress}%</span>
                <span>距下一阶段还差 {formatNumber(Math.max(0, growth.nextXp - growth.xp))} XP</span>
              </div>
            </div>
          </div>
        </div>

        <div className="gro-hero__mood">
          <div className="gro-hero__mood-head">
            <span className="gro-hero__mood-emoji">{emotion.moodEmoji || '🐋'}</span>
            <div className="gro-hero__mood-text">
              <div className="gro-hero__mood-label">此刻 · {emotion.mood}</div>
              <div className="gro-hero__mood-reason">{emotion.reason || '她在海底安静地想着你'}</div>
            </div>
            <span className="gro-hero__updated">{relativeTime(emotion.updatedAt)}</span>
          </div>

          <div className="gro-gauges">
            <Gauge label="心情" value={percentOf((emotion.valence + 1) / 2)} color="var(--brand-2)" />
            <Gauge label="精力" value={percentOf(emotion.energy)} color="var(--mint)" />
            <Gauge label="亲密" value={percentOf(emotion.affection)} color="var(--pink)" />
          </div>

          <div className="gro-emotion-bars">
            <EmotionBar label="耐心" value={percentOf(emotion.patience)} color="var(--amber)" />
            <EmotionBar label="吃醋" value={percentOf(emotion.jealousy)} color="var(--danger)" />
            <EmotionBar label="自豪" value={percentOf(emotion.pride)} color="var(--brand-3)" />
          </div>

          {dailyLine && (
            <div className="gro-hero__quote">
              <Quote size={14} />
              <span>{dailyLine}</span>
            </div>
          )}
        </div>
      </div>

      <div className="gro-hero__stats">
        <HeroStat icon={<MessageSquare size={15} />} label="消息总数" value={formatNumber(growth.totalMessages)} />
        <HeroStat icon={<CalendarDays size={15} />} label="相伴天数" value={`${Math.max(1, growth.totalDays)} 天`} />
        <HeroStat icon={<Flame size={15} />} label="连续陪伴" value={`${Math.max(0, growth.streakDays)} 天`} />
        <HeroStat icon={<Heart size={15} />} label="互动次数" value={formatNumber(relationship?.interactions ?? 0)} />
      </div>

      {stages.length > 0 && (
        <div className="gro-hero__stages-wrap">
          <div className="gro-hero__stages-head">
            <span>成长阶段</span>
            <span className="dim">经验来自聊天、主动生活与自我反思</span>
          </div>
          <div className="gro-stages">
            {stages.map((stage, index) => {
              const reached = growth.xp >= stage.minXp;
              const active = stage.key === growth.stage;
              return (
                <div
                  key={stage.key}
                  className={cn('gro-stage', reached && 'is-reached', active && 'is-active')}
                  style={{ ['--stage-c' as string]: stage.color } as CSSProperties}
                >
                  <span className="gro-stage__node">
                    {reached ? <Check size={11} /> : <span>{index + 1}</span>}
                  </span>
                  <div className="gro-stage__meta">
                    <div className="gro-stage__name">{stage.name}</div>
                    <div className="gro-stage__xp">{formatNumber(stage.minXp)} XP</div>
                    {active && stage.description && <div className="gro-stage__desc">{stage.description}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
