/**
 * 统一图标映射 (Sprint-10 视觉升级)
 * 用 lucide-vue-next 取代旧 emoji, 跨浏览器渲染一致, 现代 stroke 风格
 */
import {
  Home,
  Lightbulb,
  MonitorPlay,
  Volume2,
  Snowflake,
  Radio,
  Settings,
  PartyPopper,
  Handshake,
  Users,
  Clapperboard,
  Sparkles,
  Moon,
  Zap,
  Activity,
  BellRing,
  Wrench,
  Clock,
  BarChart3,
  TestTube2,
  CheckCircle2,
  FileText,
  Cable,
  FolderOpen,
  Cpu,
  History,
  Tag,
  Palette,
  type LucideIcon,
} from 'lucide-vue-next';

/** 平板侧边导航 */
export const NAV_ICON: Record<string, LucideIcon> = {
  dashboard: Home,
  lighting: Lightbulb,
  led: MonitorPlay,
  audio: Volume2,
  hvac: Snowflake,
  power: Zap,
  media: FolderOpen,
  status: Radio,
  'admin-devices': Settings,
};

/** 后台 AdminLayout 侧边导航 */
export const ADMIN_NAV_ICON: Record<string, LucideIcon> = {
  'admin-monitor': Activity,
  'admin-alerts': BellRing,
  'admin-devices': Wrench,
  'admin-scenes': Clapperboard,
  'admin-scheduler': Clock,
  'admin-scene-executions': BarChart3,
  'admin-test-center': TestTube2,
  'admin-uat': CheckCircle2,
  'admin-logs': FileText,
  'admin-hardware': Cable,
  'admin-light-zones': Lightbulb,
  'admin-power-circuits': Zap,
  'admin-app-release': Settings,
  'admin-drivers': Cpu,
  'admin-brands': Tag,
  'admin-system-branding': Palette,
  'admin-audit': History,
  'admin-users': Users,
  'admin-settings': Settings,
};

/** 场景 icon (按 sceneCode) */
export const SCENE_ICON: Record<string, LucideIcon> = {
  opening: PartyPopper,
  reception: Handshake,
  meeting: Users,
  roadshow: Clapperboard,
  cleaning: Sparkles,
  closing: Moon,
};

/** 子系统类别 icon */
export const CATEGORY_ICON: Record<string, LucideIcon> = {
  lighting: Lightbulb,
  led: MonitorPlay,
  audio: Volume2,
  hvac: Snowflake,
  power: Zap,
};

export function navIconFor(name: string): LucideIcon {
  return NAV_ICON[name] ?? Settings;
}
export function adminNavIconFor(name: string): LucideIcon {
  return ADMIN_NAV_ICON[name] ?? Settings;
}
export function sceneIconFor(code: string): LucideIcon {
  return SCENE_ICON[code] ?? Settings;
}
export function categoryIconFor(key: string): LucideIcon {
  return CATEGORY_ICON[key] ?? Zap;
}
