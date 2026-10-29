import React from 'react';
import { Play, Settings2 } from 'lucide-react';
import type { PluginInfo } from '@shared/types';
import { Badge, Button, Toggle, cn } from '@/components/ui';
import { PluginGlyph, PluginStatusBadge, categoryOf } from './meta';

interface PluginCardProps {
  plugin: PluginInfo;
  onConfigure: (plugin: PluginInfo) => void;
  onToggle: (plugin: PluginInfo, enabled: boolean) => Promise<void>;
  onRun: (plugin: PluginInfo, actionId: string) => Promise<void>;
}

export function PluginCard({ plugin, onConfigure, onToggle, onRun }: PluginCardProps) {
  const [toggling, setToggling] = React.useState(false);
  const [pending, setPending] = React.useState<string | null>(null);
  const cat = categoryOf(plugin.category);

  const toggle = async () => {
    if (toggling) return;
    setToggling(true);
    try { await onToggle(plugin, !plugin.enabled); } finally { setToggling(false); }
  };
  const run = async (actionId: string) => {
    if (pending) return;
    setPending(actionId);
    try { await onRun(plugin, actionId); } finally { setPending(null); }
  };

  return (
    <article className={cn('plg-card', plugin.status === 'disabled' && 'plg-card--off', plugin.status === 'needs-config' && 'plg-card--attn')} data-cat={plugin.category}>
      <header className="plg-card__head">
        <PluginGlyph plugin={plugin} />
        <div className="plg-card__ident">
          <div className="plg-card__name-row">
            <h3 title={plugin.name}>{plugin.name}</h3>
            {plugin.builtin && <Badge tone="brand">内置</Badge>}
          </div>
          <div className="plg-card__cat">{cat.label} · <span className="mono">v{plugin.version}</span></div>
        </div>
        <div className="plg-card__state">
          <PluginStatusBadge status={plugin.status} />
          <Toggle checked={plugin.enabled} onChange={() => void toggle()} disabled={toggling} label={plugin.enabled ? '停用插件' : '启用插件'} />
        </div>
      </header>

      <p className="plg-card__desc" title={plugin.description}>{plugin.description || '暂无描述'}</p>

      <div className="plg-card__meta">
        <span className={cn('plg-chip', plugin.configured ? 'plg-chip--ok' : 'plg-chip--warn')} title={plugin.configured ? '配置已就绪' : '尚未完成配置'}>
          {plugin.configured ? '已配置' : '待配置'}
        </span>
        <span className="plg-chip" title="配置项数量">{plugin.configFields.length} 项配置</span>
        <span className="plg-chip">{plugin.actions.length ? `${plugin.actions.length} 个快捷动作` : '无快捷动作'}</span>
      </div>

      <div className="plg-card__actions">
        <Button size="sm" variant="ghost" icon={<Settings2 size={13} />} onClick={() => onConfigure(plugin)}>配置</Button>
        {plugin.actions.map((action) => (
          <Button
            key={action.id}
            size="sm"
            variant="secondary"
            icon={<Play size={12} />}
            loading={pending === action.id}
            disabled={!plugin.enabled || (!!pending && pending !== action.id)}
            title={action.description || action.label}
            onClick={() => void run(action.id)}
          >
            {action.label}
          </Button>
        ))}
        <span className="spacer" />
        {!plugin.enabled && <span className="plg-card__off-note">已停用</span>}
      </div>
    </article>
  );
}
