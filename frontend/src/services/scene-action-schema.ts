/**
 * 场景动作 — 命令参数 Schema 注册表.
 *
 * 用途: SceneActionsAdmin 的动作编辑表单根据 (deviceType, command) 查这张表,
 * 渲染对应的 widget (slider / select / picker), 业主不用手写 JSON.
 *
 * 设计原则:
 *   - 每个命令的参数字段写成结构化 spec, 而不是自由文本 JSON
 *   - widget 类型只覆盖业务用得到的, 不追求 JSON Schema 通用性
 *   - 保留 JSON 高级模式 (form 编辑器同时双向同步), 复杂参数还能裸 JSON
 *   - 没注册的命令 fallback 到 JSON 文本框
 *
 * 字段对照 backend/scene-engine 实际消费的 params, 不要随便改 key.
 */

import type { Device } from '@/types/api';

export type WidgetType =
  | 'noop'           // 没参数 (turnOn / turnOff / mute / unmute)
  | 'slider'         // 0-100 滑条 (亮度 / 音量)
  | 'number'         // 数字输入 (温度 / 时长 ms)
  | 'select'         // 静态枚举下拉
  | 'switch'         // 布尔开关
  | 'text'           // 自由文本 (兜底)
  | 'media-picker'   // 媒体库挑一个 mediaId (number)
  | 'scene-picker'   // 场景下拉, 得 scene code (string)
  | 'playback-slot'; // 1 = LED, 2 = 投影

export interface SelectOption {
  value: string | number;
  label: string;
}

export interface ParamSpec {
  key: string;                  // params 里的 key
  label: string;                // form 上显示的中文
  widget: WidgetType;
  required?: boolean;
  default?: unknown;
  /** slider / number 用 */
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** select / radio 用 */
  options?: SelectOption[];
  /** text / number placeholder */
  placeholder?: string;
  /** 帮助文字, 字段下方灰色一行 */
  help?: string;
}

export interface CommandSpec {
  /** 中文命令名, 显示给业主, e.g. "调亮度" */
  label: string;
  /** 命令一行解释 */
  description?: string;
  /** 参数列表, 空数组 = 命令无参数 (像 turnOn) */
  params: ParamSpec[];
}

/** 设备类型 → 中文 + 后续 device-picker 用的 category 过滤 key */
export const DEVICE_TYPE_META: Record<string, { label: string; icon: string; deviceCategory?: Device['category'] | Device['category'][] }> = {
  lighting:    { label: '灯光', icon: '💡', deviceCategory: 'lighting' },
  led:         { label: 'LED 大屏', icon: '🖥', deviceCategory: 'led' },
  audio:       { label: '音响', icon: '🔊', deviceCategory: 'audio' },
  hvac:        { label: '空调 (单台)', icon: '❄️', deviceCategory: 'hvac' },
  'hvac-zone': { label: '空调 (按分区)', icon: '🏢' },
  power:       { label: '电源', icon: '⚡' },
  playback:    { label: '播控通道', icon: '🎬' },
};

export const DEVICE_TYPE_LIST = Object.entries(DEVICE_TYPE_META).map(([v, m]) => ({ value: v, label: `${m.icon} ${m.label}` }));

