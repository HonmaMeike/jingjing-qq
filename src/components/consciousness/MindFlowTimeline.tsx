import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, MessageSquare, Workflow } from 'lucide-react';
import type { MindFlowState } from '@shared/types';
import { Badge, Card, EmptyState } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/lib/format';
import { FLOW_META, sortByUpdatedDesc, timeValue } from '@/components/consciousness/meta';

interface Props {
  flows: MindFlowState[];
  conversationLabel: (id: string) => string;
}

export default function MindFlowTimeline({ flows, conversationLabel }: Props) {
  const sorted = useMemo(() => sortByUpdatedDesc(flows ?? []), [flows]);
  const [selectedId, setSelectedId] = useState<string | null>(sorted[0]?.conversationId ?? null);

  useEffect(() => {
    if (selectedId && sorted.some((flow) => flow.conversationId === selectedId)) return;
    setSelectedId(sorted[0]?.conversationId ?? null);
  }, [sorted, selectedId]);

  if (!sorted.length) {
    return (
      <Card className="cs-section-card">
        <EmptyState
          icon={<Workflow size={22} />}
          title="还没有一条完整的心流"
          desc="当她回应你的时候，感知、联想、回忆、推理、回应和反思会串成一条链。这里会记录念头是怎么走到你那儿的。"
        />
      </Card>
    );
  }

  const selected = sorted.find((flow) => flow.conversationId === selectedId) ?? sorted[0];
  const chains = [...(selected?.chain ?? [])];
  const firstAt = chains.length ? Math.min(...chains.map((step) => timeValue(step.at)).filter(Boolean)) : 0;
  const lastAt = chains.length ? Math.max(...chains.map((step) => timeValue(step.at)).filter(Boolean)) : 0;
  const durationSeconds = firstAt && lastAt ? Math.max(0, Math.round((lastAt - firstAt) / 1000)) : 0;

  return (
    <div className="cs-flow">
      <div className="cs-flow__tabs">
        {sorted.map((flow) => (
          <button
            type="button"
            key={flow.conversationId}
            className={'cs-flow__tab' + (flow.conversationId === selected?.conversationId ? ' is-active' : '')}
            onClick={() => setSelectedId(flow.conversationId)}
          >
            <span className="cs-flow__tab-name">{conversationLabel(flow.conversationId)}</span>
            <span className="cs-flow__tab-time">{relativeTime(flow.updatedAt)}</span>
          </button>
        ))}
      </div>

      {selected && (
        <Card className="cs-flow__card">
          <div className="cs-flow__head">
            <div>
              <div className="cs-flow__eyebrow"><Workflow size={13} />MIND FLOW · 一个念头牵出下一个</div>
              <div className="cs-flow__current">“{selected.current || '她正在想该怎么回应你。'}”</div>
            </div>
            <div className="cs-flow__meta">
              <Badge tone="brand">{conversationLabel(selected.conversationId)}</Badge>
              <span className="dim text-xs">{chains.length} 步 · {durationSeconds > 0 ? durationSeconds + ' 秒' : '即时'}</span>
              <span className="dim text-xs">{relativeTime(selected.updatedAt)}</span>
            </div>
          </div>

          {chains.length === 0 ? (
            <EmptyState icon={<MessageSquare size={21} />} title="这条链还是一句念头" desc="下一次回应后，这里会出现完整的感知→联想→回忆→推理→回应→反思。" />
          ) : (
            <div className="cs-flow__chain">
              {chains.map((step, index) => {
                const meta = FLOW_META[step.kind] ?? FLOW_META.perception;
                const Icon = meta.icon;
                return (
                  <div className="cs-flow__step" key={step.id || index}>
                    <div className="cs-flow__rail">
                      <span className="cs-flow__node" style={{ color: meta.color, background: 'color-mix(in srgb, ' + meta.color + ' 13%, transparent)', borderColor: 'color-mix(in srgb, ' + meta.color + ' 34%, transparent)' }}><Icon size={14} /></span>
                      {index < chains.length - 1 && <span className="cs-flow__line" />}
                    </div>
                    <div className="cs-flow__step-body">
                      <div className="cs-flow__step-head">
                        <span className="cs-flow__step-kind" style={{ color: meta.color }}>{meta.label}</span>
                        <span className="cs-flow__step-label">{step.label || meta.hint}</span>
                        <span className="spacer" />
                        <span className="dim text-xs mono">{formatDateTime(step.at)}</span>
                      </div>
                      <div className="cs-flow__step-path">
                        <span>{step.from || '此刻的对话'}</span>
                        <ArrowRight size={12} />
                        <span>{step.to || '下一个念头'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
