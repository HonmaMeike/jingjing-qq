import { useEffect, useState } from 'react';
import { Loader2, Sparkles, Wand2 } from 'lucide-react';
import type { Persona } from '@shared/types';
import { api } from '@/lib/api';
import { Badge, Button, Field, Input, Modal, Select, Textarea, useToast } from '@/components/ui';

interface GeneratePersonaModalProps {
  open: boolean;
  personas: Persona[];
  onClose: () => void;
  onCreated: (persona: Persona) => void;
}

const STEPS = ['读取母版人格', '编织性格与口癖', '校准语感与边界', '落笔成档'];

export function GeneratePersonaModal({ open, personas, onClose, onCreated }: GeneratePersonaModalProps) {
  const toast = useToast();
  const [baseId, setBaseId] = useState('jingjing');
  const [name, setName] = useState('');
  const [traits, setTraits] = useState('');
  const [style, setStyle] = useState('');
  const [userPrompt, setUserPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!open) return;
    setBaseId('jingjing');
    setName('');
    setTraits('');
    setStyle('');
    setUserPrompt('');
    setGenerating(false);
    setError(null);
    setElapsed(0);
  }, [open]);

  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [generating]);

  const submit = async () => {
    if (generating) return;
    const finalName = name.trim();
    if (!finalName) {
      setError('先给她起一个名字，DeepSeek 才知道该呼唤谁');
      return;
    }
    if (!userPrompt.trim()) {
      setError('用一句话描述你想要的鲸娘，生成会更有方向');
      return;
    }
    setGenerating(true);
    setError(null);
    setElapsed(0);
    try {
      const persona = await api.personas.generate({
        baseId,
        name: finalName,
        traits: traits.trim(),
        style: style.trim(),
        userPrompt: userPrompt.trim(),
      });
      toast.success('新人格已生成', persona.name + ' · ' + persona.title);
      onCreated(persona);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toast.error('生成人设失败', message);
    } finally {
      setGenerating(false);
    }
  };

  const builtin = personas.filter((persona) => persona.isBuiltin);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={generating ? '正在生成新人格' : 'AI 生成新人格'}
      desc={generating ? '深海正在为她塑形，请稍等片刻。' : '以内置鲸娘为母版，让 DeepSeek 长出一位全新的鲸落海住民。'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={generating}>取消</Button>
          <Button variant="primary" icon={<Wand2 size={15} />} loading={generating} onClick={() => void submit()}>
            {generating ? '生成中…' : '开始生成'}
          </Button>
        </>
      )}
    >
      {generating ? (
        <div className="persona-gen">
          <div className="persona-gen__orb">
            <span className="persona-gen__core">🐋</span>
            <span className="persona-gen__ring persona-gen__ring--1" />
            <span className="persona-gen__ring persona-gen__ring--2" />
            <span className="persona-gen__ring persona-gen__ring--3" />
          </div>
          <div className="persona-gen__title">正在深海采集人格…</div>
          <div className="persona-gen__elapsed">已等待 {elapsed}s · 大约需要 10—40 秒</div>
          <ul className="persona-gen__steps">
            {STEPS.map((step, index) => (
              <li key={step} className={index <= Math.min(STEPS.length - 1, Math.floor(elapsed / 3)) ? 'is-active' : ''}>
                <span className="persona-gen__step-dot" />
                {step}
              </li>
            ))}
          </ul>
          <div className="callout callout--brand">
            <Sparkles size={15} className="callout__icon" />
            <div>生成会调用 DeepSeek 接口并消耗额度。如果一直卡住，可以关闭窗口后检查设置里的 API 密钥。</div>
          </div>
        </div>
      ) : (
        <div className="persona-form">
          <div className="persona-gen__banner">
            <span className="persona-gen__banner-icon"><Sparkles size={18} /></span>
            <div>
              <div className="persona-gen__banner-title">她会继承母版的鲸尾与世界观，长出自己的性格。</div>
              <div className="persona-gen__banner-desc">描述越具体，生成出来的人设越不像模板。</div>
            </div>
            <Badge tone="brand">DeepSeek</Badge>
          </div>
          <div className="persona-form__grid">
            <Field label="母版" hint="继承世界观与身体设定">
              <Select value={baseId} onChange={(event) => setBaseId(event.target.value)}>
                {builtin.map((persona) => <option key={persona.id} value={persona.id}>{persona.name} · {persona.title}</option>)}
              </Select>
            </Field>
            <Field label="名字" hint="必须填写">
              <Input value={name} maxLength={24} placeholder="例如：烬蓝、晚潮、阿雾" onChange={(event) => { setName(event.target.value); if (error) setError(null); }} />
            </Field>
          </div>
          <Field label="性格关键词" hint="例如：冷静、毒舌、怕黑、喜欢星星">
            <Input value={traits} maxLength={120} placeholder="用几个词勾勒她的性格…" onChange={(event) => setTraits(event.target.value)} />
          </Field>
          <Field label="说话风格" hint="例如：文言腔、短句、爱用省略号">
            <Input value={style} maxLength={120} placeholder="她说话是什么味道？" onChange={(event) => setStyle(event.target.value)} />
          </Field>
          <Field label="你想要的她" hint="可以写她的来历、和你的关系、一个具体场景">
            <Textarea
              value={userPrompt}
              rows={5}
              maxLength={800}
              placeholder="比如：她是一条在沉船图书馆长大的鲸娘，白天整理书，晚上等你来还书。说话很轻，喜欢用书页的味道形容心情……"
              onChange={(event) => { setUserPrompt(event.target.value); if (error) setError(null); }}
            />
          </Field>
          {error && <div className="persona-form__error">{error}</div>}
          <div className="callout">
            <Loader2 size={14} className="callout__icon" />
            <div>生成会调用 DeepSeek 并消耗 API 额度，通常需要 10—40 秒。生成后会自动打开档案，可以继续编辑。</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
