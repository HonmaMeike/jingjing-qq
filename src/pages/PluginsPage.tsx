import React from 'react';
import { Boxes, CheckCircle2, Download, FolderOpen, Layers, PlugZap, RefreshCw, Search, ShieldCheck, Sparkles, Store, Workflow, XCircle } from 'lucide-react';
import type { PluginInfo, ServiceId } from '@shared/types';
import { useApp } from '@/app/AppProvider';
import { api } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Input, PageHeader, cn, useToast } from '@/components/ui';
import { PluginCard } from '@/components/plugins/PluginCard';
import { PluginConfigModal } from '@/components/plugins/PluginConfigModal';
import { PLUGIN_CATEGORY_META, PLUGIN_CATEGORY_ORDER, categoryOf } from '@/components/plugins/meta';
import '../styles/plugins.css';

type StatusFilter = 'all' | 'enabled' | 'needs-config' | 'error';

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'enabled', label: '已启用' },
  { value: 'needs-config', label: '待配置' },
  { value: 'error', label: '异常' },
];

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function PluginsPage() {
  const { plugins, integrations, refreshPlugins } = useApp();
  const toast = useToast();
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState<StatusFilter>('all');
  const [configuringId, setConfiguringId] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [testingId, setTestingId] = React.useState<ServiceId | null>(null);

  const configuring = plugins.find((plugin) => plugin.id === configuringId) ?? null;

  const matches = React.useCallback((plugin: PluginInfo) => {
    const keyword = query.trim().toLowerCase();
    if (keyword) {
      const haystack = `${plugin.name} ${plugin.description} ${plugin.id} ${categoryOf(plugin.category).label}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    if (filter === 'enabled') return plugin.enabled;
    if (filter === 'needs-config') return plugin.status === 'needs-config';
    if (filter === 'error') return plugin.status === 'error';
    return true;
  }, [query, filter]);

  const groups = React.useMemo(
    () => PLUGIN_CATEGORY_ORDER
      .map((category) => ({ category, items: plugins.filter((plugin) => plugin.category === category && matches(plugin)) }))
      .filter((group) => group.items.length > 0),
    [plugins, matches],
  );

  const counts = React.useMemo(() => ({
    all: plugins.length,
    enabled: plugins.filter((plugin) => plugin.enabled).length,
    'needs-config': plugins.filter((plugin) => plugin.status === 'needs-config').length,
    error: plugins.filter((plugin) => plugin.status === 'error').length,
  }), [plugins]);

  const importPlugin = async () => {
    try {
      const plugin = await api.plugins.import();
      if (!plugin) return;
      await refresh();
      toast.success('插件已导入', plugin.name + ' · ' + plugin.version);
    } catch (error) {
      toast.error('导入失败', error instanceof Error ? error.message : String(error));
    }
  };

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshPlugins();
      toast.success('插件列表已刷新');
    } catch (error) {
      toast.error('刷新失败', errText(error));
    } finally {
      setRefreshing(false);
    }
  };

  const toggle = async (plugin: PluginInfo, enabled: boolean) => {
    try {
      await api.plugins.toggle(plugin.id, enabled);
      await refreshPlugins();
      toast.success(enabled ? '插件已启用' : '插件已停用', plugin.name);
    } catch (error) {
      toast.error(enabled ? '启用失败' : '停用失败', errText(error));
    }
  };

  const run = async (plugin: PluginInfo, actionId: string) => {
    const action = plugin.actions.find((item) => item.id === actionId);
    try {
      const result = await api.plugins.run(plugin.id, actionId);
      if (result.ok) toast.success(`${plugin.name} · ${action?.label ?? actionId}`, result.message);
      else toast.warning(`${plugin.name} · ${action?.label ?? actionId}`, result.message);
      await refreshPlugins();
    } catch (error) {
      toast.error(`${plugin.name} 执行失败`, errText(error));
    }
  };

  const testIntegration = async (service: ServiceId) => {
    if (testingId) return;
    setTestingId(service);
    try {
      const result = await api.integrations.test(service);
      if (result.ok) toast.success('连接正常', result.latencyMs !== undefined ? `耗时 ${result.latencyMs} ms` : result.message);
      else toast.error('连接失败', result.message);
    } catch (error) {
      toast.error('连接测试失败', errText(error));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="PLUGIN HUB"
        icon={<Sparkles size={13} />}
        title="插件中心"
        desc="把鲸鲸的能力拆成可插拔的模块：启用、配置、测试都在这里完成，配置与界面完全解耦。"
        actions={(
          <>
            <Badge tone="brand" dot>{counts.enabled} / {counts.all} 已启用</Badge>
            <Button variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void api.plugins.openFolder().then(() => toast.info('已打开插件目录', '把 plugin.json 放进 data/plugins/<id>/ 即可被识别')).catch((error) => toast.error('打开失败', String(error)))}>导入目录</Button>
            <Button variant="secondary" icon={<Download size={14} />} onClick={() => void importPlugin()}>导入插件</Button>
            <Button variant="ghost" icon={<Store size={14} />} onClick={() => toast.info('插件市场即将开放', '现在可以先通过插件目录导入；插件制作文档在 docs/PLUGIN_AUTHORING.md')}>插件市场</Button>
            <Button variant="secondary" icon={<RefreshCw size={14} className={refreshing ? 'spin' : undefined} />} onClick={() => void refresh()} disabled={refreshing}>刷新</Button>
          </>
        )}
      />

      <Card className="plg-arch">
        <div className="plg-arch__glow" />
        <div className="plg-arch__intro">
          <div className="plg-arch__eyebrow"><Layers size={14} />PLUGIN ARCHITECTURE</div>
          <h2>能力像积木一样拼装</h2>
          <p className="plg-arch__desc">每个功能都是独立插件，主进程负责能力，渲染层只消费插件描述并自动生成配置表单。关闭某个模块不会影响对话、记忆和其他服务。</p>
          <div className="plg-arch__points">
            <div className="plg-point">
              <div className="plg-point__icon"><Boxes size={16} /></div>
              <b>模块插件化</b>
              <span>启停互不影响，能力按需加载</span>
            </div>
            <div className="plg-point">
              <div className="plg-point__icon"><Workflow size={16} /></div>
              <b>数据与 UI 解耦</b>
              <span>配置由 configFields 自动渲染</span>
            </div>
            <div className="plg-point">
              <div className="plg-point__icon"><ShieldCheck size={16} /></div>
              <b>本地安全存储</b>
              <span>密钥加密保存，不上传云端</span>
            </div>
          </div>
        </div>

        <div className="plg-arch__services">
          <div className="plg-services__head">
            <span>第三方 API 一览</span>
            <Badge>{integrations.length} 个服务</Badge>
          </div>
          {!integrations.length ? (
            <div className="plg-services__empty">
              <PlugZap size={16} />
              <span>尚未探测到已接入的第三方服务</span>
            </div>
          ) : (
            <div className="plg-services">
              {integrations.map((service) => {
                const state = service.connected ? 'connected' : service.configured ? 'configured' : 'unconfigured';
                return (
                  <button
                    key={service.id}
                    className={cn('plg-service', `plg-service--${state}`)}
                    onClick={() => void testIntegration(service.id)}
                    disabled={testingId !== null}
                    title={service.detail || service.label}
                  >
                    <span className="plg-service__dot" />
                    <span className="plg-service__text">
                      <span className="plg-service__label">{service.label}</span>
                      <span className="plg-service__detail">{testingId === service.id ? '正在测试连接…' : (service.detail || (service.configured ? '已配置' : '未配置'))}</span>
                    </span>
                    {service.latencyMs !== undefined && <span className="plg-service__latency mono">{service.latencyMs}ms</span>}
                    {service.connected ? <CheckCircle2 size={14} className="plg-service__mark" /> : service.configured ? <PlugZap size={14} className="plg-service__mark" /> : <XCircle size={14} className="plg-service__mark" />}
                  </button>
                );
              })}
            </div>
          )}
          <div className="plg-services__hint">点击服务可发起真实连接测试</div>
        </div>
      </Card>

      <div className="plg-toolbar">
        <div className="plg-search">
          <Search size={15} />
          <Input placeholder="搜索插件、能力或分类…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="plg-filters">
          {FILTERS.map((item) => (
            <button key={item.value} className={cn('plg-filter', filter === item.value && 'plg-filter--active')} onClick={() => setFilter(item.value)}>
              {item.label}<span className="plg-filter__count">{counts[item.value]}</span>
            </button>
          ))}
        </div>
        <span className="spacer" />
        <span className="plg-toolbar__meta">{groups.reduce((sum, group) => sum + group.items.length, 0)} 个模块匹配</span>
      </div>

      {!plugins.length ? (
        <Card className="card__pad--lg">
          <EmptyState
            icon={<PlugZap size={23} />}
            title="还没有可用的插件"
            desc="插件由主进程注册，首次启动或刷新后会出现在这里。"
            action={<Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => void refresh()} loading={refreshing}>重新加载插件</Button>}
          />
        </Card>
      ) : !groups.length ? (
        <Card className="card__pad--lg">
          <EmptyState
            icon={<Search size={23} />}
            title="没有匹配的插件"
            desc="换个关键词，或切换上方的状态筛选试试。"
            action={<Button variant="ghost" onClick={() => { setQuery(''); setFilter('all'); }}>清空筛选</Button>}
          />
        </Card>
      ) : (
        groups.map((group) => {
          const meta = PLUGIN_CATEGORY_META[group.category];
          return (
            <section className="plg-cat" key={group.category}>
              <div className="plg-cat__head">
                <div className="plg-cat__icon" data-cat={group.category}>{meta.icon}</div>
                <div className="plg-cat__text">
                  <div className="plg-cat__title">{meta.label}</div>
                  <div className="plg-cat__desc">{meta.desc}</div>
                </div>
                <div className="plg-cat__line" />
                <Badge>{group.items.length} 个</Badge>
              </div>
              <div className="plg-cat__grid">
                {group.items.map((plugin) => (
                  <PluginCard key={plugin.id} plugin={plugin} onConfigure={(item) => setConfiguringId(item.id)} onToggle={toggle} onRun={run} />
                ))}
              </div>
            </section>
          );
        })
      )}

      <div className="plg-footnote">
        <ShieldCheck size={14} />
        <span>插件清单、启用状态与配置都保存在本地数据目录；第三方密钥经系统安全存储加密，不会随日志或截图外泄。</span>
      </div>

      <PluginConfigModal plugin={configuring} onClose={() => setConfiguringId(null)} onSaved={() => refreshPlugins()} />
    </>
  );
}
