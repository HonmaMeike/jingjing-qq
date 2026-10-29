import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/components/ui';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

/** 逗号 / 回车分隔的标签输入：权限名单、敏感词等共用。 */
export default function TagListEditor({ value, onChange, placeholder, tone = 'default', disabled }: Props) {
  const [input, setInput] = useState('');

  const commit = () => {
    const parts = input.split(/[,，;；\s]+/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    onChange(next);
    setInput('');
  };

  return (
    <div className={cn('stg-tags', tone === 'danger' && 'stg-tags--danger', disabled && 'is-disabled')}>
      {value.map((item) => (
        <span className="stg-tag" key={item}>
          {item}
          <button
            type="button"
            aria-label={'移除 ' + item}
            onClick={() => onChange(value.filter((entry) => entry !== item))}
            disabled={disabled}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <div className="stg-tags__entry">
        <Plus size={12} className="stg-tags__plus" />
        <input
          className="stg-tags__input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',' || event.key === '，') {
              event.preventDefault();
              commit();
            }
            if (event.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={commit}
          placeholder={placeholder ?? '输入后回车添加'}
          disabled={disabled}
          aria-label={placeholder ?? '添加标签'}
        />
      </div>
    </div>
  );
}
