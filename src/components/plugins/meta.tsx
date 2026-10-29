import React from 'react';
import {
  BookOpen, Brain, Compass, GraduationCap, Image, MessagesSquare, Mic, Music, Orbit, Palette,
  Search, Send, Sparkles, Terminal, Video, Wrench,
} from 'lucide-react';
import type { PluginInfo } from '@shared/types';
import { Badge } from '@/components/ui';

export const PLUGIN_CATEGORY_ORDER: PluginInfo['category'][] = ['core', 'channel', 'creation', 'knowledge', 'autonomy', 'utility'];

export const PLUGIN_CATEGORY_META: Record<PluginInfo['category'], { label: string; desc: string; icon: React.ReactNode }> = {
  core: { label: '核心能力', desc: '人设、对话与长期记忆等基础模块', icon: <Sparkles size={17} /> },
  channel: { label: '消息通道', desc: 'QQ 连接、收发与登录托管', icon: <MessagesSquare size={17} /> },
  creation: { label: '创作工坊', desc: '语音、图像、视频与音乐生成', icon: <Palette size={17} /> },
  knowledge: { label: '知识检索', desc: '搜索、学习与资料沉淀', icon: <BookOpen size={17} /> },
  autonomy: { label: '自主行为', desc: '主动消息、空间、日记与成长', icon: <Compass size={17} /> },
  utility: { label: '实用工具', desc: '系统集成与效率工具', icon: <Wrench size={17} /> },
};

export const PLUGIN_STATUS_META: Record<PluginInfo['status'], { label: string; desc: string; tone: 'default' | 'brand' | 'success' | 'warning' | 'danger' }> = {
  ready: { label: '就绪', desc: '正常运行中', tone: 'success' },
  'needs-config': { label: '待配置', desc: '需要填写密钥或参数', tone: 'warning' },
  disabled: { label: '已停用', desc: '当前不会加载该插件', tone: 'default' },
  error: { label: '异常', desc: '运行出错，请检查配置', tone: 'danger' },
};

/** 主进程下发的插件图标是 lucide 图标名，映射成有辨识度的矢量图标。 */
const PLUGIN_ICON_MAP: Record<string, React.ReactNode> = {
  brain: <Brain size={20} />,
  terminal: <Terminal size={20} />,
  mic: <Mic size={20} />,
  image: <Image size={20} />,
  music: <Music size={20} />,
  search: <Search size={20} />,
  video: <Video size={20} />,
  send: <Send size={20} />,
  book: <BookOpen size={20} />,
  sparkles: <Sparkles size={20} />,
  orbit: <Orbit size={20} />,
  graduation: <GraduationCap size={20} />,
};

export function categoryOf(category: PluginInfo['category']) {
  return PLUGIN_CATEGORY_META[category] ?? PLUGIN_CATEGORY_META.utility;
}

export function PluginStatusBadge({ status }: { status: PluginInfo['status'] }) {
  const meta = PLUGIN_STATUS_META[status] ?? PLUGIN_STATUS_META.disabled;
  return <Badge tone={meta.tone} dot={status === 'ready'}>{meta.label}</Badge>;
}

/** 插件图标：优先使用后端下发的 emoji / lucide 名称，其次回退到分类图标。 */
export function PluginGlyph({ plugin }: { plugin: PluginInfo }) {
  const raw = (plugin.icon || '').trim();
  const emoji = raw && /[^\x00-\x7F]/.test(raw) ? raw : null;
  const vector = PLUGIN_ICON_MAP[raw.toLowerCase()];
  return (
    <div className="plg-glyph" data-cat={plugin.category} aria-hidden>
      {emoji ? <span className="plg-glyph__emoji">{emoji}</span> : (vector ?? categoryOf(plugin.category).icon)}
    </div>
  );
}
