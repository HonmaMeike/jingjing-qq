import React from 'react';
import { Activity, CircleHelp, Eraser, QrCode, RefreshCw, Search, Send, Terminal } from 'lucide-react';
import type { NapCatLogLine } from '@shared/types';
import { Button, cn } from '@/components/ui';

type LevelFilter = 'all' | NapCatLogLine['level'];

const LEVELS: { value: LevelFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'info', label: '信息' },
  { value: 'warn', label: '警告' },
  { value: 'error', label: '错误' },
  { value: 'debug', label: '调试' },
  { value: 'chat', label: '聊天' },
];

const LEVEL_TEXT: Record<NapCatLogLine['level'], string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  debug: 'DBG',
  chat: 'CHAT',
};

const QUICK_COMMANDS: { label: string; command: string; icon: React.ReactNode }[] = [
  { label: '登录信息', command: '登录信息', icon: <QrCode size={11} /> },
  { label: '状态', command: '状态', icon: <Activity size={11} /> },
  { label: '帮助', command: '帮助', icon: <CircleHelp size={11} /> },
  { label: '重载配置', command: '重载配置', icon: <RefreshCw size={11} /> },
];

interface ConsolePanelProps {
  logs: NapCatLogLine[];
  connected: boolean;
  sending: boolean;
  onCmd: (command: string) => Promise<void>;
  onClear: () => void;
}

function formatLogTime(value: string): string {
  if (!value) return '';
  if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.length > 19 ? value.slice(11, 19) : value;
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function highlight(text: string, query: string): React.ReactNode {
  const keyword = query.trim();
  if (!keyword) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'ig'));
  return parts.map((part, index) => (
    part.toLowerCase() === keyword.toLowerCase()
      ? <mark key={index}>{part}</mark>
      : <React.Fragment key={index}>{part}</React.Fragment>
  ));
}

export const ConsolePanel = React.memo(function ConsolePanel({ logs, connected, sending, onCmd, onClear }: ConsolePanelProps) {
  const [query, setQuery] = React.useState('');
  const [level, setLevel] = React.useState<LevelFilter>('all');
  const [autoScroll, setAutoScroll] = React.useState(true);
  const [input, setInput] = React.useState('');
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const bodyRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const counts = React.useMemo(() => {
    const next: Record<NapCatLogLine['level'], number> = { info: 0, warn: 0, error: 0, debug: 0, chat: 0 };
    for (const line of logs) next[line.level] += 1;
    return next;
  }, [logs]);

  const filtered = React.useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return logs.filter((line) => {
      if (level !== 'all' && line.level !== level) return false;
      if (keyword && !line.text.toLowerCase().includes(keyword)) return false;
      return true;
    });
  }, [logs, level, query]);

  React.useEffect(() => {
    if (!autoScroll) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, filtered.length, autoScroll, level, query]);

  const submit = async (raw?: string) => {
    const command = (raw ?? input).trim();
    if (!command || sending) return;
    setInput('');
    setHistory((prev) => [command, ...prev.filter((item) => item !== command)].slice(0, 60));
    setHistoryIndex(-1);
    await onCmd(command);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!history.length) return;
      const next = historyIndex < 0 ? 0 : Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setInput(history[next]);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (historyIndex < 0) return;
      const next = historyIndex - 1;
      if (next < 0) { setHistoryIndex(-1); setInput(''); }
      else { setHistoryIndex(next); setInput(history[next]); }
    } else if (event.key === 'Escape') {
      setInput('');
      setHistoryIndex(-1);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      onClear();
    }
  };

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== autoScroll) setAutoScroll(atBottom);
  };

  return (
    <section className="nc-terminal">
      <div className="nc-term-bar">
        <div className="nc-term-dots"><span /><span /><span /></div>
        <div className="nc-term-title"><Terminal size={13} />napcat@jingjing — 运行日志</div>
        <span className={connected ? 'nc-term-live nc-term-live--on' : 'nc-term-live'}>
          <span className={connected ? 'nc-live-dot nc-live-dot--on' : 'nc-live-dot'} />
          {connected ? '实时日志流' : '日志流未连接'}
        </span>
        <span className="nc-term-flag">本页内执行</span>
        <div className="spacer" />
        <label className="nc-term-check">
          <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
          自动滚动
        </label>
        <button type="button" className="nc-term-iconbtn" onClick={onClear} title="清空本地控制台视图（Ctrl+L）">
          <Eraser size={13} />清屏
        </button>
      </div>

      <div className="nc-term-tools">
        <div className="nc-term-search">
          <Search size={13} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索日志…" spellCheck={false} />
        </div>
        <div className="nc-levels">
          {LEVELS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={cn('nc-level', level === item.value && 'nc-level--active')}
              onClick={() => setLevel(item.value)}
            >
              {item.label}
              <span className="nc-level__count">{item.value === 'all' ? logs.length : counts[item.value]}</span>
            </button>
          ))}
        </div>
        <span className="nc-term-count mono">{filtered.length}/{logs.length} 行</span>
      </div>

      <div className="nc-term-body" ref={bodyRef} onScroll={onScroll}>
        {filtered.length ? filtered.map((line) => (
          <div key={line.id} className={cn('nc-log', `nc-log--${line.level}`)}>
            <span className="nc-log__time">{formatLogTime(line.time)}</span>
            <span className="nc-log__level">{LEVEL_TEXT[line.level] ?? line.level.toUpperCase()}</span>
            <span className="nc-log__text">{highlight(line.text, query)}</span>
          </div>
        )) : (
          <div className="nc-term-empty">
            {logs.length ? (
              <>
                <span>没有匹配的日志行</span>
                <button type="button" className="nc-term-empty__action" onClick={() => { setQuery(''); setLevel('all'); }}>清空筛选</button>
              </>
            ) : (
              <span>暂无日志输出。启动 NapCat 后，进程日志会实时出现在这里。</span>
            )}
          </div>
        )}
      </div>

      <div className="nc-quick">
        <span className="nc-quick__label">快捷命令</span>
        {QUICK_COMMANDS.map((item) => (
          <button key={item.command} type="button" className="nc-quick__chip" disabled={sending} onClick={() => void submit(item.command)}>
            {item.icon}{item.label}
          </button>
        ))}
        <span className="spacer" />
        <span className="nc-quick__hint">↑ ↓ 调取历史</span>
      </div>

      <form className="nc-term-input" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <span className="nc-term-prompt">napcat ›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="输入 NapCat 命令，Enter 执行"
          spellCheck={false}
          autoComplete="off"
        />
        <Button type="submit" variant="secondary" size="sm" icon={<Send size={13} />} loading={sending} disabled={!input.trim() || sending}>发送</Button>
      </form>
    </section>
  );
});
