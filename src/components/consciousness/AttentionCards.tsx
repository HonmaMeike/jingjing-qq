import { AlertCircle, MessageSquare, Sparkles } from 'lucide-react';
import type { AttentionState } from '@shared/types';
import { Badge, Card, EmptyState, Progress } from '@/components/ui';
import { moodTone, relativeTime } from '@/lib/format';
import { percentOf, sortByUpdatedDesc } from '@/components/consciousness/meta';

interface Props {
  attention: AttentionState[];
  conversationLabel: (id: string) => string;
}

export default function AttentionCards({ attention, conversationLabel }: Props) {
  const sorted = sortByUpdatedDesc(attention ?? []);
  if (!sorted.length) {
    return (
      <Card className="cs-section-card">
        <EmptyState
          icon={<Sparkles size={22} />}
          title="她此刻还没有把光聚在哪里"
          desc="等她开始一段对话，心光会照向正在聊的话题、还没解决的疑问，以及你此刻的情绪。"
        />
      </Card>
    );
  }

  return (
    <div className="cs-attention">
      {sorted.map((state, index) => {
        const tone = moodTone(state.mood);
        return (
          <Card className="cs-attention__card" key={state.conversationId} hover>
            <div className="cs-attention__head">
              <span className="cs-attention__ray"><Sparkles size={15} /></span>
              <div className="cs-attention__head-text">
                <div className="cs-attention__focus">{state.focus || '她在安静地听'}</div>
                <div className="cs-attention__conv"><MessageSquare size={11} />{conversationLabel(state.conversationId)}</div>
              </div>
              <Badge tone={tone === 'good' ? 'success' : tone === 'bad' ? 'danger' : 'default'}>{state.mood || '平静'}</Badge>
              {index === 0 && <Badge tone="brand">此刻</Badge>}
            </div>

            <div className="cs-attention__intensity">
              <div className="cs-attention__intensity-head"><span>注意强度</span><b>{percentOf(state.intensity)}%</b></div>
              <Progress value={percentOf(state.intensity)} thin />
            </div>

            {state.topics.length > 0 && (
              <div className="cs-attention__topics">
                {state.topics.slice(0, 8).map((topic) => <span className="cs-tag cs-tag--plain" key={topic}>#{topic}</span>)}
              </div>
            )}

            {state.unresolved.length > 0 && (
              <div className="cs-attention__unresolved">
                <div className="cs-attention__unresolved-label"><AlertCircle size={12} />还悬着的事</div>
                {state.unresolved.slice(0, 4).map((item) => <div className="cs-attention__unresolved-item" key={item}>{item}</div>)}
              </div>
            )}

            <div className="cs-attention__foot">
              <span className="dim text-xs">更新于 {relativeTime(state.updatedAt)}</span>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
