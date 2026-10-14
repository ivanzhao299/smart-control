import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import {
  buildLprSeedChannels,
  buildLprSeedNvrs,
  CameraChannel,
  ChannelAiConfig,
  clampVideoPoint,
  MAX_ROI_POINTS,
  NormPoint,
  normalizeVideoBindingConfig,
  NvrDevice,
  NvrDeviceView,
  VideoBindingConfig,
  VideoBindingConfigView,
  VIDEO_BINDING_CONFIG_KEY,
  VIDEO_BINDING_SCHEMA_VERSION,
} from './video-binding-config';

export {
  CameraChannel,
  ChannelAiConfig,
  NormPoint,
  NvrDevice,
  NvrDeviceView,
  VideoBindingConfig,
  VideoBindingConfigView,
} from './video-binding-config';

interface Mutation<T> {
  changed: boolean;
  select: (config: VideoBindingConfig) => T;
}

export interface VideoBindingWriteContext {
  expectedRevision?: number;
  actor?: string;
}

export interface CameraStreamBinding {
  id: string;
  name: string;
  alias: string;
  hikChannel: string;
  nvr: Pick<
    NvrDevice,
    | 'id'
    | 'name'
    | 'ip'
    | 'port'
    | 'rtspPort'
    | 'username'
    | 'password'
    | 'rtspUrl'
    | 'idleStopSeconds'
    | 'hlsWidth'
  >;
}

const LEGACY_CHANNEL_ALIASES: Readonly<Record<string, string>> = {
  '37': 'd37',
  'p5-d37': 'd37',
  '1': 'd01',
  'p5-d01': 'd01',
  '2': 'd02',
  'p5-d02': 'd02',
  '10': 'd10',
  'p5-d10': 'd10',
  '57': 'd57',
  'p5-d57': 'd57',
  'p5-d45': 'p3-d45',
  'p5-d50': 'p3-d50',
};

