import {
  BookOpen, Globe, GraduationCap, Lightbulb, MessageCircle, MessageSquare, Play, Settings2, Sparkles,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ActivityType } from '@shared/types';

const ICONS: Record<ActivityType, LucideIcon> = {
  proactive: MessageCircle,
  diary: BookOpen,
  qzone: Globe,
  bilibili: Play,
  learning: GraduationCap,
  reflection: Lightbulb,
  growth: Sparkles,
  system: Settings2,
  chat: MessageSquare,
};

export default function ActivityTypeIcon({ type, size = 15 }: { type: ActivityType; size?: number }) {
  const Icon = ICONS[type] ?? Sparkles;
  return <Icon size={size} />;
}
