import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, RefreshCw, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
import type { Persona } from '@shared/types';
import { useApp } from '@/app/AppProvider';
import { api } from '@/lib/api';
import {
  Badge, Button, EmptyState, Modal, PageHeader, SectionHead, Segmented, Spinner, useToast,
} from '@/components/ui';
import { PersonaHero } from '@/components/personas/PersonaHero';
import { PersonaCard } from '@/components/personas/PersonaCard';
import { PersonaDetailModal } from '@/components/personas/PersonaDetailModal';
import { PersonaFormModal } from '@/components/personas/PersonaFormModal';
import { GeneratePersonaModal } from '@/components/personas/GeneratePersonaModal';
import '@/styles/persona.css';

type PersonaFilter = 'all' | 'builtin' | 'custom';

export default function PersonasPage() {
  const toast = useToast();
  const { personas, activePersona, overview, petAssets, setPersonas, setSettings, refreshPersonas } = useApp();

  const [filter, setFilter] = useState<PersonaFilter>('all');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [formPersona, setFormPersona] = useState<Persona | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Persona | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    void refreshPersonas().catch(() => undefined);
  }, [refreshPersonas]);

  const heroPersona = useMemo(() => personas.find((persona) => persona.isActive) ?? activePersona ?? personas[0] ?? null, [personas, activePersona]);
  const detailPersona = useMemo(() => personas.find((persona) => persona.id === detailId) ?? null, [personas, detailId]);
  const visible = useMemo(() => personas.filter((persona) => {
    if (filter === 'builtin') return persona.isBuiltin;
    if (filter === 'custom') return !persona.isBuiltin;
    return true;
  }), [personas, filter]);

  const builtinCount = personas.filter((persona) => persona.isBuiltin).length;
  const customCount = personas.length - builtinCount;

  const openDetail = (persona: Persona) => {
    setDetailId(persona.id);
    setDetailOpen(true);
  };

  const openCreate = () => {
    setFormMode('create');
    setFormPersona(null);
    setFormOpen(true);
  };

  const openEdit = (persona: Persona) => {
    setFormMode('edit');
    setFormPersona(persona);
    setFormOpen(true);
  };

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshPersonas();
      toast.success('人设列表已刷新');
    } catch (cause) {
      toast.error('刷新失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  const handleSwitch = useCallback(async (persona: Persona) => {
    if (persona.isActive || switchingId) return;
    setSwitchingId(persona.id);
    try {
      const result = await api.personas.setActive(persona.id);
      setPersonas((previous) => previous.map((item) => ({ ...item, isActive: item.id === result.persona.id })));
      setSettings(result.settings);
      toast.success('人设已切换', '现在由' + (result.persona.nickname || result.persona.name) + '陪你；她的专属记忆和绑定音色已同步切换。');
    } catch (cause) {
      toast.error('切换人设失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSwitchingId(null);
    }
  }, [setPersonas, setSettings, switchingId, toast]);

  const handleSaved = (saved: Persona) => {
    setPersonas((previous) => {
      const exists = previous.some((persona) => persona.id === saved.id);
      if (!exists) return [...previous, saved];
      return previous.map((persona) => (persona.id === saved.id ? { ...saved, isActive: persona.isActive } : persona));
    });
    setFormOpen(false);
    setDetailId(saved.id);
    setDetailOpen(true);
    void refreshPersonas().catch(() => undefined);
  };

  const handleGenerated = (persona: Persona) => {
    setGenerateOpen(false);
    setPersonas((previous) => [...previous, persona]);
    setDetailId(persona.id);
    setDetailOpen(true);
    void refreshPersonas().catch(() => undefined);
  };

  const requestDelete = (persona: Persona) => {
    if (persona.isActive) {
      toast.warning('当前人设不能删除', '先把其他人设切换为当前，再回来删除她。');
      return;
    }
    setDeleteTarget(persona);
  };

  const handleDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await api.personas.remove(deleteTarget.id);
      const removedName = deleteTarget.name;
      setDeleteTarget(null);
      setDetailOpen(false);
      setDetailId(null);
      await refreshPersonas();
      toast.success('人设已删除', removedName + ' 的档案已经离开人设工坊。');
    } catch (cause) {
      toast.error('删除人设失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  const navigateChat = () => { window.location.hash = '/chat'; };

  return (
    <div className="persona-page">
      <PageHeader
        eyebrow="PERSONA ATELIER"
        icon={<Sparkles size={12} />}
        title="人设工坊"
        desc="八位同源鲸娘，各自长成不同的海。挑一位陪你，或者亲手养出一位新的鲸娘。"
        actions={(
          <>
            <Button variant="secondary" icon={<Wand2 size={15} />} onClick={() => setGenerateOpen(true)}>AI 生成新人格</Button>
            <Button variant="primary" icon={<Plus size={15} />} onClick={openCreate}>创建自定义人设</Button>
          </>
        )}
      />

      {heroPersona ? (
        <PersonaHero
          persona={heroPersona}
          personas={personas}
          petAssets={petAssets}
          emotion={overview.emotion}
          growth={overview.growth}
          active={Boolean(heroPersona.isActive)}
          switching={switchingId === heroPersona.id}
          switchingId={switchingId}
          onSwitch={() => void handleSwitch(heroPersona)}
          onSwitchPersona={(next) => void handleSwitch(next)}
          onChat={navigateChat}
          onOpenDetail={() => openDetail(heroPersona)}
          onEdit={() => openEdit(heroPersona)}
        />
      ) : (
        <EmptyState
          icon={<Sparkles size={22} />}
          title="人设工坊还没有开张"
          desc="创建一个新人设，或者重新载入应用数据。"
          action={<Button variant="primary" icon={<Plus size={14} />} onClick={openCreate}>创建人设</Button>}
        />
      )}

      <div className="section">
        <SectionHead
          title={<>同源鲸娘 <Badge tone="brand">{personas.length} 位</Badge></>}
          desc="点击卡片查看完整档案：性格、口癖、边界、示例对话与 TTS 音色。"
          extra={(
            <>
              <Segmented<PersonaFilter>
                value={filter}
                onChange={setFilter}
                items={[
                  { value: 'all', label: '全部 ' + personas.length },
                  { value: 'builtin', label: '内置 ' + builtinCount },
                  { value: 'custom', label: '自定义 ' + customCount },
                ]}
              />
              <Button variant="ghost" size="sm" icon={<RefreshCw size={13} />} loading={refreshing} onClick={() => void handleRefresh()}>刷新</Button>
            </>
          )}
        />
        <div className="persona-grid">
          {visible.map((persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              active={Boolean(persona.isActive)}
              onOpen={openDetail}
              onEdit={openEdit}
            />
          ))}
          <button type="button" className="persona-card persona-card--add" onClick={openCreate}>
            <span className="persona-card__add-icon"><Plus size={22} /></span>
            <span className="persona-card__add-title">创建自定义人设</span>
            <span className="persona-card__add-desc">以鲸鲸为模板，亲手养一位新的鲸娘。</span>
          </button>
        </div>
        {visible.length === 0 && filter === 'custom' && (
          <div className="persona-empty-hint persona-empty-hint--wide">还没有自定义人设。点击上面的加号，以鲸鲸为模板长出一位吧。</div>
        )}
      </div>

      <footer className="persona-footnote">
        <ShieldCheck size={14} />
        <span>人设切换会同步到聊天与 QQ 回复。内置人设可以编辑，原始模板不会被覆盖，随时可以恢复默认。</span>
        <span className="spacer" />
        <Button variant="ghost" size="sm" icon={<Wand2 size={13} />} onClick={() => setGenerateOpen(true)}>让 AI 写一位新鲸娘</Button>
      </footer>

      <PersonaDetailModal
        open={detailOpen}
        persona={detailPersona}
        switching={Boolean(detailPersona && switchingId === detailPersona.id)}
        onClose={() => setDetailOpen(false)}
        onSwitch={(persona) => void handleSwitch(persona)}
        onEdit={openEdit}
        onDelete={requestDelete}
      />

      <PersonaFormModal
        open={formOpen}
        mode={formMode}
        persona={formPersona}
        personas={personas}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
      />

      <GeneratePersonaModal
        open={generateOpen}
        personas={personas}
        onClose={() => setGenerateOpen(false)}
        onCreated={handleGenerated}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="删除这位人设？"
        desc={deleteTarget ? '「' + deleteTarget.name + '」的自定义档案会被永久删除。' : undefined}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>取消</Button>
            <Button variant="danger" loading={deleting} onClick={() => void handleDelete()}>确认删除</Button>
          </>
        )}
      >
        <div className="callout callout--warning">
          <AlertTriangle size={15} className="callout__icon" />
          <div>历史对话不会消失，但使用这位人设的会话会回退到默认人设。内置人设无法删除，只能编辑。</div>
        </div>
      </Modal>

      {refreshing && <div className="persona-refreshing"><Spinner label="正在刷新人设档案…" /></div>}
    </div>
  );
}