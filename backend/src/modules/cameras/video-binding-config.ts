export interface NvrDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  rtspPort: number;
  username: string;
  password: string;
  brand: string;
  enabled: boolean;
  createdAt: string;
  /**
   * 完整自定义 RTSP 源（不含凭据，凭据由 username/password 统一注入）。
   * 存在时直接使用该路径，跳过海康 /Streaming/Channels 模板；
   * 例如 rtsp://192.168.180.101:8557/sub_stream_1。
   */
  rtspUrl?: string;
  /**
   * 空闲自动停止秒数：HLS 播放列表/分片连续这么久无人拉取（即无人观看），
   * 自动停止 ffmpeg 转码以释放 CPU/带宽；0 或缺省=常驻（海康 NVR 保持常驻）。
   */
  idleStopSeconds?: number;
  /** 转码输出宽度（px），高度按源比例自动取偶数；缺省 640（匹配大屏视频窗，降低拉流压力）。 */
  hlsWidth?: number;
}

export type NvrDeviceView = Omit<NvrDevice, 'password'> & { hasPassword: boolean };

export interface NormPoint {
  x: number;
  y: number;
}

export interface ChannelAiConfig {
  aiEnabled?: boolean;
  countLine?: NormPoint[];
  roiPolygon?: NormPoint[];
}

export interface CameraChannel {
  id: string;
  nvrId: string;
  hikChannel: string;
  name: string;
  alias: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
  aiEnabled?: boolean;
  countLine?: NormPoint[];
  roiPolygon?: NormPoint[];
}

export interface VideoBindingConfig {
  nvrs: NvrDevice[];
  channels: CameraChannel[];
  displayLayout: { columns: number; channelIds: string[] };
  aiBoxEnabled?: boolean;
  updatedAt: string;
}

export type VideoBindingConfigView = Omit<VideoBindingConfig, 'nvrs'> & {
  nvrs: NvrDeviceView[];
  /** SQLite 权威文档修订号；写入方据此拒绝覆盖更新后的配置。 */
  revision: number;
};

export const VIDEO_BINDING_CONFIG_KEY = 'video.binding';
export const VIDEO_BINDING_SCHEMA_VERSION = 1;
// 车辆进出 AI 实时分析已由「人车管理」页 8 路视频墙取代，默认不再对任何通道启用；
// 服务进程保留，后续要做其他视频分析时，在后台逐路开启 aiEnabled 即可。
export const DEFAULT_AI_CAMERA_IDS: string[] = [];
export const DEFAULT_COUNT_LINE: NormPoint[] = [
  { x: 0.5, y: 0.2 },
  { x: 0.5, y: 0.8 },
];
export const MAX_ROI_POINTS = 16;

const epoch = '1970-01-01T00:00:00.000Z';

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`${name} must be a string`);
  }
  return value;
}

function integer(value: unknown, name: string, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return number;
}

export function clampVideoPoint(value: unknown): NormPoint {
  const point = record(value, 'point');
  const coordinate = (input: unknown): number => {
    const number = Number(input);
    if (!Number.isFinite(number)) return 0;
    return Math.min(1, Math.max(0, number));
  };
  return { x: coordinate(point.x), y: coordinate(point.y) };
}

