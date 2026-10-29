import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AlertTriangle, FileText, Loader2, MessageSquare, Pencil, RefreshCw,
  Sparkles, Trash2, Volume2,
} from 'lucide-react';
import type { Persona } from '@shared/types';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { Badge, Button, CopyButton, Modal, Progress, Tabs, cn, useToast } from '@/components/ui';
import { PersonaAvatar, PersonaSection, PersonaTag } from './persona-shared';

type DetailTab = 'profile' | 'examples' | 'voice' | 'prompt';

interface PersonaDetailModalProps {
  open: boolean;
  persona: Persona | null;
  switching: boolean;
  onClose: () => void;
  onSwitch: (persona: Persona) => void;
  onEdit: (persona: Persona) => void;
  onDelete: (persona: Persona) => void;
}

function textList(items?: string[], empty?: string) {
  const list = (items ?? []).filter(Boolean);
  if (list.length === 0) return <div className="persona-empty-hint">{empty || '还没有记录'}</div>;
  return (
    <ul className="persona-list">
      {list.map((item, index) => <li key={index}>{item}</li>)}
    </ul>
  );
}

export function PersonaDetailModal({ open, persona, switching, onClose, onSwitch, onEdit, onDelete }: PersonaDetailModalProps) {
  const toast = useToast();
  const [tab, setTab] = useState<DetailTab>('profile');
  const [prompt, setPrompt] = useState<{ prompt: string; tokens: number } | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTab('profile');
    setPrompt(null);
    setPromptError(null);
    setPromptLoading(false);
  }, [open, persona?.id, persona?.updatedAt]);

  const loadPrompt = async () => {
    if (!persona || promptLoading) return;
    setPromptLoading(true);
    setPromptError(null);
    try {
      const result = await api.personas.previewPrompt(persona.id);
      setPrompt(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setPromptError(message);
      toast.error('提示词预览失败', message);
    } finally {
      setPromptLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !persona || tab !== 'prompt' || prompt || promptLoading) return;
    void loadPrompt();
  }, [open, persona?.id, tab]);

  if (!persona) {
    return <Modal open={open} onClose={onClose} title="人设档案"><div className="persona-empty-hint">还没有选择人设</div></Modal>;
  }

  const style = { '--pc': persona.color || 'var(--brand)' } as CSSProperties;
  const tts = persona.tts;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={(
        <div className="persona-detail__heading">
          <PersonaAvatar persona={persona} size="md" />
          <div className="persona-detail__heading-text">
            <div className="persona-detail__heading-name">
              {persona.name}
              <span className="persona-detail__heading-nick">{persona.nickname}</span>
              {persona.isActive && <Badge tone="success" dot>当前人设</Badge>}
              {!persona.isBuiltin && <Badge tone="brand">自定义</Badge>}
            </div>
            <div className="persona-detail__heading-title">{persona.title}</div>
          </div>
        </div>
      )}
      desc={persona.tagline}
      footer={(
        <div className="persona-detail__footer">
          {!persona.isBuiltin && (
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={() => onDelete(persona)}>删除人设</Button>
          )}
          <span className="spacer" />
          <Button variant="ghost" icon={<Pencil size={14} />} onClick={() => onEdit(persona)}>编辑档案</Button>
          <Button
            variant="primary"
            icon={<Sparkles size={15} />}
            loading={switching}
            disabled={persona.isActive}
            onClick={() => onSwitch(persona)}
          >
            {persona.isActive ? '当前正在使用' : '切换为此人设'}
          </Button>
        </div>
      )}
    >
      <div className="persona-detail" style={style}>
        <div className="persona-detail__hero">
          <p className="persona-detail__description">{persona.description}</p>
          <div className="persona-detail__hero-tags">
            {(persona.traits ?? []).slice(0, 6).map((trait) => <PersonaTag key={trait}>{trait}</PersonaTag>)}
          </div>
          <div className="persona-detail__meta">
            <span><MessageSquare size={12} /> 口癖 {persona.catchphrases?.length ?? 0} 条</span>
            <span><Volume2 size={12} /> {persona.voiceId ? '已绑定 BreezeBlue 音色' : (persona.tts?.voiceHint ? '音色描述已配置' : '跟随全局音色')}</span>
            <span><FileText size={12} /> 核心提示词 {persona.corePrompt ? '已生成' : '默认模板'}</span>
          </div>
        </div>

        <Tabs<DetailTab>
          value={tab}
          onChange={setTab}
          items={[
            { value: 'profile', label: '完整档案' },
            { value: 'examples', label: '口癖 · 示例' },
            { value: 'voice', label: 'TTS 音色' },
            { value: 'prompt', label: '提示词' },
          ]}
        />

        {tab === 'profile' && (
          <div className="persona-detail__panels">
            <PersonaSection title="性格特点">
              {(persona.traits ?? []).length > 0 ? (
                <div className="persona-chip-grid">{(persona.traits ?? []).map((trait) => <span className="persona-chip" key={trait}>{trait}</span>)}</div>
              ) : <div className="persona-empty-hint">还没有填写性格特点</div>}
            </PersonaSection>
            <PersonaSection title="脾气与雷点">
              <p className="persona-prose">{persona.temper || '还没有填写脾气。'}</p>
            </PersonaSection>
            <div className="persona-two-col">
              <PersonaSection title="喜欢">
                <div className="persona-chip-grid">{(persona.likes ?? []).map((item) => <span className="persona-chip persona-chip--like" key={item}>{item}</span>)}</div>
                {(persona.likes ?? []).length === 0 && <div className="persona-empty-hint">还没有记录</div>}
              </PersonaSection>
              <PersonaSection title="讨厌">
                <div className="persona-chip-grid">{(persona.dislikes ?? []).map((item) => <span className="persona-chip persona-chip--dislike" key={item}>{item}</span>)}</div>
                {(persona.dislikes ?? []).length === 0 && <div className="persona-empty-hint">还没有记录</div>}
              </PersonaSection>
            </div>
            <PersonaSection title="背景故事">
              <p className="persona-prose">{persona.background || '还没有填写背景故事。'}</p>
            </PersonaSection>
            <PersonaSection title="说话风格">
              <p className="persona-prose">{persona.speechStyle || '还没有填写说话风格。'}</p>
            </PersonaSection>
            <PersonaSection title="关系风格">
              <p className="persona-prose">{persona.relationshipStyle || '还没有填写关系风格。'}</p>
            </PersonaSection>
            <PersonaSection title="兴趣">
              {(persona.interests ?? []).length > 0
                ? <div className="persona-chip-grid">{(persona.interests ?? []).map((item) => <span className="persona-chip" key={item}>{item}</span>)}</div>
                : <div className="persona-empty-hint">还没有填写兴趣</div>}
            </PersonaSection>
            <PersonaSection title="边界与底线">
              {textList(persona.boundaries, '还没有设置边界')}
            </PersonaSection>
          </div>
        )}

        {tab === 'examples' && (
          <div className="persona-detail__panels">
            <div className="persona-two-col">
              <PersonaSection title="口头禅">
                {textList(persona.catchphrases, '还没有口头禅')}
              </PersonaSection>
              <PersonaSection title="小动作">
                {textList(persona.quirks, '还没有小动作')}
              </PersonaSection>
            </div>
            <PersonaSection title="第一句问候">
              <div className="persona-greeting">
                <PersonaAvatar persona={persona} size="sm" />
                <p>{persona.greeting || '（她还没有想好第一句话。）'}</p>
              </div>
            </PersonaSection>
            <PersonaSection title="示例对话">
              {(persona.examples ?? []).length === 0 && <div className="persona-empty-hint">还没有示例对话</div>}
              <div className="persona-examples">
                {(persona.examples ?? []).map((example, index) => (
                  <div className="persona-example" key={index}>
                    <div className="persona-example__row persona-example__row--user">
                      <span className="persona-example__who">你</span>
                      <div className="persona-example__bubble persona-example__bubble--user">{example.user}</div>
                    </div>
                    <div className="persona-example__row">
                      <PersonaAvatar persona={persona} size="sm" />
                      <div className="persona-example__bubble">{example.assistant}</div>
                    </div>
                  </div>
                ))}
              </div>
            </PersonaSection>
          </div>
        )}

        {tab === 'voice' && (
          <div className="persona-detail__panels">
            <PersonaSection title="绑定音色">
              <p className="persona-prose">{persona.voiceName || persona.voiceId || '尚未单独绑定：首次切换/手动改音色时会绑定到当前人设。'}</p>
              <div className="callout callout--brand">
                <Volume2 size={15} className="callout__icon" />
                <div>在「设置 → 模型与语音 → 声音与音色」中手动选择，会绑定到当前人设；切换人设时自动同步，互不覆盖。</div>
              </div>
            </PersonaSection>
            <PersonaSection title="音色描述">
              <p className="persona-prose">{tts?.voiceHint || '还没有填写音色描述。'}</p>
            </PersonaSection>
            <PersonaSection title="朗读指令">
              <p className="persona-prose">{tts?.instructions || '还没有填写朗读指令。'}</p>
            </PersonaSection>
            <PersonaSection title="情绪与语调标签">
              {(tts?.tags ?? []).length > 0
                ? <div className="persona-chip-grid">{(tts?.tags ?? []).map((tag) => <span className="persona-chip" key={tag}>{tag}</span>)}</div>
                : <div className="persona-empty-hint">还没有标签</div>}
            </PersonaSection>
            <div className="persona-two-col">
              <PersonaSection title="音高 pitch">
                <div className="persona-voice-meter">
                  <div className="persona-voice-meter__head"><span>低沉</span><strong>{Number(tts?.pitch ?? 1).toFixed(2)}</strong><span>清亮</span></div>
                  <Progress value={Math.min(100, (Number(tts?.pitch ?? 1) / 2) * 100)} thin />
                </div>
              </PersonaSection>
              <PersonaSection title="语速 speed">
                <div className="persona-voice-meter">
                  <div className="persona-voice-meter__head"><span>舒缓</span><strong>{Number(tts?.speed ?? 1).toFixed(2)}</strong><span>轻快</span></div>
                  <Progress value={Math.min(100, (Number(tts?.speed ?? 1) / 2) * 100)} thin />
                </div>
              </PersonaSection>
            </div>
            <div className="callout callout--brand">
              <Volume2 size={15} className="callout__icon" />
              <div>语音回复会使用这套音色参数；如果语音合成服务没有配置，文字聊天不受影响。</div>
            </div>
          </div>
        )}

        {tab === 'prompt' && (
          <div className="persona-prompt">
            {promptLoading && (
              <div className="persona-prompt__loading">
                <Loader2 size={20} className="spin" />
                <div>正在从人设档案拼装提示词…</div>
                <span>人格、口癖、边界与示例都会被编织进去</span>
              </div>
            )}
            {!promptLoading && promptError && (
              <div className="callout callout--warning">
                <AlertTriangle size={15} className="callout__icon" />
                <div className="flex-1">
                  <div>提示词生成失败：{promptError}</div>
                  <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void loadPrompt()}>重试</Button>
                </div>
              </div>
            )}
            {!promptLoading && !promptError && prompt && (
              <>
                <div className="persona-prompt__bar">
                  <Badge tone="brand"><Sparkles size={11} /> 约 {formatNumber(prompt.tokens)} tokens</Badge>
                  <span className="spacer" />
                  <CopyButton text={prompt.prompt} label="复制提示词" />
                </div>
                <pre className={cn('code-block', 'persona-prompt__code')}>{prompt.prompt}</pre>
                <div className="callout">
                  <FileText size={15} className="callout__icon" />
                  <div>这段提示词由人设档案实时拼装，切换人设或编辑档案后会自动生效。运行时还会拼上关系、记忆与情绪状态。</div>
                </div>
              </>
            )}
            {!promptLoading && !promptError && !prompt && (
              <div className="persona-prompt__loading">
                <Button variant="secondary" icon={<Sparkles size={14} />} onClick={() => void loadPrompt()}>生成提示词预览</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}