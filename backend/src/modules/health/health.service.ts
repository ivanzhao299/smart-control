import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as os from 'os';
import { statfsSync } from 'fs';
import { Device } from '../../entities/device.entity';
import { DeviceStatusService } from '../../services/device-status.service';
import { AdapterConnectionRegistry } from '../../adapters/connection-registry';

export interface ResourceSnapshot {
  cpuUsagePercent: number;
  cpuLoadAvg1m: number;
  memoryUsagePercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
  diskUsagePercent: number;
  diskUsedGb: number;
  diskTotalGb: number;
  uptimeSec: number;
  nodeUptimeSec: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  apiStatus: 'up' | 'down';
  databaseStatus: 'up' | 'down';
  websocketStatus: 'up' | 'down';
  schedulerStatus: 'up' | 'down';
  deviceOnlineCount: number;
  deviceOfflineCount: number;
  /** Sprint-04 spec Task-017: 正在重连中的网关数 */
  reconnectingCount: number;
  uptime: number;
  memoryUsagePercent: number;
  cpuUsagePercent: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();
  /** ws/scheduler 状态由外部模块上报, 此处只读 */
  private wsUp = true;
  private schedulerUp = true;
  private lastCpuSample: { idle: number; total: number } | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    private readonly deviceStatus: DeviceStatusService,
    private readonly registry: AdapterConnectionRegistry,
  ) {}

  setWebsocketStatus(up: boolean): void {
    this.wsUp = up;
  }

  setSchedulerStatus(up: boolean): void {
    this.schedulerUp = up;
  }

  async report(): Promise<HealthReport> {
    const [db, dev, res] = await Promise.all([
      this.checkDatabase(),
      this.countDevices(),
      Promise.resolve(this.resources()),
    ]);
    // ⚠️ 恒为 'up' —— 这是个自指的假字段: 这份报告本身就是 API 返回的, 调用方能拿到它
    // 就说明 API 活着, 所以它永远不可能是 'down'。**别拿它当健康判据**:
    // CI 的云端健康门曾经判 apiStatus=='up', 等于恒真条件, DB 挂了照样判部署成功
    // (2026-07-19 已改判下面算出来的 status)。后台监控面板同理, 那个灯永远绿。
    // 字段保留只为不破坏既有响应契约; 有诊断价值的是 status / databaseStatus 这些。
    const apiStatus: 'up' | 'down' = 'up';
    const status: HealthReport['status'] =
      db === 'down' ? 'down' : (this.wsUp && this.schedulerUp ? 'ok' : 'degraded');
    const reconnectingCount = this.registry
      .list()
      .filter((g) => g.state === 'reconnecting').length;
    return {
      status,
      apiStatus,
      databaseStatus: db,
      websocketStatus: this.wsUp ? 'up' : 'down',
      schedulerStatus: this.schedulerUp ? 'up' : 'down',
      deviceOnlineCount: dev.online,
      deviceOfflineCount: dev.offline,
      reconnectingCount,
      uptime: res.nodeUptimeSec,
      memoryUsagePercent: res.memoryUsagePercent,
      cpuUsagePercent: res.cpuUsagePercent,
      timestamp: new Date().toISOString(),
    };
  }

  resources(): ResourceSnapshot {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const c of cpus) {
      for (const k of Object.keys(c.times) as Array<keyof typeof c.times>) {
        total += c.times[k];
      }
      idle += c.times.idle;
    }
    let cpuPercent = 0;
    if (this.lastCpuSample) {
      const dIdle = idle - this.lastCpuSample.idle;
      const dTotal = total - this.lastCpuSample.total;
      cpuPercent = dTotal > 0 ? Math.max(0, Math.min(100, ((dTotal - dIdle) / dTotal) * 100)) : 0;
    }
    this.lastCpuSample = { idle, total };

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryUsagePercent = Math.round((usedMem / totalMem) * 1000) / 10;

    const disk = this.readDisk();

    return {
      cpuUsagePercent: Math.round(cpuPercent * 10) / 10,
      cpuLoadAvg1m: Math.round(os.loadavg()[0] * 100) / 100,
      memoryUsagePercent,
      memoryUsedMb: Math.round(usedMem / 1024 / 1024),
      memoryTotalMb: Math.round(totalMem / 1024 / 1024),
      diskUsagePercent: disk.usagePercent,
      diskUsedGb: disk.usedGb,
      diskTotalGb: disk.totalGb,
      uptimeSec: Math.floor(os.uptime()),
      nodeUptimeSec: Math.floor(process.uptime()),
    };
  }

  // 磁盘用量缓存: statfs 本身极快, 但磁盘变化慢, 缓存 30s 进一步省掉每次 health 的系统调用
  private diskCache: { at: number; val: { usagePercent: number; usedGb: number; totalGb: number } } | null = null;

  private readDisk(): { usagePercent: number; usedGb: number; totalGb: number } {
    const now = Date.now();
    if (this.diskCache && now - this.diskCache.at < 30_000) return this.diskCache.val;
    let val = { usagePercent: 0, usedGb: 0, totalGb: 0 };
    try {
      // Node 原生 statfs (跨平台, Windows 也支持) 取代旧的 execSync('df'):
      // df 在 Windows GK9000 上根本不存在, 旧实现每次 health 都 spawn 一个注定失败的子进程,
      // 磁盘用量还永远读成 0. statfs 无子进程、无异常、数值在 Windows 上也正确.
      const s = statfsSync(process.cwd());
      const total = s.blocks * s.bsize;
      const free = s.bavail * s.bsize;
      const used = total - free;
      const usagePercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
      val = {
        usagePercent,
        usedGb: Math.round((used / 1024 / 1024 / 1024) * 100) / 100,
        totalGb: Math.round((total / 1024 / 1024 / 1024) * 100) / 100,
      };
    } catch {
      val = { usagePercent: 0, usedGb: 0, totalGb: 0 };
    }
    this.diskCache = { at: now, val };
    return val;
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      if (!this.dataSource.isInitialized) return 'down';
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async countDevices(): Promise<{ online: number; offline: number }> {
    const devices = await this.deviceRepo.find({ select: ['name', 'status'] });
    let online = 0;
    let offline = 0;
    for (const d of devices) {
      const runtime = this.deviceStatus.get(d.name);
      const s = runtime?.status ?? d.status;
      if (s === 'online' || s === 'running') online += 1;
      else offline += 1;
    }
    return { online, offline };
  }
}
