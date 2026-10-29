import type { CSSProperties, KeyboardEvent } from 'react';
import { Pencil } from 'lucide-react';
import type { Persona } from '@shared/types';
import { Badge, IconButton } from '@/components/ui';
import { PersonaAvatar } from './persona-shared';

interface PersonaCardProps {
  persona: Persona;
  active: boolean;
  onOpen: (persona: Persona) => void;
  onEdit?: (persona: Persona) => void;
}

export function PersonaCard({ persona, active, onOpen, onEdit }: PersonaCardProps) {
  const style = { '--pc': persona.color || 'var(--brand)' } as CSSProperties;
  const open = () => onOpen(persona);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  };
  return (
    <div
      className={'persona-card' + (active ? ' is-active' : '')}
      style={style}
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={onKeyDown}
      aria-label={'打开人设 ' + persona.name}
    >
      <div className="persona-card__cover">
        <span className="persona-card__cover-glow" />
        <span className="persona-card__cover-grid" />
        <div className="persona-card__badges">
          {active && <Badge tone="success" dot>正在陪伴</Badge>}
          {!persona.isBuiltin && <Badge tone="brand">自定义</Badge>}
          {onEdit && (
            <span className="persona-card__edit" title="编辑档案">
              <IconButton label={'编辑 ' + persona.name} onClick={(event) => { event.stopPropagation(); onEdit(persona); }}><Pencil size={13} /></IconButton>
            </span>
          )}
        </div>
      </div>
      <div className="persona-card__avatar">
        <PersonaAvatar persona={persona} size="lg" />
      </div>
      <div className="persona-card__body">
        <div className="persona-card__name-row">
          <h3 className="persona-card__name">{persona.name}</h3>
          <span className="persona-card__nick">{persona.nickname}</span>
        </div>
        <div className="persona-card__title">{persona.title}</div>
        <p className="persona-card__tagline">{persona.tagline}</p>
        <div className="persona-card__traits">
          {(persona.traits ?? []).slice(0, 3).map((trait) => (
            <span className="persona-tag" key={trait}>{trait}</span>
          ))}
        </div>
        {persona.catchphrases?.[0] && <div className="persona-card__quote">「{persona.catchphrases[0]}」</div>}
      </div>
    </div>
  );
}