@Injectable()
export class VideoBindingService implements OnModuleInit {
  private config!: VideoBindingConfig;
  private configRevision = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: RuntimeConfigStore) {}

  async onModuleInit(): Promise<void> {
    const current = await this.store.read(VIDEO_BINDING_CONFIG_KEY, normalizeVideoBindingConfig);
    if (!current) {
      throw new Error(
        `VIDEO_BINDING_CONFIG_MISSING: run database migrations before starting the application`,
      );
    }
    this.config = current.value;
    this.configRevision = current.revision;
    console.info(`[VideoBinding] Loaded ${VIDEO_BINDING_CONFIG_KEY} revision ${current.revision}`);
    // 8 台 LPR 种子合并只在真实运行时执行；NODE_ENV=test 时跳过，避免污染单元测试的
    // 纯净 fixture；也可用 SKIP_LPR_SEED=true 显式关闭。
    if (process.env.NODE_ENV !== 'test' && process.env.SKIP_LPR_SEED !== 'true') {
      await this.ensureLprSeedBindings();
    }
  }

  /**
   * 幂等合并 8 台车牌/道闸相机种子（首次部署 / 升级到含视频墙的版本时自动登记）。
   * 只追加缺失项，不覆盖现场已存在或已修改的配置，也不影响海康 NVR。
   * 现场若要停用某台，请把该通道/设备置为 enabled=false（按 id 删除会在下次启动被种子补回）。
   */
  private ensureLprSeedBindings(now = new Date().toISOString()): Promise<void> {
    return this.mutate('onModuleInit lpr camera seed', (draft) => {
      const existingNvrIds = new Set(draft.nvrs.map((n) => n.id));
      const existingChannelIds = new Set(draft.channels.map((c) => c.id));
      const seedNvrList = buildLprSeedNvrs(now);
      const seedNvrs = seedNvrList.filter((n) => !existingNvrIds.has(n.id));
      const seedChannels = buildLprSeedChannels(now).filter((c) => !existingChannelIds.has(c.id));
      // 已存在的车牌种子 NVR：幂等同步“代码管辖的派生参数”（空闲停止秒数/输出宽），
      // 不覆盖现场可能修改的 RTSP 地址、账号口令、启用状态（这些仍以现场配置为准）。
      let synced = 0;
      for (const n of draft.nvrs) {
        const seed = seedNvrList.find((s) => s.id === n.id);
        if (!seed) continue;
        if (n.idleStopSeconds !== seed.idleStopSeconds || n.hlsWidth !== seed.hlsWidth) {
          n.idleStopSeconds = seed.idleStopSeconds;
          n.hlsWidth = seed.hlsWidth;
          synced += 1;
        }
      }
      if (!seedNvrs.length && !seedChannels.length && synced === 0) {
        return { changed: false, select: () => undefined };
      }
      draft.nvrs.push(...seedNvrs);
      draft.channels.push(...seedChannels);
      console.info(
        `[VideoBinding] 车牌相机种子合并: +${seedNvrs.length} NVR, +${seedChannels.length} channel, 同步派生参数 ${synced} 台`,
      );
      return { changed: true, select: () => undefined };
    });
  }

  private cloneConfig(config = this.config): VideoBindingConfig {
    return structuredClone(config);
  }

  private mutate<T>(
    source: string,
    apply: (draft: VideoBindingConfig) => Mutation<T>,
    context: VideoBindingWriteContext = {},
  ): Promise<T> {
    const operation = this.mutationQueue.then(async () => {
      const { expectedRevision } = context;
      if (expectedRevision !== undefined && expectedRevision !== this.configRevision) {
        throw new ConflictException({
          code: 'VIDEO_BINDING_REVISION_CONFLICT',
          message: '视频绑定配置已被其他操作更新，请刷新后确认再保存',
          expectedRevision,
          currentRevision: this.configRevision,
        });
      }
      const draft = this.cloneConfig();
      const mutation = apply(draft);
      if (!mutation.changed) return mutation.select(this.config);
      if (JSON.stringify(draft) === JSON.stringify(this.config)) {
        return mutation.select(this.config);
      }

      draft.updatedAt = new Date().toISOString();
      try {
        const saved = await this.store.update({
          key: VIDEO_BINDING_CONFIG_KEY,
          schemaVersion: VIDEO_BINDING_SCHEMA_VERSION,
          expectedRevision: this.configRevision,
          value: draft,
          normalize: normalizeVideoBindingConfig,
          actor: context.actor ?? 'admin-api',
          source,
        });
        this.config = saved.value;
        this.configRevision = saved.revision;
        return mutation.select(this.config);
      } catch (error) {
        if (error instanceof ConflictException) {
          const latest = await this.store.read(
            VIDEO_BINDING_CONFIG_KEY,
            normalizeVideoBindingConfig,
          );
          if (latest) {
            this.config = latest.value;
            this.configRevision = latest.revision;
          }
        }
        throw error;
      }
    });
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  getConfig(): VideoBindingConfig {
    return this.cloneConfig();
  }

  getConfigView(): VideoBindingConfigView {
    return {
      nvrs: this.getNvrs(),
      channels: this.getChannels(),
      displayLayout: {
        columns: this.config.displayLayout.columns,
        channelIds: [...this.config.displayLayout.channelIds],
      },
      aiBoxEnabled: this.config.aiBoxEnabled,
      updatedAt: this.config.updatedAt,
      revision: this.configRevision,
    };
  }

  private toNvrView(nvr: NvrDevice): NvrDeviceView {
    const { password, ...view } = nvr;
    return { ...view, hasPassword: password.length > 0 };
  }

  getNvrs(): NvrDeviceView[] {
    return this.config.nvrs.map((nvr) => this.toNvrView(nvr));
  }

  private badRequest(code: string, message: string): never {
    throw new BadRequestException({ code, message });
  }

  private notFound(code: string, message: string): never {
    throw new NotFoundException({ code, message });
  }

  createNvr(
    data: Omit<NvrDevice, 'id' | 'createdAt'>,
    context: VideoBindingWriteContext = {},
  ): Promise<NvrDeviceView> {
    if (!data.password)
      this.badRequest('VIDEO_BINDING_NVR_PASSWORD_REQUIRED', '新建NVR设备必须设置密码');
    const id = `nvr-${randomUUID()}`;
    return this.mutate(
      'POST /api/video-binding/nvrs',
      (draft) => {
        draft.nvrs.push({ ...data, id, createdAt: new Date().toISOString() });
        return {
          changed: true,
          select: (config) => this.toNvrView(config.nvrs.find((nvr) => nvr.id === id)!),
        };
      },
      context,
    );
  }

  updateNvr(
    id: string,
    data: Partial<Omit<NvrDevice, 'id' | 'createdAt'>>,
    context: VideoBindingWriteContext = {},
  ): Promise<NvrDeviceView> {
    return this.mutate(
      `PUT /api/video-binding/nvrs/${id}`,
      (draft) => {
        const index = draft.nvrs.findIndex((nvr) => nvr.id === id);
        if (index === -1) this.notFound('VIDEO_BINDING_NVR_NOT_FOUND', 'NVR设备不存在');
        const next = { ...draft.nvrs[index] };
        for (const field of [
          'name',
          'ip',
          'port',
          'rtspPort',
          'username',
          'brand',
          'enabled',
          'rtspUrl',
          'idleStopSeconds',
          'hlsWidth',
        ] as const) {
          const value = data[field];
          if (value !== undefined) (next[field] as typeof value) = value;
        }
        if (typeof data.password === 'string' && data.password.length > 0)
          next.password = data.password;
        draft.nvrs[index] = next;
        return {
          changed: true,
          select: (config) => this.toNvrView(config.nvrs.find((nvr) => nvr.id === id)!),
        };
      },
      context,
    );
  }

  deleteNvr(id: string, context: VideoBindingWriteContext = {}): Promise<boolean> {
    return this.mutate(
      `DELETE /api/video-binding/nvrs/${id}`,
      (draft) => {
        const index = draft.nvrs.findIndex((nvr) => nvr.id === id);
        if (index === -1) this.notFound('VIDEO_BINDING_NVR_NOT_FOUND', 'NVR设备不存在');
        draft.nvrs.splice(index, 1);
        draft.channels = draft.channels.filter((channel) => channel.nvrId !== id);
        const channelIds = new Set(draft.channels.map((channel) => channel.id));
        draft.displayLayout.channelIds = draft.displayLayout.channelIds.filter((channelId) =>
          channelIds.has(channelId),
        );
        return { changed: true, select: () => true };
      },
      context,
    );
  }

  getChannels(): CameraChannel[] {
    return this.config.channels
      .map((channel) => structuredClone(channel))
      .sort((left, right) => left.sortOrder - right.sortOrder);
  }

  createChannel(
    data: Omit<CameraChannel, 'id' | 'createdAt'>,
    context: VideoBindingWriteContext = {},
  ): Promise<CameraChannel> {
    const id = data.alias || `ch-${randomUUID()}`;
    return this.mutate(
      'POST /api/video-binding/channels',
      (draft) => {
        if (!draft.nvrs.some((nvr) => nvr.id === data.nvrId)) {
          this.badRequest('VIDEO_BINDING_NVR_NOT_FOUND', '关联的NVR设备不存在');
        }
        if (draft.channels.some((channel) => channel.id === id)) {
          this.badRequest('VIDEO_BINDING_CHANNEL_DUPLICATE', '摄像头通道标识已存在');
        }
        draft.channels.push({ ...data, id, createdAt: new Date().toISOString() });
        return {
          changed: true,
          select: (config) =>
            structuredClone(config.channels.find((channel) => channel.id === id)!),
        };
      },
      context,
    );
  }

  updateChannel(
    id: string,
    data: Partial<CameraChannel>,
    context: VideoBindingWriteContext = {},
  ): Promise<CameraChannel> {
    return this.mutate(
      `PUT /api/video-binding/channels/${id}`,
      (draft) => {
        const index = draft.channels.findIndex((channel) => channel.id === id);
        if (index === -1) this.notFound('VIDEO_BINDING_CHANNEL_NOT_FOUND', '摄像头通道不存在');
        const next = { ...draft.channels[index] };
        for (const field of [
          'nvrId',
          'hikChannel',
          'name',
          'alias',
          'enabled',
          'sortOrder',
        ] as const) {
          const value = data[field];
          if (value !== undefined) (next[field] as typeof value) = value;
        }
        if (!draft.nvrs.some((nvr) => nvr.id === next.nvrId)) {
          this.badRequest('VIDEO_BINDING_NVR_NOT_FOUND', '关联的NVR设备不存在');
        }
        draft.channels[index] = next;
        return {
          changed: true,
          select: (config) =>
            structuredClone(config.channels.find((channel) => channel.id === id)!),
        };
      },
      context,
    );
  }

  deleteChannel(id: string, context: VideoBindingWriteContext = {}): Promise<boolean> {
    return this.mutate(
      `DELETE /api/video-binding/channels/${id}`,
      (draft) => {
        const index = draft.channels.findIndex((channel) => channel.id === id);
        if (index === -1) this.notFound('VIDEO_BINDING_CHANNEL_NOT_FOUND', '摄像头通道不存在');
        draft.channels.splice(index, 1);
        draft.displayLayout.channelIds = draft.displayLayout.channelIds.filter(
          (channelId) => channelId !== id,
        );
        return { changed: true, select: () => true };
      },
      context,
    );
  }

  updateDisplayLayout(
    layout: {
      columns?: number;
      channelIds?: string[];
    },
    context: VideoBindingWriteContext = {},
  ): Promise<VideoBindingConfig['displayLayout']> {
    return this.mutate(
      'PUT /api/video-binding/layout',
      (draft) => {
        if (layout.columns !== undefined) draft.displayLayout.columns = layout.columns;
        if (layout.channelIds !== undefined) {
          const known = new Set(draft.channels.map((channel) => channel.id));
          if (layout.channelIds.some((channelId) => !known.has(channelId))) {
            this.badRequest(
              'VIDEO_BINDING_LAYOUT_UNKNOWN_CHANNEL',
              '显示布局包含不存在的摄像头通道',
            );
          }
          draft.displayLayout.channelIds = [...new Set(layout.channelIds)];
        }
        return {
          changed: true,
          select: (config) => structuredClone(config.displayLayout),
        };
      },
      context,
    );
  }

  getAiBoxEnabled(): boolean {
    return this.config.aiBoxEnabled !== false;
  }

  setAiBoxEnabled(enabled: boolean, context: VideoBindingWriteContext = {}): Promise<boolean> {
    return this.mutate(
      'PUT /api/video-binding/ai/box',
      (draft) => {
        draft.aiBoxEnabled = !!enabled;
        return { changed: true, select: (config) => config.aiBoxEnabled !== false };
      },
      context,
    );
  }

  updateChannelAi(
    id: string,
    patch: ChannelAiConfig,
    context: VideoBindingWriteContext = {},
  ): Promise<CameraChannel> {
    return this.mutate(
      `PUT /api/video-binding/channels/${id}/ai`,
      (draft) => {
        const index = draft.channels.findIndex((channel) => channel.id === id);
        if (index === -1) this.notFound('VIDEO_BINDING_CHANNEL_NOT_FOUND', '摄像头通道不存在');
        const next = { ...draft.channels[index] };
        if (patch.aiEnabled !== undefined) next.aiEnabled = !!patch.aiEnabled;
        if (patch.countLine !== undefined) {
          next.countLine =
            Array.isArray(patch.countLine) && patch.countLine.length === 2
              ? patch.countLine.map(clampVideoPoint)
              : undefined;
        }
        if (patch.roiPolygon !== undefined) {
          const polygon = Array.isArray(patch.roiPolygon) ? patch.roiPolygon : [];
          next.roiPolygon =
            polygon.length >= 3 ? polygon.slice(0, MAX_ROI_POINTS).map(clampVideoPoint) : [];
        }
        draft.channels[index] = next;
        return {
          changed: true,
          select: (config) =>
            structuredClone(config.channels.find((channel) => channel.id === id)!),
        };
      },
      context,
    );
  }

  buildAiPayload(): {
    cameras: Record<
      string,
      {
        enabled: boolean;
        count_line: [[number, number], [number, number]] | null;
        roi_polygon: [number, number][];
      }
    >;
  } {
    const cameras: Record<
      string,
      {
        enabled: boolean;
        count_line: [[number, number], [number, number]] | null;
        roi_polygon: [number, number][];
      }
    > = {};
    for (const channel of this.config.channels) {
      const line =
        Array.isArray(channel.countLine) && channel.countLine.length === 2
          ? channel.countLine
          : null;
      cameras[channel.id] = {
        enabled: !!channel.aiEnabled,
        count_line: line
          ? [
              [line[0].x, line[0].y],
              [line[1].x, line[1].y],
            ]
          : null,
        roi_polygon: Array.isArray(channel.roiPolygon)
          ? channel.roiPolygon.map((point) => [point.x, point.y])
          : [],
      };
    }
    return { cameras };
  }

  getOverlayConfig(): {
    aiBoxEnabled: boolean;
    cameras: Record<
      string,
      { aiEnabled: boolean; countLine: NormPoint[] | null; roiPolygon: NormPoint[] }
    >;
  } {
    const cameras: Record<
      string,
      { aiEnabled: boolean; countLine: NormPoint[] | null; roiPolygon: NormPoint[] }
    > = {};
    for (const channel of this.config.channels) {
      cameras[channel.id] = {
        aiEnabled: !!channel.aiEnabled,
        countLine:
          Array.isArray(channel.countLine) && channel.countLine.length === 2
            ? channel.countLine.map((point) => ({ ...point }))
            : null,
        roiPolygon: Array.isArray(channel.roiPolygon)
          ? channel.roiPolygon.map((point) => ({ ...point }))
          : [],
      };
    }
    return { aiBoxEnabled: this.getAiBoxEnabled(), cameras };
  }

  getDisplayChannels(): Array<{
    id: string;
    name: string;
    alias: string;
    nvrId: string;
    hikChannel: string;
  }> {
    return this.config.displayLayout.channelIds
      .map((channelId) =>
        this.config.channels.find((channel) => channel.id === channelId && channel.enabled),
      )
      .filter((channel): channel is CameraChannel => channel !== undefined)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        alias: channel.alias,
        nvrId: channel.nvrId,
        hikChannel: channel.hikChannel,
      }));
  }

  /** Internal stream resolver. Credentials never leave the backend service boundary. */
  resolveStreamBinding(requestedId: string): CameraStreamBinding | null {
    const key = requestedId.trim().toLowerCase();
    const canonicalId = LEGACY_CHANNEL_ALIASES[key] ?? key;
    const channel = this.config.channels.find(
      (candidate) => candidate.id.toLowerCase() === canonicalId && candidate.enabled,
    );
    if (!channel) return null;
    const nvr = this.config.nvrs.find(
      (candidate) => candidate.id === channel.nvrId && candidate.enabled,
    );
    if (!nvr) return null;
    return {
      id: channel.id,
      name: channel.name,
      alias: channel.alias,
      hikChannel: channel.hikChannel,
      nvr: {
        id: nvr.id,
        name: nvr.name,
        ip: nvr.ip,
        port: nvr.port,
        rtspPort: nvr.rtspPort,
        username: nvr.username,
        password: nvr.password,
        rtspUrl: nvr.rtspUrl,
        idleStopSeconds: nvr.idleStopSeconds,
        hlsWidth: nvr.hlsWidth,
      },
    };
  }

  getStreamChannelViews(): Array<{
    channel: string;
    name: string;
    nvr: string;
    hikChannel: string;
  }> {
    return this.config.channels
      .filter((channel) => channel.enabled)
      .flatMap((channel) => {
        const nvr = this.config.nvrs.find(
          (candidate) => candidate.id === channel.nvrId && candidate.enabled,
        );
        return nvr
          ? [
              {
                channel: channel.id,
                name: channel.name,
                nvr: nvr.name,
                hikChannel: channel.hikChannel,
              },
            ]
          : [];
      });
  }

  async testNvrConnection(id: string): Promise<{ success: boolean; message: string }> {
    const nvr = this.config.nvrs.find((device) => device.id === id);
    if (!nvr) return { success: false, message: 'NVR设备不存在' };
    try {
      const url = `http://${nvr.ip}:${nvr.port}/ISAPI/System/deviceInfo`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Basic ${Buffer.from(`${nvr.username}:${nvr.password}`).toString('base64')}`,
          },
          signal: controller.signal,
        });
        if (response.status === 200) return { success: true, message: '连接成功' };
        if (response.status === 401)
          return { success: false, message: '认证失败，请检查用户名密码' };
        return { success: false, message: `连接失败，HTTP状态码: ${response.status}` };
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: `连接异常: ${message}` };
    }
  }
}
