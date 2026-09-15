import { Injectable, OnModuleInit } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

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

/** 归一化坐标点（0~1，与画面分辨率无关，便于拖拽编辑器与 AI 端共用） */
export interface NormPoint {
  x: number;
  y: number;
}

/** 单路 AI 分析配置：是否分析、越线计数线（2 点）、检测区域多边形 ROI（区域外不检测） */
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
  // —— AI 分析相关（可选，老配置缺失时由 migrateConfig 补默认）——
  /** 该路是否送入 AI 分析/计数 */
  aiEnabled?: boolean;
  /** 越线计数线，恰 2 个归一化点；缺省为画面垂直中线 */
  countLine?: NormPoint[];
  /** 检测区域多边形顶点（归一化）；为空表示全画面检测，>=3 点时区域外目标不检测不输出 */
  roiPolygon?: NormPoint[];
}

export interface VideoBindingConfig {
  nvrs: NvrDevice[];
  channels: CameraChannel[];
  displayLayout: {
    columns: number;
    channelIds: string[];
  };
  /** 全局：运营大屏/投影/手机是否叠加 AI 检测框与计数线（后台统一开关，默认开） */
  aiBoxEnabled?: boolean;
  updatedAt: string;
}

/** 默认接入 AI 分析的三路大门，以及它们的默认垂直计数线（与 AI 服务内置默认保持一致） */
const DEFAULT_AI_CAMERA_IDS = ['d37', 'd57', 'p3-d37'];
const DEFAULT_COUNT_LINE: NormPoint[] = [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }];
const MAX_ROI_POINTS = 16;

@Injectable()
export class VideoBindingService implements OnModuleInit {
  private configPath: string;
  private config!: VideoBindingConfig;

  constructor() {
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.configPath = join(dataDir, 'video-binding.json');
  }

  onModuleInit() {
    this.loadConfig();
  }

  private loadConfig() {
    if (existsSync(this.configPath)) {
      try {
        const raw = readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(raw);
        this.migrateConfig();
        return;
      } catch (e: any) {
        console.warn('[VideoBinding] Failed to load config, using defaults:', e?.message || e);
      }
    }
    // 默认配置
    this.config = {
      nvrs: [
        {
          id: 'nvr-port5',
          name: '消防控制室Port5录像机',
          ip: '192.168.1.5',
          port: 80,
          rtspPort: 554,
          username: 'admin',
          password: 'jh666888',
          brand: 'hikvision',
          enabled: true,
          createdAt: new Date().toISOString(),
        },
        {
          id: 'nvr-port3',
          name: '消防控制室Port3录像机',
          ip: '192.168.1.19',
          port: 80,
          rtspPort: 554,
          username: 'admin',
          password: 'Jh666888',
          brand: 'hikvision',
          enabled: true,
          createdAt: new Date().toISOString(),
        },
      ],
      channels: [
        { id: 'd37', nvrId: 'nvr-port5', hikChannel: '3701', name: '大门', alias: 'D37大门', enabled: true, sortOrder: 1, createdAt: new Date().toISOString() },
        { id: 'd57', nvrId: 'nvr-port5', hikChannel: '5701', name: '通道57', alias: 'D57通道57', enabled: true, sortOrder: 2, createdAt: new Date().toISOString() },
        { id: 'd02', nvrId: 'nvr-port5', hikChannel: '201', name: '通道2', alias: 'D02通道2', enabled: true, sortOrder: 3, createdAt: new Date().toISOString() },
        { id: 'p3-d37', nvrId: 'nvr-port3', hikChannel: '3701', name: 'Port3通道37', alias: 'P3-D37', enabled: true, sortOrder: 4, createdAt: new Date().toISOString() },
        { id: 'p3-d45', nvrId: 'nvr-port5', hikChannel: '4501', name: 'Port5通道45', alias: 'P5-D45', enabled: true, sortOrder: 5, createdAt: new Date().toISOString() },
        { id: 'p3-d50', nvrId: 'nvr-port5', hikChannel: '5001', name: 'Port5通道50', alias: 'P5-D50', enabled: true, sortOrder: 6, createdAt: new Date().toISOString() },
      ],
      displayLayout: {
        columns: 3,
        channelIds: ['d37', 'd57', 'd02', 'p3-d37', 'p3-d45', 'p3-d50'],
      },
      aiBoxEnabled: true,
      updatedAt: new Date().toISOString(),
    };
    this.migrateConfig();
    this.saveConfig();
  }