export function normalizeVideoBindingConfig(input: unknown): VideoBindingConfig {
  const value = record(input, 'video binding configuration');
  if (!Array.isArray(value.nvrs) || !Array.isArray(value.channels)) {
    throw new Error('video binding devices and channels must be arrays');
  }
  const nvrs = value.nvrs.map((entry, index): NvrDevice => {
    const item = record(entry, `nvrs[${index}]`);
    const rawRtsp = typeof item.rtspUrl === 'string' ? item.rtspUrl.trim() : '';
    const idleNum = Number(item.idleStopSeconds);
    const widthNum = Number(item.hlsWidth);
    return {
      id: text(item.id, `nvrs[${index}].id`),
      name: text(item.name, `nvrs[${index}].name`),
      ip: text(item.ip, `nvrs[${index}].ip`),
      port: integer(item.port, `nvrs[${index}].port`, 1, 65535),
      rtspPort: integer(item.rtspPort, `nvrs[${index}].rtspPort`, 1, 65535),
      username: text(item.username, `nvrs[${index}].username`, true),
      password: text(item.password, `nvrs[${index}].password`, true),
      brand: text(item.brand, `nvrs[${index}].brand`),
      enabled: item.enabled !== false,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : epoch,
      rtspUrl: rawRtsp || undefined,
      idleStopSeconds:
        Number.isFinite(idleNum) && idleNum > 0 ? Math.min(86400, Math.floor(idleNum)) : undefined,
      hlsWidth:
        Number.isFinite(widthNum) && widthNum >= 160 && widthNum <= 3840
          ? Math.floor(widthNum)
          : undefined,
    };
  });
  const nvrIds = new Set(nvrs.map((nvr) => nvr.id));
  if (nvrIds.size !== nvrs.length) throw new Error('video binding NVR ids must be unique');
  const channels = value.channels.map((entry, index): CameraChannel => {
    const item = record(entry, `channels[${index}]`);
    const id = text(item.id, `channels[${index}].id`);
    const isDefaultAi = DEFAULT_AI_CAMERA_IDS.includes(id);
    const line =
      Array.isArray(item.countLine) && item.countLine.length === 2
        ? item.countLine.map(clampVideoPoint)
        : isDefaultAi
          ? DEFAULT_COUNT_LINE.map((point) => ({ ...point }))
          : undefined;
    const polygon = Array.isArray(item.roiPolygon)
      ? item.roiPolygon.slice(0, MAX_ROI_POINTS).map(clampVideoPoint)
      : [];
    return {
      id,
      nvrId: text(item.nvrId, `channels[${index}].nvrId`),
      hikChannel: text(item.hikChannel, `channels[${index}].hikChannel`),
      name: text(item.name, `channels[${index}].name`),
      alias: text(item.alias, `channels[${index}].alias`, true),
      enabled: item.enabled !== false,
      sortOrder: integer(item.sortOrder, `channels[${index}].sortOrder`, 0, 100000),
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : epoch,
      aiEnabled: typeof item.aiEnabled === 'boolean' ? item.aiEnabled : isDefaultAi,
      countLine: line,
      roiPolygon: polygon.length >= 3 ? polygon : [],
    };
  });
  const channelIds = new Set(channels.map((channel) => channel.id));
  if (channelIds.size !== channels.length)
    throw new Error('video binding channel ids must be unique');
  if (channels.some((channel) => !nvrIds.has(channel.nvrId))) {
    throw new Error('video binding channel references an unknown NVR');
  }
  const layout = record(value.displayLayout, 'displayLayout');
  if (!Array.isArray(layout.channelIds))
    throw new Error('displayLayout.channelIds must be an array');
  const layoutChannelIds = layout.channelIds.map((id, index) =>
    text(id, `displayLayout.channelIds[${index}]`),
  );
  if (layoutChannelIds.some((id) => !channelIds.has(id))) {
    throw new Error('displayLayout references an unknown channel');
  }
  if (new Set(layoutChannelIds).size !== layoutChannelIds.length) {
    throw new Error('displayLayout channel ids must be unique');
  }
  return {
    nvrs,
    channels,
    displayLayout: {
      columns: integer(layout.columns, 'displayLayout.columns', 1, 12),
      channelIds: layoutChannelIds,
    },
    aiBoxEnabled: value.aiBoxEnabled !== false,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : epoch,
  };
}

export function defaultVideoBindingConfig(now = new Date().toISOString()): VideoBindingConfig {
  return normalizeVideoBindingConfig({
    nvrs: [
      {
        id: 'nvr-port5',
        name: '消防控制室Port5录像机',
        ip: '192.168.1.5',
        port: 80,
        rtspPort: 554,
        username: 'admin',
        password: '',
        brand: 'hikvision',
        enabled: true,
        createdAt: now,
      },
      {
        id: 'nvr-port3',
        name: '消防控制室Port3录像机',
        ip: '192.168.1.19',
        port: 80,
        rtspPort: 554,
        username: 'admin',
        password: '',
        brand: 'hikvision',
        enabled: true,
        createdAt: now,
      },
      ...buildLprSeedNvrs(now),
    ],
    channels: [
      {
        id: 'd37',
        nvrId: 'nvr-port5',
        hikChannel: '3701',
        name: '大门',
        alias: 'D37大门',
        enabled: true,
        sortOrder: 1,
        createdAt: now,
      },
      {
        id: 'd57',
        nvrId: 'nvr-port5',
        hikChannel: '5701',
        name: '通道57',
        alias: 'D57通道57',
        enabled: true,
        sortOrder: 2,
        createdAt: now,
      },
      {
        id: 'd02',
        nvrId: 'nvr-port5',
        hikChannel: '201',
        name: '通道2',
        alias: 'D02通道2',
        enabled: true,
        sortOrder: 3,
        createdAt: now,
      },
      {
        id: 'p3-d37',
        nvrId: 'nvr-port3',
        hikChannel: '3701',
        name: 'Port3通道37',
        alias: 'P3-D37',
        enabled: true,
        sortOrder: 4,
        createdAt: now,
      },
      {
        id: 'p3-d45',
        nvrId: 'nvr-port5',
        hikChannel: '4501',
        name: 'Port5通道45',
        alias: 'P5-D45',
        enabled: true,
        sortOrder: 5,
        createdAt: now,
      },
      {
        id: 'p3-d50',
        nvrId: 'nvr-port5',
        hikChannel: '5001',
        name: 'Port5通道50',
        alias: 'P5-D50',
        enabled: true,
        sortOrder: 6,
        createdAt: now,
      },
      ...buildLprSeedChannels(now),
    ],
    displayLayout: { columns: 3, channelIds: ['d37', 'd57', 'd02', 'p3-d37', 'p3-d45', 'p3-d50'] },
    aiBoxEnabled: true,
    updatedAt: now,
  });
}