/** Key = "deviceType.command", e.g. "lighting.setBrightness" */
export const COMMAND_SCHEMA: Record<string, CommandSpec> = {
  // ---------- 灯光 ----------
  'lighting.turnOn':  { label: '开灯', description: '把对应灯具/灯组打开', params: [] },
  'lighting.turnOff': { label: '关灯', description: '关闭对应灯具/灯组', params: [] },
  'lighting.setBrightness': {
    label: '调亮度', description: '0-100% 调节亮度 (0=灭, 100=最亮)',
    params: [
      { key: 'value', label: '亮度', widget: 'slider', min: 0, max: 100, step: 1, suffix: '%', required: true, default: 80 },
    ],
  },
  'lighting.recallScene': {
    label: '调用灯光预设', description: 'DALI 网关里预存的场景 1-16',
    params: [
      { key: 'sceneNo', label: '预设编号', widget: 'number', min: 1, max: 16, step: 1, required: true, default: 1 },
    ],
  },

  // ---------- LED 大屏 ----------
  'led.powerOn':  { label: '开屏', params: [] },
  'led.powerOff': { label: '关屏', params: [] },
  'led.showWelcome': { label: '欢迎页 (V2460 预设)', params: [] },
  'led.switchInput': {
    label: '切输入源',
    params: [
      { key: 'input', label: '输入源', widget: 'select', required: true, default: 'HDMI1', options: [
        { value: 'HDMI1', label: 'HDMI1 (默认/GK9000 主显)' },
        { value: 'HDMI2', label: 'HDMI2' },
        { value: 'welcome', label: '欢迎页' },
        { value: 'video', label: '视频通道' },
      ]},
    ],
  },
  'led.playMedia': {
    label: '播放媒体 (旧接口)', description: '推荐用 "播控通道 → 推送媒体" 替代, 那个走 PlayerPage 通道更稳',
    params: [
      { key: 'media', label: '文件名', widget: 'text', placeholder: 'welcome.mp4', help: '需要 NUC 播控时填; V2460 直连模式忽略此字段' },
    ],
  },

  // ---------- 音响 ----------
  'audio.setVolume': {
    label: '调音量',
    params: [
      { key: 'value', label: '音量', widget: 'slider', min: 0, max: 100, step: 1, suffix: '%', required: true, default: 60 },
    ],
  },
  'audio.mute':   { label: '静音',   params: [] },
  'audio.unmute': { label: '取消静音', params: [] },
  'audio.playBgm': {
    label: '播放背景音乐',
    params: [
      { key: 'track', label: '曲目', widget: 'text', placeholder: 'bgm_jazz / bgm_welcome / ...', help: 'DSP 处理器里预置的曲目 ID' },
    ],
  },
  'audio.stopBgm':  { label: '停止背景音乐', params: [] },
  'audio.enableMic': {
    label: '开启麦克风',
    params: [
      { key: 'micId', label: '麦克风通道', widget: 'select', options: [
        { value: 'wireless_1', label: '无线话筒 1' },
        { value: 'wireless_2', label: '无线话筒 2' },
        { value: 'tour_guide', label: '跟随讲解' },
      ]},
    ],
  },

  // ---------- 空调 (单台 hvac) ----------
  'hvac.turnOn':  { label: '开空调', params: [] },
  'hvac.turnOff': { label: '关空调', params: [] },
  'hvac.setTemperature': {
    label: '设定温度',
    params: [
      { key: 'temp', label: '目标温度', widget: 'number', min: 16, max: 30, step: 1, suffix: '°C', required: true, default: 24 },
    ],
  },
  'hvac.setMode': {
    label: '设定运行模式',
    params: [
      { key: 'mode', label: '模式', widget: 'select', required: true, default: 'cool', options: [
        { value: 'cool', label: '制冷' },
        { value: 'heat', label: '制热' },
        { value: 'fan',  label: '送风' },
        { value: 'dry',  label: '除湿' },
        { value: 'auto', label: '自动' },
      ]},
    ],
  },
  'hvac.setFanSpeed': {
    label: '设定风速',
    params: [
      { key: 'speed', label: '风速档位', widget: 'select', required: true, default: 2, options: [
        { value: 1, label: '低速' },
        { value: 2, label: '中速' },
        { value: 3, label: '高速' },
        { value: 0, label: '自动' },
      ]},
    ],
  },

  // ---------- 空调分区 (hvac-zone) ----------
  // deviceId 写 zone code, 命令跟 hvac 一致
  'hvac-zone.turnOn':         { label: '区域开空调', params: [] },
  'hvac-zone.turnOff':        { label: '区域关空调', params: [] },
  'hvac-zone.setTemperature': { label: '区域设温度', params: [{ key: 'temp', label: '目标温度', widget: 'number', min: 16, max: 30, step: 1, suffix: '°C', required: true, default: 24 }] },
  'hvac-zone.setMode':        { label: '区域设模式', params: [{ key: 'mode', label: '模式', widget: 'select', required: true, default: 'cool', options: [
    { value: 'cool', label: '制冷' }, { value: 'heat', label: '制热' }, { value: 'fan', label: '送风' }, { value: 'dry', label: '除湿' }, { value: 'auto', label: '自动' },
  ]}] },
  'hvac-zone.setFanSpeed':    { label: '区域设风速', params: [{ key: 'speed', label: '风速档位', widget: 'select', required: true, default: 2, options: [
    { value: 1, label: '低速' }, { value: 2, label: '中速' }, { value: 3, label: '高速' }, { value: 0, label: '自动' },
  ]}] },

  // ---------- 电源 ----------
  'power.turnOn':  { label: '通电',   params: [] },
  'power.turnOff': { label: '断电',   params: [] },

  // ---------- 播控通道 (Sprint-A 新增, 推荐取代 led.playMedia) ----------
  'playback.publish': {
    label: '推送媒体到通道', description: '推荐用法 — 把媒体库里的视频/图片推到 HDMI1 (LED) 或 HDMI2 (投影)',
    params: [
      { key: 'slot', label: '通道', widget: 'playback-slot', required: true, default: 1 },
      { key: 'mediaId', label: '媒体', widget: 'media-picker', required: true },
      { key: 'loopMode', label: '播放方式', widget: 'select', default: 'once', options: [
        { value: 'once', label: '播一次 (播完停在最后一帧)' },
        { value: 'loop', label: '循环播放' },
      ]},
    ],
  },
  'playback.stop': {
    label: '停止通道 (回待机)',
    params: [
      { key: 'slot', label: '通道', widget: 'playback-slot', required: true, default: 1 },
    ],
  },
};

