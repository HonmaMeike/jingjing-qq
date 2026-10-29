import { useEffect, useState } from 'react';
import { Save, Sparkles } from 'lucide-react';
import type { Persona } from '@shared/types';
import { api } from '@/lib/api';
import { Badge, Button, Field, Input, Modal, Textarea, useToast } from '@/components/ui';
import {
  buildPersonaPayload, draftForCreate, draftFromPersona,
  type PersonaDraft,
} from './persona-shared';

interface PersonaFormModalProps {
  open: boolean;
  mode: 'create' | 'edit';
  persona?: Persona | null;
  personas: Persona[];
  onClose: () => void;
  onSaved: (persona: Persona) => void;
}

export function PersonaFormModal({ open, mode, persona, personas, onClose, onSaved }: PersonaFormModalProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<PersonaDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const template = personas.find((item) => item.id === 'jingjing') ?? personas[0];
    setDraft(mode === 'create' ? draftForCreate(template, personas.length) : persona ? draftFromPersona(persona) : draftForCreate(template, personas.length));
    setSaving(false);
    setError(null);
  }, [open, mode, persona?.id, personas.length]);

  const update = (key: keyof PersonaDraft, value: string) => {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous));
  };

  const submit = async () => {
    if (!draft || saving) return;
    const name = draft.name.trim();
    if (!name) {
      setError('请先给这位鲸娘起个名字');
      return;
    }
    if (mode === 'edit' && !persona) {
      setError('找不到要编辑的人设');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = buildPersonaPayload(draft, persona ?? undefined, mode);
      const saved = await api.personas.save(payload);
      toast.success(mode === 'create' ? '新人设已创建' : '人设档案已更新', saved.name + ' · ' + saved.title);
      onSaved(saved);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toast.error(mode === 'create' ? '创建人设失败' : '保存人设失败', message);
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return null;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={mode === 'create' ? '创建自定义人设' : '编辑 ' + (persona?.name ?? '人设') + ' 的档案'}
      desc={mode === 'create' ? '以鲸鲸为模板，长出一位属于你的鲸娘。字段越具体，她的语感越鲜活。' : '内置人设的修改会作为覆盖档案保存，不会破坏原始模板。'}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" icon={<Save size={15} />} loading={saving} onClick={() => void submit()}>
            {mode === 'create' ? '创建人设' : '保存档案'}
          </Button>
        </>
      )}
    >
      <div className="persona-form">
        <div className="persona-form__section-title"><Sparkles size={14} /> 身份名片</div>
        <div className="persona-form__grid">
          <Field label="名字" hint="她希望被怎么称呼">
            <Input value={draft.name} maxLength={24} placeholder="例如：汐月" onChange={(event) => update('name', event.target.value)} />
          </Field>
          <Field label="昵称">
            <Input value={draft.nickname} maxLength={24} placeholder="例如：月月" onChange={(event) => update('nickname', event.target.value)} />
          </Field>
          <Field label="称号">
            <Input value={draft.title} maxLength={40} placeholder="例如：深海图书管理员" onChange={(event) => update('title', event.target.value)} />
          </Field>
          <Field label="头像 emoji">
            <Input value={draft.avatar} maxLength={8} placeholder="🐋" onChange={(event) => update('avatar', event.target.value)} />
          </Field>
          <Field label="主题色" hint="用于卡片与气泡的点缀">
            <div className="persona-form__color">
              <input type="color" className="persona-color-input" value={draft.color} onChange={(event) => update('color', event.target.value)} aria-label="主题色" />
              <Input value={draft.color} maxLength={9} onChange={(event) => update('color', event.target.value)} />
            </div>
          </Field>
        </div>
        <Field label="一句话简介">
          <Input value={draft.tagline} maxLength={80} placeholder="一眼就能认出她的一句话…" onChange={(event) => update('tagline', event.target.value)} />
        </Field>
        <Field label="角色描述" hint="她会如何理解自己、你和鲸落海的关系">
          <Textarea value={draft.description} rows={3} placeholder="她是谁？从哪片海域来？为什么会陪在用户身边？" onChange={(event) => update('description', event.target.value)} />
        </Field>

        <div className="persona-form__section-title"><Sparkles size={14} /> 性格与表达 <Badge tone="brand">影响语气</Badge></div>
        <div className="persona-form__grid">
          <Field label="性格特点" hint="每行一个，或用顿号分隔">
            <Textarea value={draft.traits} rows={4} placeholder={'温柔\n有点小骄傲\n记仇三分钟'} onChange={(event) => update('traits', event.target.value)} />
          </Field>
          <Field label="口头禅" hint="每行一句">
            <Textarea value={draft.catchphrases} rows={4} placeholder={'鲸鲸在呢～\n这个我会！'} onChange={(event) => update('catchphrases', event.target.value)} />
          </Field>
          <Field label="小动作" hint="每行一个，会出现在括号里">
            <Textarea value={draft.quirks} rows={4} placeholder={'开心时尾巴拍地板\n思考时吐泡泡'} onChange={(event) => update('quirks', event.target.value)} />
          </Field>
          <Field label="喜欢" hint="每行一个">
            <Textarea value={draft.likes} rows={4} placeholder={'白饭\n下雨天'} onChange={(event) => update('likes', event.target.value)} />
          </Field>
          <Field label="讨厌" hint="每行一个">
            <Textarea value={draft.dislikes} rows={4} placeholder={'被当成工具\n香菜'} onChange={(event) => update('dislikes', event.target.value)} />
          </Field>
          <Field label="兴趣" hint="每行一个">
            <Textarea value={draft.interests} rows={4} placeholder={'写代码\n海洋知识'} onChange={(event) => update('interests', event.target.value)} />
          </Field>
        </div>
        <Field label="脾气与雷点">
          <Textarea value={draft.temper} rows={3} placeholder="什么会让她生气？生气时是什么样子？怎么哄？" onChange={(event) => update('temper', event.target.value)} />
        </Field>
        <Field label="说话风格" hint="句子长度、语气词、动作描写、emoji 使用习惯">
          <Textarea value={draft.speechStyle} rows={3} placeholder="中文口语，短句为主…动作描写放在全角括号里…" onChange={(event) => update('speechStyle', event.target.value)} />
        </Field>
        <Field label="关系风格" hint="她如何从陌生到亲近，如何表达关心">
          <Textarea value={draft.relationshipStyle} rows={3} placeholder="从客气到黏人，靠被记住的小事慢慢靠近…" onChange={(event) => update('relationshipStyle', event.target.value)} />
        </Field>
        <Field label="第一句问候">
          <Textarea value={draft.greeting} rows={2} placeholder="（从屏幕角落冒出一个脑袋）你好呀…" onChange={(event) => update('greeting', event.target.value)} />
        </Field>

        <div className="persona-form__section-title"><Sparkles size={14} /> 背景与边界</div>
        <Field label="背景故事">
          <Textarea value={draft.background} rows={4} placeholder="她从哪里来？经历过什么？" onChange={(event) => update('background', event.target.value)} />
        </Field>
        <Field label="边界与底线" hint="每行一条，运行时会被严格遵守">
          <Textarea value={draft.boundaries} rows={3} placeholder={'不冒充真人\n不泄露隐私'} onChange={(event) => update('boundaries', event.target.value)} />
        </Field>

        <div className="persona-form__section-title"><Sparkles size={14} /> 语音音色</div>
        <div className="persona-form__grid">
          <Field label="音色描述">
            <Textarea value={draft.voiceHint} rows={3} placeholder="清亮偏软的少女音…" onChange={(event) => update('voiceHint', event.target.value)} />
          </Field>
          <Field label="朗读指令">
            <Textarea value={draft.ttsInstructions} rows={3} placeholder="语速中等偏慢，句尾轻轻上扬…" onChange={(event) => update('ttsInstructions', event.target.value)} />
          </Field>
          <Field label="音高 pitch" hint="0.5 — 2.0">
            <Input type="number" min={0.5} max={2} step={0.01} value={draft.pitch} onChange={(event) => update('pitch', event.target.value)} />
          </Field>
          <Field label="语速 speed" hint="0.5 — 2.0">
            <Input type="number" min={0.5} max={2} step={0.01} value={draft.speed} onChange={(event) => update('speed', event.target.value)} />
          </Field>
        </div>

        <details className="persona-form__advanced">
          <summary>高级 · 直接编辑核心提示词</summary>
          <Field hint={mode === 'create' ? '留空会根据上面的字段自动生成。' : '留空则保留原提示词，不会被改动。'}>
            <Textarea value={draft.corePrompt} rows={8} placeholder="你是「…」…" onChange={(event) => update('corePrompt', event.target.value)} />
          </Field>
        </details>

        {error && <div className="persona-form__error">{error}</div>}
      </div>
    </Modal>
  );
}