// ==================== 车牌/道闸相机视频墙（8 台）默认种子 ====================
// 与 LPR 设备 id 一一对应；通道 id 统一为 lpr{id}，供大屏「人车管理」页拉流与开关闸。
// 每台相机在视频绑定里登记为“一个 NvrDevice（直连 RTSP）+ 一个 Channel”。
export interface LprCameraSeed {
  id: number;
  nvrId: string;
  name: string;
  ip: string;
  rtspPort: number;
  rtspPath: string;
  brand: string;
  /** 该路转码输出宽（px），按视频墙实际窗宽逐路设定，见下方各型号说明。 */
  hlsWidth: number;
}

export const LPR_CAMERA_SEEDS: LprCameraSeed[] = [
  // XLT 为 16:9 源，视频窗在 3612×1462 设计画布下约 564×428（近 4:3，cover 会裁左右），
  // 按窗高 428 反推 16:9 需 ~768 宽才能铺满高度不虚，故取 768。
  {
    id: 1,
    nvrId: 'lpr-nvr-1',
    name: '北门入口',
    ip: '192.168.180.111',
    rtspPort: 554,
    rtspPath: 'h264ESVideoTest',
    brand: 'xlt',
    hlsWidth: 640,
  },
  {
    id: 2,
    nvrId: 'lpr-nvr-2',
    name: '北门出口',
    ip: '192.168.180.112',
    rtspPort: 554,
    rtspPath: 'h264ESVideoTest',
    brand: 'xlt',
    hlsWidth: 640,
  },
  // C5H 子码流为 704×576（4:3，D1），与近 4:3 的视频窗几乎 1:1，按窗宽 564 取 576（576×432），
  // 不再输出多余高度，最大限度降低拉流压力。
  {
    id: 3,
    nvrId: 'lpr-nvr-3',
    name: '西北门入口',
    ip: '192.168.180.101',
    rtspPort: 8557,
    rtspPath: 'sub_stream_1',
    brand: 'c5h',
    hlsWidth: 512,
  },
  {
    id: 4,
    nvrId: 'lpr-nvr-4',
    name: '西北门出口',
    ip: '192.168.180.103',
    rtspPort: 8557,
    rtspPath: 'sub_stream_1',
    brand: 'c5h',
    hlsWidth: 512,
  },
  {
    id: 5,
    nvrId: 'lpr-nvr-5',
    name: '东门入口',
    ip: '192.168.180.105',
    rtspPort: 8557,
    rtspPath: 'sub_stream_1',
    brand: 'c5h',
    hlsWidth: 512,
  },
  {
    id: 6,
    nvrId: 'lpr-nvr-6',
    name: '东门出口',
    ip: '192.168.180.106',
    rtspPort: 8557,
    rtspPath: 'sub_stream_1',
    brand: 'c5h',
    hlsWidth: 512,
  },
  {
    id: 7,
    nvrId: 'lpr-nvr-7',
    name: 'F区地下室入口',
    ip: '192.168.180.104',
    rtspPort: 8557,
    rtspPath: 'sub_stream_1',
    brand: 'c5h',
    hlsWidth: 512,
  },
  {
    id: 8,
    nvrId: 'lpr-nvr-8',
    name: 'F区地下室出口',
    ip: '192.168.180.102',
    rtspPort: 8557,
    rtspPath: 'sub_stream_1',
    brand: 'c5h',
    hlsWidth: 512,
  },
];

export const LPR_CAMERA_USERNAME = 'admin';
export const LPR_CAMERA_PASSWORD = 'admin';
/** 翻走后连续 15s 无人拉流即停转码。 */
export const LPR_IDLE_STOP_SECONDS = 15;
/** 兜底输出宽（种子逐路显式指定时以此为缺省）。 */
export const LPR_HLS_WIDTH = 512;

export function buildLprSeedNvrs(now: string): NvrDevice[] {
  return LPR_CAMERA_SEEDS.map((seed) => ({
    id: seed.nvrId,
    name: `${seed.name}车牌相机`,
    ip: seed.ip,
    port: 80,
    rtspPort: seed.rtspPort,
    username: LPR_CAMERA_USERNAME,
    password: LPR_CAMERA_PASSWORD,
    brand: seed.brand,
    enabled: true,
    createdAt: now,
    rtspUrl: `rtsp://${seed.ip}:${seed.rtspPort}/${seed.rtspPath}`,
    idleStopSeconds: LPR_IDLE_STOP_SECONDS,
    hlsWidth: seed.hlsWidth ?? LPR_HLS_WIDTH,
  }));
}

export function buildLprSeedChannels(now: string): CameraChannel[] {
  return LPR_CAMERA_SEEDS.map((seed) => ({
    id: `lpr${seed.id}`,
    nvrId: seed.nvrId,
    hikChannel: '0',
    name: seed.name,
    alias: seed.name,
    enabled: true,
    sortOrder: 100 + seed.id,
    createdAt: now,
    aiEnabled: false,
    countLine: undefined,
    roiPolygon: [],
  }));
}
