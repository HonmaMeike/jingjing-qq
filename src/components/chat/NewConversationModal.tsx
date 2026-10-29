import { useEffect, useState } from 'react';
import { MessagesSquare, Plus, Sparkles, Users } from 'lucide-react';
import type { Conversation } from '@shared/types';
import { api } from '@/lib/api';
import { Badge, Button, Field, Input, Modal, Segmented, Toggle, useToast } from '@/components/ui';

interface NewConversationModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (conversation: Conversation) => void;
}

export function NewConversationModal({ open, onClose, onCreated }: NewConversationModalProps) {
  const toast = useToast();
  const [peerName, setPeerName] = useState('');
  const [scene, setScene] = useState<'private' | 'group'>('private');
  const [demo, setDemo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPeerName('');
    setScene('private');
    setDemo(false);
    setError(null);
    setBusy(false);
  }, [open]);

  const submit = async () => {
    const name = peerName.trim();
    if (!name) {
      setError(scene === 'group' ? '先给这个群起个名字' : '先填一下对方的名字');
      return;
    }
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const conversation = await api.chat.create(name, scene, demo);
      toast.success('会话已创建', scene === 'group' ? '群聊「' + name + '」已加入对话列表' : '和 ' + name + ' 的私聊已就绪');
      onCreated(conversation);
      onClose();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toast.error('创建会话失败', message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建一段对话"
      desc="鲸鲸会用当前人设回应；演示会话适合先体验完整流程。"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" icon={<Plus size={15} />} loading={busy} onClick={() => void submit()}>创建会话</Button>
        </>
      )}
    >
      <div className="chat-new-form">
        <Field
          label="会话场景"
          hint={scene === 'group' ? '群聊里鲸鲸只在被 @ 或命中唤醒词时发言，避免刷屏。' : '私聊会直接以当前人设回应，适合日常陪伴。'}
        >
          <Segmented<'private' | 'group'>
            value={scene}
            onChange={setScene}
            items={[
              { value: 'private', label: <span className="chat-new-scene"><MessagesSquare size={13} /> 私聊</span> },
              { value: 'group', label: <span className="chat-new-scene"><Users size={13} /> 群聊</span> },
            ]}
          />
        </Field>
        <Field label={scene === 'group' ? '群名称' : '对方昵称'} error={error ?? undefined} hint={scene === 'group' ? '例如：深海摸鱼小分队' : '例如：阿澈、妈妈、室友小周'}>
          <Input
            autoFocus
            value={peerName}
            maxLength={40}
            placeholder={scene === 'group' ? '给群起个名字…' : '对方怎么称呼？'}
            onChange={(event) => { setPeerName(event.target.value); if (error) setError(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
          />
        </Field>
        <div className="chat-new-demo">
          <div className="chat-new-demo__text">
            <div className="chat-new-demo__title">演示模式 <Badge tone="warning">可随时清除</Badge></div>
            <div className="chat-new-demo__desc">标记为演示会话，方便试用而不污染真实聊天记录。可在设置里一键清理。</div>
          </div>
          <Toggle checked={demo} onChange={setDemo} label="演示模式" />
        </div>
        <div className="callout callout--brand">
          <Sparkles size={15} className="callout__icon" />
          <div>创建成功后，鲸鲸会为这段关系单独建立记忆档案；第一句话就是你们关系的起点。</div>
        </div>
      </div>
    </Modal>
  );
}
