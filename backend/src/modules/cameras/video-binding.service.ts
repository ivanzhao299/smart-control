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

export interface CameraChannel {
  id: string;
  nvrId: string;
  hikChannel: string;
  name: string;
  alias: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface VideoBindingConfig {
  nvrs: NvrDevice[];
  channels: CameraChannel[];
  displayLayout: {
    columns: number;
    channelIds: string[];
  };
  updatedAt: string;
}

@Injectable()
export class VideoBindingService implements OnModuleInit {
  private configPath: string;
  private config: VideoBindingConfig;

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
        return;
      } catch (e) {
        console.warn('[VideoBinding] Failed to load config, using defaults:', e.message);
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
      updatedAt: new Date().toISOString(),
    };
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

  // 获取用于运营大屏的视频配置
  getDisplayChannels(): Array<{ id: string; name: string; alias: string; nvrId: string; hikChannel: string }> {
    return this.config.displayLayout.channelIds
      .map(cid => this.config.channels.find(c => c.id === cid && c.enabled))
      .filter(Boolean)
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
