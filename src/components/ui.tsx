import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Copy, Info, Loader2, X, XCircle } from 'lucide-react';
import type { ToastPayload } from '@shared/types';
import { normalizeAssetUrl } from '@/lib/assets';

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

type ButtonVariant = 'default' | 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
  block?: boolean;
}
export function Button({ variant = 'default', size = 'md', icon, loading, block, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      className={cn('btn', variant !== 'default' && `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={15} className="spin" /> : icon}
      {children}
    </button>
  );
}
export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  label?: string;
  size?: number;
}
export function IconButton({ active, label, className, size = 17, children, ...rest }: IconButtonProps) {
  return <button title={label} aria-label={label} className={cn('icon-btn', active && 'icon-btn--active', className)} {...rest}>{children}</button>;
}
export function Badge({ children, tone = 'default', dot = false, className }: { children: React.ReactNode; tone?: 'default' | 'brand' | 'success' | 'warning' | 'danger' | 'pink' | 'mint'; dot?: boolean; className?: string }) {
  return <span className={cn('badge', tone !== 'default' && `badge--${tone}`, className)}>{dot && <span className={cn('dot', tone === 'success' && 'dot--pulse')} />}{children}</span>;
}
export function Card({ children, className, hover, glow, flat, onClick }: { children: React.ReactNode; className?: string; hover?: boolean; glow?: boolean; flat?: boolean; onClick?: () => void }) {
  return <div className={cn('card', hover && 'card--hover', glow && 'card--glow', flat && 'card--flat', className)} onClick={onClick}>{children}</div>;
}
export function CardHead({ title, desc, icon, extra }: { title: React.ReactNode; desc?: React.ReactNode; icon?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="card__head">
      <div className="flex-1">
        <div className="card__title">{icon}{title}</div>
        {desc && <div className="card__desc">{desc}</div>}
      </div>
      {extra && <div className="row no-wrap">{extra}</div>}
    </div>
  );
}
export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('card__body', className)}>{children}</div>;
}
export function CardFooter({ children }: { children: React.ReactNode }) {
  return <div className="card__footer">{children}</div>;
}
export function PageHeader({ eyebrow, title, desc, actions, icon }: { eyebrow?: string; title: React.ReactNode; desc?: React.ReactNode; actions?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="page-header__eyebrow">{icon}{eyebrow}</div>}
        <h1>{title}</h1>
        {desc && <p className="page-header__desc">{desc}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  );
}
export function SectionHead({ title, desc, extra }: { title: React.ReactNode; desc?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div><div className="section-title">{title}</div>{desc && <div className="section-sub">{desc}</div>}</div>
      {extra}
    </div>
  );
}
export function Avatar({ src, name, size = 'md', ring, className }: { src?: string; name?: string; size?: 'sm' | 'md' | 'lg' | 'xl'; ring?: boolean; className?: string }) {
  const [broken, setBroken] = useState(false);
  const resolvedSrc = normalizeAssetUrl(src);
  const show = resolvedSrc && !broken;
  return (
    <div className={cn('avatar', `avatar--${size}`, ring && 'avatar--ring', className)} style={!show ? { display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg, var(--brand), var(--brand-3))', color: '#fff', fontWeight: 800 } : undefined}>
      {show ? <img src={resolvedSrc} alt={name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} onError={() => setBroken(true)} /> : (name?.trim().slice(0, 1) || '鲸')}
    </div>
  );
}
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={cn('toggle', checked && 'toggle--on')} onClick={() => onChange(!checked)} />;
}
export function SettingRow({ title, desc, children }: { title: React.ReactNode; desc?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-row__text"><div className="setting-row__title">{title}</div>{desc && <div className="setting-row__desc">{desc}</div>}</div>
      <div className="row no-wrap">{children}</div>
    </div>
  );
}
export function Field({ label, hint, error, children, extra }: { label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="form-field">
      {label && <div className="form-label"><span>{label}</span>{extra}</div>}
      {children}
      {error ? <div className="form-hint" style={{ color: 'var(--danger)' }}>{error}</div> : hint ? <div className="form-hint">{hint}</div> : null}
    </div>
  );
}
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn('input', className)} {...props} />;
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn('textarea', className)} {...props} />;
});
export function Select({ children, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn('select', className)} {...props}>{children}</select>;
}
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode; count?: number }[]; className?: string }) {
  return (
    <div className={cn('tabs', className)}>
      {items.map((item) => (
        <button key={item.value} className={cn('tab', value === item.value && 'tab--active')} onClick={() => onChange(item.value)}>
          {item.label}{item.count !== undefined && <span className="dim" style={{ marginLeft: 5 }}>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[] }) {
  return <div className="segmented">{items.map((i) => <button key={i.value} className={value === i.value ? 'active' : ''} onClick={() => onChange(i.value)}>{i.label}</button>)}</div>;
}
export function Progress({ value, thin }: { value: number; thin?: boolean }) {
  return <div className={cn('progress', thin && 'progress--thin')}><div className="progress__bar" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}
export function Ring({ value, label, size = 68 }: { value: number; label?: React.ReactNode; size?: number }) {
  return <div className="ring" style={{ ['--p' as string]: Math.max(0, Math.min(100, value)), ['--size' as string]: `${size}px` }}><span className="ring__value">{label ?? Math.round(value)}</span></div>;
}
export function EmptyState({ icon, title, desc, action }: { icon?: React.ReactNode; title: string; desc?: React.ReactNode; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-state__icon">{icon ?? <Info size={23} />}</div><div className="empty-state__title">{title}</div>{desc && <div className="empty-state__desc">{desc}</div>}{action}</div>;
}
export function Spinner({ label }: { label?: string }) {
  return <div className="row" style={{ color: 'var(--text-3)', fontSize: 12 }}><Loader2 size={15} className="spin" />{label ?? '加载中…'}</div>;
}
export function Modal({ open, onClose, title, desc, children, footer, wide }: { open: boolean; onClose: () => void; title: React.ReactNode; desc?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; wide?: boolean }) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cn('modal', wide && 'modal--wide')} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal__head">
          <div><div className="modal__title" id={titleId}>{title}</div>{desc && <div className="modal__desc">{desc}</div>}</div>
          <IconButton onClick={onClose} label="关闭"><X size={17} /></IconButton>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>, document.body,
  );
}
export function CopyButton({ text, label = '复制', size = 'sm' }: { text: string; label?: string; size?: 'sm' | 'md' }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className={cn('btn btn--ghost', size === 'sm' && 'btn--sm')} onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ } }}>
      {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? '已复制' : label}
    </button>
  );
}
export function markdownToHtml(input: string): string {
  const escaped = input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^\- (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');
}
export function MarkdownView({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => markdownToHtml(text), [text]);
  return <div className={cn('markdown', className)} dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }} />;
}
export function StatTile({ label, value, sub, icon, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; tone?: string }) {
  return (
    <Card hover className="card__pad" >
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="dim text-xs" style={{ letterSpacing: '.06em' }}>{label}</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 25, fontWeight: 700, marginTop: 4, color: tone }}>{value}</div>
          {sub && <div className="dim text-xs" style={{ marginTop: 2 }}>{sub}</div>}
        </div>
        {icon && <div style={{ width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'var(--surface-soft)', border: '1px solid var(--border)', color: 'var(--brand-2)' }}>{icon}</div>}
      </div>
    </Card>
  );
}

// ---------------- Toast ----------------
interface ToastItem extends ToastPayload { id: string }
interface ToastContextValue { push: (t: ToastPayload) => void; success: (title: string, message?: string) => void; error: (title: string, message?: string) => void; info: (title: string, message?: string) => void; warning: (title: string, message?: string) => void; }
const ToastContext = createContext<ToastContextValue | null>(null);
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const push = useCallback((t: ToastPayload) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    setItems((prev) => [...prev.slice(-4), { ...t, id }]);
    const timer = setTimeout(() => setItems((prev) => prev.filter((i) => i.id !== id)), 4200);
    timers.current.push(timer);
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const value = useMemo<ToastContextValue>(() => ({
    push,
    success: (title, message) => push({ type: 'success', title, message }),
    error: (title, message) => push({ type: 'error', title, message }),
    info: (title, message) => push({ type: 'info', title, message }),
    warning: (title, message) => push({ type: 'warning', title, message }),
  }), [push]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div className="toast-stack">
          {items.map((item) => (
            <div key={item.id} className={cn('toast', `toast--${item.type}`)}>
              <div className="toast__icon">{item.type === 'success' ? <CheckCircle2 size={16} /> : item.type === 'error' ? <XCircle size={16} /> : item.type === 'warning' ? <AlertTriangle size={16} /> : <Info size={16} />}</div>
              <div className="flex-1"><div className="toast__title">{item.title}</div>{item.message && <div className="toast__msg">{item.message}</div>}</div>
              <IconButton label="关闭" onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))} style={{ width: 24, height: 24 }}><X size={13} /></IconButton>
            </div>
          ))}
        </div>, document.body,
      )}
    </ToastContext.Provider>
  );
}
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}

export function ArrowLink({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <button className="row text-xs" style={{ color: 'var(--brand-2)', fontWeight: 650 }} onClick={onClick}>{children}<ChevronRight size={13} /></button>;
}
