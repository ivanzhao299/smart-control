/**
 * 首页四个情景模式的推荐动作编排 (2026-07-26 按现场接线现实全量重写)。
 *
 * 业主: "直接点击情景模式以后按照推荐配置做好, 点击模式卡片切换到相应场景"。
 *
 * 只用**已验证可用**的调度原语 (command-dispatcher):
 * - lighting: deviceId 用 {"slaveId":N,"group":M} JSON 地址串 —— 组号在两台
 *   网关间会重复, 必须带 slaveId (2026-07-16 灯光模型铁律)。现场实测组分布:
 *   网关1(拨码1)=组5-11, 网关2(拨码2)=组1-3。
 * - audio: deviceId 直接用 out1..out8 (EKX ZONE_TO_OUT); out1/2=LED声道,
 *   out3/4=投影声道, out5-8=分区喇叭 (与 2026-07-26 割接一致)。
 * - led: 诺瓦 V2460 单控制器, powerOn/powerOff/showWelcome。
 * - hvac-zone: zone code 扇出到区内全部内机。
 * - 'power' 类型是 mock 遗留、不接真时序器 —— 电源时序**不入场景**,
 *   开闭馆总电源仍走电源页"时序开机/关机" (接入场景引擎待后续专项)。
 *
 * 数值是推荐起点, 业主可在后台「场景管理 → 动作配置」逐条微调, 一次性
 * 割接后代码不再覆盖 (见 ScenesService.healRecommendedActions 哨兵)。
 */

export interface SceneActionSeed {
  deviceType: string;
  deviceId: string;
  command: string;
  params?: Record<string, unknown>;
  delayMs?: number;
}

/** 现场实测灯组: 网关1=组5-11, 网关2=组1-3 (共 10 组) */
const LIGHT_GROUPS: Array<{ slaveId: number; group: number }> = [
  ...[5, 6, 7, 8, 9, 10, 11].map((group) => ({ slaveId: 1, group })),
  ...[1, 2, 3].map((group) => ({ slaveId: 2, group })),
];

const lightsAll = (value: number): SceneActionSeed[] =>
  LIGHT_GROUPS.map((addr) => ({
    deviceType: 'lighting',
    deviceId: JSON.stringify(addr),
    command: 'setBrightness',
    params: { value, fadeSec: 2 },
  }));

const lightsOff = (): SceneActionSeed[] =>
  LIGHT_GROUPS.map((addr) => ({
    deviceType: 'lighting',
    deviceId: JSON.stringify(addr),
    command: 'turnOff',
    params: { fadeSec: 3 },
  }));

const MAIN_OUTS = ['out1', 'out2', 'out3', 'out4']; // LED 左右 + 投影左右
const ZONE_OUTS = ['out5', 'out6', 'out7', 'out8']; // 二楼办公/二楼走廊/前厅东北/一楼展位

const audioSet = (outs: string[], volume: number): SceneActionSeed[] =>
  outs.flatMap((id) => [
    { deviceType: 'audio', deviceId: id, command: 'unmute' },
    { deviceType: 'audio', deviceId: id, command: 'setVolume', params: { value: volume } },
  ]);

const audioMute = (outs: string[]): SceneActionSeed[] =>
  outs.map((id) => ({ deviceType: 'audio', deviceId: id, command: 'mute' }));

/** 空调全部 zone code (hvac-zones.ts) — 闭馆全关用 */
const HVAC_ALL = [
  'enterprise_booth', 'livestream', 'foreign_trade', 'park_display', 'roadshow',
  'showcase', 'group_mgmt', 'decision_center', 'meeting_room', 'shared_office', 'service_center',
];

const hvacOn = (codes: string[], temperature: number): SceneActionSeed[] =>
  codes.flatMap((id) => [
    { deviceType: 'hvac-zone', deviceId: id, command: 'turnOn' },
    { deviceType: 'hvac-zone', deviceId: id, command: 'setMode', params: { mode: 'cool' } as Record<string, unknown> },
    { deviceType: 'hvac-zone', deviceId: id, command: 'setTemperature', params: { value: temperature } },
  ]);

const hvacOff = (codes: string[]): SceneActionSeed[] =>
  codes.map((id) => ({ deviceType: 'hvac-zone', deviceId: id, command: 'turnOff' }));

export const RECOMMENDED_SCENE_ACTIONS: Record<string, SceneActionSeed[]> = {
  // ============ 开馆模式: 全场亮起, 欢迎画面, 背景音乐, 展区空调 ============
  opening: [
    ...lightsAll(80),
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'powerOn' },
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'showWelcome', delayMs: 800 },
    ...audioSet(MAIN_OUTS, 55),
    ...audioSet(ZONE_OUTS, 45),
    ...hvacOn(['park_display', 'enterprise_booth', 'foreign_trade', 'showcase', 'service_center'], 25),
  ],

  // ============ 接待模式: 柔和明亮, 欢迎画面, 轻背景音乐, 接待区空调 ============
  reception: [
    ...lightsAll(70),
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'powerOn' },
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'showWelcome', delayMs: 800 },
    ...audioSet(MAIN_OUTS, 50),
    ...audioSet(ZONE_OUTS, 35),
    ...hvacOn(['decision_center', 'group_mgmt', 'service_center', 'meeting_room'], 24),
  ],

  // ============ 路演模式: 压暗突出画面, 主声道大声, 分区静音, 路演区制冷 ============
  roadshow: [
    ...lightsAll(40),
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'powerOn' },
    ...audioSet(MAIN_OUTS, 70),
    ...audioMute(ZONE_OUTS),
    ...hvacOn(['roadshow', 'livestream'], 23),
  ],

  // ============ 闭馆模式: 声音先静, 屏关, 灯缓灭, 空调全关 ============
  closing: [
    ...audioMute([...MAIN_OUTS, ...ZONE_OUTS]),
    { deviceType: 'led', deviceId: 'led_1f_main', command: 'powerOff', delayMs: 500 },
    ...lightsOff(),
    ...hvacOff(HVAC_ALL),
  ],
};