/** 命令查找: 没注册返 null, 调用方 fallback 到 raw JSON */
export function getCommandSpec(deviceType: string, command: string): CommandSpec | null {
  return COMMAND_SCHEMA[`${deviceType}.${command}`] ?? null;
}

/** 列出某 deviceType 下所有已注册命令 (给命令下拉用) */
export function listCommandsForType(deviceType: string): Array<{ value: string; label: string; description?: string }> {
  const prefix = `${deviceType}.`;
  return Object.entries(COMMAND_SCHEMA)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ value: k.slice(prefix.length), label: v.label, description: v.description }));
}

/** 把表单值 (按 schema) 转成扁平 params 对象, 跳过没填的 optional 字段 */
export function paramsFromForm(spec: CommandSpec, formValues: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of spec.params) {
    const v = formValues[p.key];
    if (v === undefined || v === null || v === '') {
      if (p.required) {
        // 必填字段为空, 走默认值; 真没默认的让外面校验拦
        if (p.default !== undefined) out[p.key] = p.default;
      }
      continue;
    }
    out[p.key] = v;
  }
  return out;
}

/** 把已存在的 raw params 反向填到表单 (编辑老数据时用) */
export function formFromParams(spec: CommandSpec, params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of spec.params) {
    out[p.key] = params[p.key] ?? p.default;
  }
  return out;
}

/**
 * 把一条动作拼成人话, e.g.:
 *   把 [一层主灯] 亮度调到 80%
 *   把 [HDMI1 → LED] 推送视频 #5
 *   开 [音响主区]
 *
 * params 走 schema 的 label + value (枚举值反查 options.label).
 * 不在 schema 的命令 fallback 到 "<command> <params JSON>" 原样.
 */
export function humanizeAction(deviceType: string, deviceId: string, command: string, rawParams: string): string {
  let params: Record<string, unknown> = {};
  try { params = rawParams ? JSON.parse(rawParams) : {}; } catch { /* ignore */ }

  const spec = getCommandSpec(deviceType, command);
  const deviceLabel = `[${deviceId}]`;

  if (!spec) {
    return `${deviceLabel} ${command}` + (Object.keys(params).length ? ` ${JSON.stringify(params)}` : '');
  }

  // 把 params 渲染成 key=value 短串, 枚举 value 反查中文
  const parts: string[] = [];
  for (const p of spec.params) {
    const v = params[p.key];
    if (v === undefined || v === null || v === '') continue;
    let valueText: string;
    if (p.widget === 'select' && Array.isArray(p.options)) {
      const opt = p.options.find((o) => o.value === v);
      valueText = opt ? opt.label : String(v);
    } else if (p.widget === 'switch') {
      valueText = v ? '开' : '关';
    } else if (p.widget === 'playback-slot') {
      valueText = v === 2 ? 'HDMI2 (投影)' : 'HDMI1 (LED)';
    } else {
      valueText = String(v) + (p.suffix ?? '');
    }
    parts.push(`${p.label} ${valueText}`);
  }

  const paramStr = parts.length ? `, ${parts.join(', ')}` : '';
  return `${deviceLabel} ${spec.label}${paramStr}`;
}
