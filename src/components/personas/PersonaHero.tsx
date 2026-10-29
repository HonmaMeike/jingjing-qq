import type { CSSProperties } from 'react';
import { FileText, MessageCircle, Pencil, Sparkles } from 'lucide-react';
import type { EmotionState, GrowthState, Persona, PetAsset } from '@shared/types';
import { Badge, Button } from '@/components/ui';
import { PersonaMedia, PersonaTag } from './persona-shared';

interface PersonaHeroProps {
  persona: Persona;
  petAssets: PetAsset[];
  emotion: EmotionState;
  growth: GrowthState;
  personas: Persona[];
  active: boolean;
  switching: boolean;
  switchingId: string | null;
  onSwitch: () => void;
  onSwitchPersona: (persona: Persona) => void;
  onChat: () => void;
  onOpenDetail: () => void;
  onEdit: () => void;
}

export function PersonaHero({ persona, personas, petAssets, emotion, growth, active, switching, switchingId, onSwitch, onSwitchPersona, onChat, onOpenDetail, onEdit }: PersonaHeroProps) {
  const style = { '--pc': persona.color || 'var(--brand)' } as CSSProperties;
  return (
    <section className="persona-hero" style={style}>
      <div className="persona-hero__aura" />
      <div className="persona-hero__media-col">
        <PersonaMedia persona={persona} petAssets={petAssets} className="persona-hero__media" />
        <div className="persona-hero__mood">
          <span className="persona-hero__mood-emoji">{emotion.moodEmoji}</span>
          <span className="persona-hero__mood-text">
            <strong>{emotion.mood}</strong>
            <small>当前心情</small>
          </span>
          <span className="persona-hero__mood-pulse" />
        </div>
      </div>
      <div className="persona-hero__info">
        <div className="persona-hero__eyebrow">
          <span className={'persona-live-dot' + (active ? ' is-on' : '')} />
          {active ? '正在陪伴你' : '可切换为当前人设'}
          <span className="persona-hero__eyebrow-sep" />
          {persona.isBuiltin ? '内置人设' : '自定义人设'}
          {persona.baseTemplateId ? <span className="persona-hero__eyebrow-sep" /> : null}
          {persona.baseTemplateId ? '鲸鲸同源分支' : ''}
        </div>
        <div className="persona-hero__name-row">
          <h2 className="persona-hero__name">{persona.name}</h2>
          <span className="persona-hero__nick">{persona.nickname}</span>
          {active && <Badge tone="success" dot>当前人设</Badge>}
        </div>
        <div className="persona-hero__title">{persona.title}</div>
        <p className="persona-hero__tagline">{persona.tagline}</p>
        <p className="persona-hero__desc">{persona.description}</p>
        <div className="persona-hero__traits">
          {(persona.traits ?? []).slice(0, 5).map((trait) => <PersonaTag key={trait}>{trait}</PersonaTag>)}
          {persona.traits?.length > 5 && <PersonaTag tone="muted">+{persona.traits.length - 5}</PersonaTag>}
        </div>
        <div className="persona-hero__stats">
          <div className="persona-stat">
            <span>等级</span>
            <strong>Lv.{growth.level}</strong>
            <small>成长值 {Math.round(growth.stageProgress)}%</small>
          </div>
          <div className="persona-stat">
            <span>好感</span>
            <strong>{Math.round(emotion.affection * 100)}%</strong>
            <small>耐心 {Math.round(emotion.patience * 100)}%</small>
          </div>
          <div className="persona-stat">
            <span>陪伴</span>
            <strong>{growth.totalDays} 天</strong>
            <small>连续 {growth.streakDays ?? 0} 天</small>
          </div>
          <div className="persona-stat">
            <span>对话</span>
            <strong>{growth.totalMessages}</strong>
            <small>关系阶段 · {growth.stageName || '初见'}</small>
          </div>
        </div>
        <div className="persona-hero__actions">
          {active ? (
            <Button variant="primary" icon={<MessageCircle size={15} />} onClick={onChat}>去和 {persona.nickname || persona.name} 聊聊</Button>
          ) : (
            <Button variant="primary" icon={<Sparkles size={15} />} loading={switching} onClick={onSwitch}>切换为当前人设</Button>
          )}
          <Button variant="secondary" icon={<FileText size={14} />} onClick={onOpenDetail}>完整档案</Button>
          <Button variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>编辑</Button>
        </div>
        {personas.length > 1 && (
        <div className="persona-hero__switch">
          <span className="persona-hero__switch-label">换一位陪你</span>
          <div className="persona-hero__switch-chips">
            {personas.filter((item) => item.id !== persona.id).map((item) => (
              <button
                type="button"
                key={item.id}
                className="persona-hero__switch-chip"
                disabled={Boolean(switchingId)}
                title={item.title + ' · ' + item.tagline}
                onClick={() => onSwitchPersona(item)}
              >
                <span className="persona-hero__switch-glyph">{item.avatar || '🐋'}</span>
                <span>{item.nickname || item.name}</span>
              </button>
            ))}
          </div>
        </div>
        )}
      </div>
    </section>
  );
}