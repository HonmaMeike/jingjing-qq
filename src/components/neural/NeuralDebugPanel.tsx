import { useMemo } from 'react';
import { Bug, Database, Eraser, ShieldCheck } from 'lucide-react';
import type { NeuralEvent } from '@shared/types';
import { Badge, Button, Card, CardBody, CardHead, CopyButton } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

export function NeuralDebugPanel({ events, paused, onRequestBackendClear }: { events: NeuralEvent[]; paused: boolean; onRequestBackendClear: () => void }) {
  const raw = useMemo(() => {
    const safe = events.slice(0, 30).map((event) => ({
      id: event.id,
      at: event.at,
      type: event.type,
      node: event.node,
      target: event.target,
      label: event.label,
      detail: event.detail,
      value: event.value,
      progress: event.progress,
      durationMs: event.durationMs,
      tokens: event.tokens,
    }));
    return JSON.stringify(safe, null, 2);
  }, [events]);

  return (
    <Card className="neural-card neural-debug-card">
      <CardHead
        title="调试视图"
        desc="原始事件元数据 · 不含密钥与完整聊天原文"
        icon={<Bug size={16} />}
        extra={<><Badge tone={paused ? 'warning' : 'brand'}>{events.length} 条缓存</Badge><CopyButton text={raw} label="复制事件" /></>}
      />
      <CardBody>
        <div className="neural-debug">
          <div className="neural-debug__meta">
            <span><Database size={12} /> detail 最多 600 字，由后端截断</span>
            <span><ShieldCheck size={12} /> 只读取事件元数据</span>
          </div>
          <pre className="neural-debug__raw">{raw}</pre>
          <div className="neural-debug__foot">
            <span>最近 30 条事件 · 整理于 {formatDateTime(new Date().toISOString())}</span>
            <Button size="sm" variant="danger" icon={<Eraser size={13} />} onClick={onRequestBackendClear}>清空服务端事件</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
