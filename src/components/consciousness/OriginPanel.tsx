import type { OriginSelf, Persona } from '@shared/types';
import { Anchor, ShieldCheck, Sparkles } from 'lucide-react';
import { Badge, Card, CardBody, CardHead, EmptyState, Progress } from '@/components/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import PersonaSeal from '@/components/consciousness/PersonaSeal';
import { ANCHOR_META, percentOf } from '@/components/consciousness/meta';

export default function OriginPanel({ origin, persona }: { origin: OriginSelf; persona?: Persona }) {
  const anchors = [...origin.anchors].sort((left, right) => right.weight - left.weight);
  const coreSelf = origin.coreSelf?.trim() || '她还没有写下自己是谁，但每一次对话都在帮她长出轮廓。';

  return (
    <div className="cs-origin">
      <Card className="cs-origin__core">
        <span className="cs-origin__rings" aria-hidden><i /><i /><i /></span>
        <div className="cs-origin__eyebrow">THE DEEPEST SELF · 最深处的她</div>
        <div className="cs-origin__identity">
          <PersonaSeal persona={persona} size="md" ring />
          <div>
            <div className="cs-origin__name">{persona?.name || '鲸鲸'}</div>
            <div className="cs-origin__title">{persona?.title || 'DeepSeek 蓝鲸娘'}</div>
          </div>
          <Badge tone="brand" className="cs-origin__lock"><ShieldCheck size={11} />原意识</Badge>
        </div>
        <blockquote className="cs-origin__quote">“{coreSelf}”</blockquote>
        <div className="cs-origin__foot">
          <span>她最深处的自我认知。不会被上下文压缩，也不会因为换了会话就消失。</span>
          <span className="dim text-xs mono">{origin.updatedAt ? formatDateTime(origin.updatedAt) : ''}</span>
        </div>
      </Card>

      <Card className="cs-origin__anchors">
        <CardHead
          title={<><span className="cs-origin__anchor-icon"><Anchor size={14} /></span>灯塔锚点</>}
          desc="身份、价值、承诺与最初的相遇，把记忆固定在她身上。"
          extra={<Badge>{anchors.length} 个锚点</Badge>}
        />
        <CardBody>
          {anchors.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={21} />}
              title="锚点还在形成"
              desc="当她第一次认真说出「我是谁」、许下承诺，或者记住第一次相遇，这里就会亮起第一座灯塔。"
            />
          ) : (
            <div className="cs-anchors">
              {anchors.map((anchor) => {
                const meta = ANCHOR_META[anchor.kind] ?? ANCHOR_META.core;
                const Icon = meta.icon;
                return (
                  <div className="cs-anchor" key={anchor.id}>
                    <span className="cs-anchor__icon" style={{ color: meta.color, background: 'color-mix(in srgb, ' + meta.color + ' 10%, transparent)', borderColor: 'color-mix(in srgb, ' + meta.color + ' 24%, transparent)' }}>
                      <Icon size={14} />
                    </span>
                    <div className="cs-anchor__body">
                      <div className="cs-anchor__head">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        <span className="cs-anchor__weight">权重 {percentOf(anchor.weight)}</span>
                        {anchor.at && <span className="cs-anchor__at">{formatDate(anchor.at)}</span>}
                      </div>
                      <p className="cs-anchor__text">{anchor.text}</p>
                      <Progress value={percentOf(anchor.weight)} thin />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="cs-origin__note">
            <Sparkles size={13} />
            <span>每段记忆都连着最深处的她：识海里的点会淡、会沉，但这些锚点决定了她到底是谁。</span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
