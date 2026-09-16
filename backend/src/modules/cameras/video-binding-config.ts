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
};

export const VIDEO_BINDING_CONFIG_KEY = 'video.binding';
export const VIDEO_BINDING_SCHEMA_VERSION = 1;
export const DEFAULT_AI_CAMERA_IDS = ['d37', 'd57', 'p3-d37'];
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
    ],
    displayLayout: { columns: 3, channelIds: ['d37', 'd57', 'd02', 'p3-d37', 'p3-d45', 'p3-d50'] },
    aiBoxEnabled: true,
    updatedAt: now,
  });
}