  private saveConfig() {
    this.config.updatedAt = new Date().toISOString();
    writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  getConfig(): VideoBindingConfig {
    return this.config;
  }

  // NVR CRUD
  getNvrs(): NvrDevice[] {
    return this.config.nvrs;
  }

  createNvr(data: Omit<NvrDevice, 'id' | 'createdAt'>): NvrDevice {
    const nvr: NvrDevice = {
      ...data,
      id: `nvr-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    this.config.nvrs.push(nvr);
    this.saveConfig();
    return nvr;
  }

  updateNvr(id: string, data: Partial<NvrDevice>): NvrDevice | null {
    const idx = this.config.nvrs.findIndex(n => n.id === id);
    if (idx === -1) return null;
    this.config.nvrs[idx] = { ...this.config.nvrs[idx], ...data };
    this.saveConfig();
    return this.config.nvrs[idx];
  }

  deleteNvr(id: string): boolean {
    const idx = this.config.nvrs.findIndex(n => n.id === id);
    if (idx === -1) return false;
    this.config.nvrs.splice(idx, 1);
    // 同时删除关联的通道
    this.config.channels = this.config.channels.filter(c => c.nvrId !== id);
    this.config.displayLayout.channelIds = this.config.displayLayout.channelIds.filter(cid =>
      this.config.channels.some(c => c.id === cid)
    );
    this.saveConfig();
    return true;
  }

  // Channel CRUD
  getChannels(): CameraChannel[] {
    return [...this.config.channels].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  createChannel(data: Omit<CameraChannel, 'id' | 'createdAt'>): CameraChannel {
    const channel: CameraChannel = {
      ...data,
      id: data.alias || `ch-${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    this.config.channels.push(channel);
    this.saveConfig();
    return channel;
  }

  updateChannel(id: string, data: Partial<CameraChannel>): CameraChannel | null {
    const idx = this.config.channels.findIndex(c => c.id === id);
    if (idx === -1) return null;
    this.config.channels[idx] = { ...this.config.channels[idx], ...data };
    this.saveConfig();
    return this.config.channels[idx];
  }

  deleteChannel(id: string): boolean {
    const idx = this.config.channels.findIndex(c => c.id === id);
    if (idx === -1) return false;
    this.config.channels.splice(idx, 1);
    this.config.displayLayout.channelIds = this.config.displayLayout.channelIds.filter(cid => cid !== id);
    this.saveConfig();
    return true;
  }

  // Display layout
  updateDisplayLayout(layout: { columns?: number; channelIds?: string[] }): VideoBindingConfig['displayLayout'] {
    if (layout.columns !== undefined) {
      this.config.displayLayout.columns = layout.columns;
    }
    if (layout.channelIds !== undefined) {
      this.config.displayLayout.channelIds = layout.channelIds;
    }
    this.saveConfig();
    return this.config.displayLayout;
  }

  // ========== AI 检测范围 / 全局框开关 ==========
  /** 老配置补齐新字段（不覆盖已存在的值），坐标统一钳制到 0~1 */
  private migrateConfig(): void {
    if (this.config.aiBoxEnabled === undefined) this.config.aiBoxEnabled = true;
    if (!Array.isArray(this.config.channels)) this.config.channels = [];
    for (const ch of this.config.channels) {
      const isDefaultAi = DEFAULT_AI_CAMERA_IDS.includes(ch.id);
      if (ch.aiEnabled === undefined) ch.aiEnabled = isDefaultAi;
      if (!Array.isArray(ch.countLine) || ch.countLine.length !== 2) {
        ch.countLine = isDefaultAi ? DEFAULT_COUNT_LINE.map(p => ({ ...p })) : undefined;
      } else {
        ch.countLine = ch.countLine.map(p => this.clampPoint(p));
      }
      if (Array.isArray(ch.roiPolygon) && ch.roiPolygon.length) {
        ch.roiPolygon = ch.roiPolygon.slice(0, MAX_ROI_POINTS).map(p => this.clampPoint(p));
      } else {
        ch.roiPolygon = [];
      }
    }
  }

  private clampPoint(p: any): NormPoint {
    const num = (v: any) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 0;
      return Math.min(1, Math.max(0, n));
    };
    return { x: num(p?.x), y: num(p?.y) };
  }

  getAiBoxEnabled(): boolean {
    // 缺省视为开（只有显式 false 才关）
    return this.config.aiBoxEnabled !== false;
  }

  setAiBoxEnabled(enabled: boolean): boolean {
    this.config.aiBoxEnabled = !!enabled;
    this.saveConfig();
    return this.config.aiBoxEnabled;
  }

  /** 保存单路 AI 配置（是否分析 / 计数线 / ROI 区域） */
  updateChannelAi(id: string, patch: ChannelAiConfig): CameraChannel | null {
    const idx = this.config.channels.findIndex(c => c.id === id);
    if (idx === -1) return null;
    const next: Partial<CameraChannel> = {};
    if (patch.aiEnabled !== undefined) next.aiEnabled = !!patch.aiEnabled;
    if (patch.countLine !== undefined) {
      next.countLine =
        Array.isArray(patch.countLine) && patch.countLine.length === 2
          ? patch.countLine.map(p => this.clampPoint(p))
          : DEFAULT_COUNT_LINE.map(p => ({ ...p }));
    }
    if (patch.roiPolygon !== undefined) {
      const poly = Array.isArray(patch.roiPolygon) ? patch.roiPolygon : [];
      next.roiPolygon = poly.length >= 3 ? poly.slice(0, MAX_ROI_POINTS).map(p => this.clampPoint(p)) : [];
    }
    this.config.channels[idx] = { ...this.config.channels[idx], ...next };
    this.saveConfig();
    return this.config.channels[idx];
  }

  /** 组装下发给 AI Python（POST /api/config）的载荷，坐标为数组形式 */
  buildAiPayload(): {
    cameras: Record<
      string,
      { enabled: boolean; count_line: [[number, number], [number, number]] | null; roi_polygon: [number, number][] }
    >;
  } {
    const cameras: Record<string, any> = {};
    for (const ch of this.config.channels) {
      const line = Array.isArray(ch.countLine) && ch.countLine.length === 2 ? ch.countLine : null;
      cameras[ch.id] = {
        enabled: !!ch.aiEnabled,
        count_line: line ? [[line[0].x, line[0].y], [line[1].x, line[1].y]] : null,
        roi_polygon: Array.isArray(ch.roiPolygon) ? ch.roiPolygon.map(p => [p.x, p.y] as [number, number]) : [],
      };
    }
    return { cameras };
  }

  /** 大屏匿名只读：全局框开关 + 每路计数线/ROI（不含任何凭据） */
  getOverlayConfig() {
    const cameras: Record<
      string,
      { aiEnabled: boolean; countLine: NormPoint[] | null; roiPolygon: NormPoint[] }
    > = {};
    for (const ch of this.config.channels) {
      cameras[ch.id] = {
        aiEnabled: !!ch.aiEnabled,
        countLine: Array.isArray(ch.countLine) && ch.countLine.length === 2 ? ch.countLine : null,
        roiPolygon: Array.isArray(ch.roiPolygon) ? ch.roiPolygon : [],
      };
    }
    return { aiBoxEnabled: this.getAiBoxEnabled(), cameras };
  }

  // 获取用于运营大屏的视频配置
  getDisplayChannels(): Array<{ id: string; name: string; alias: string; nvrId: string; hikChannel: string }> {
    return this.config.displayLayout.channelIds
      .map(cid => this.config.channels.find(c => c.id === cid && c.enabled))
      .filter((c): c is CameraChannel => c !== undefined)
      .map(c => ({
        id: c.id,
        name: c.name,
        alias: c.alias,
        nvrId: c.nvrId,
        hikChannel: c.hikChannel,
      }));
  }

  // 测试NVR连接
  async testNvrConnection(id: string): Promise<{ success: boolean; message: string }> {
    const nvr = this.config.nvrs.find(n => n.id === id);
    if (!nvr) {
      return { success: false, message: 'NVR设备不存在' };
    }
    try {
      const url = `http://${nvr.ip}:${nvr.port}/ISAPI/System/deviceInfo`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${nvr.username}:${nvr.password}`).toString('base64'),
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status === 200) {
        return { success: true, message: '连接成功' };
      } else if (response.status === 401) {
        return { success: false, message: '认证失败，请检查用户名密码' };
      } else {
        return { success: false, message: `连接失败，HTTP状态码: ${response.status}` };
      }
    } catch (e: any) {
      return { success: false, message: `连接异常: ${e?.message || String(e)}` };
    }
  }
}
