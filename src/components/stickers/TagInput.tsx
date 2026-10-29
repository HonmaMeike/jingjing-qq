import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '@/components/ui';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  max?: number;
  disabled?: boolean;
  tone?: 'default' | 'brand';
}

/** 命名标签输入：回车或逗号添加，点击 × 移除。 */
export default function TagInput({ value, onChange, placeholder, max = 12, disabled, tone = 'brand' }: Props) {
  const [input, setInput] = useState('');

  const commit = () => {
    const parts = input.split(/[,，;；\s]+/).map((part) => part.trim().replace(/^#/, '')).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const part of parts) {
      if (next.length >= max) break;
      if (!next.includes(part)) next.push(part);
    }
    onChange(next);
    setInput('');
  };

  return (
    <div className={cn('stk-tags', tone === 'brand' && 'is-brand', disabled && 'is-disabled')}>
      {value.map((tag) => (
        <span className="stk-tag" key={tag}>
          #{tag}
          <button type="button" aria-label={'移除标签 ' + tag} onClick={() => onChange(value.filter((entry) => entry !== tag))} disabled={disabled}>
            <X size={10} />
          </button>
        </span>
      ))}
      {value.length < max && (
        <div className="stk-tags__entry">
          <Plus size={12} className="stk-tags__plus" />
          <input
            className="stk-tags__input"
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
            placeholder={placeholder ?? '输入标签后回车'}
            disabled={disabled}
            aria-label={placeholder ?? '添加标签'}
            maxLength={24}
          />
        </div>
      )}
      {value.length >= max && <span className="stk-tags__limit">最多 {max} 个标签</span>}
    </div>
  );
}
