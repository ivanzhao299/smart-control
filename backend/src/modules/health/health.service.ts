import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as os from 'os';
import { execSync } from 'child_process';
import { Device } from '../../entities/device.entity';
import { DeviceStatusService } from '../../services/device-status.service';

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
    const apiStatus: 'up' | 'down' = 'up';
    const status: HealthReport['status'] =
      db === 'down' ? 'down' : (this.wsUp && this.schedulerUp ? 'ok' : 'degraded');
    return {
      status,
      apiStatus,
      databaseStatus: db,
      websocketStatus: this.wsUp ? 'up' : 'down',
      schedulerStatus: this.schedulerUp ? 'up' : 'down',
      deviceOnlineCount: dev.online,
      deviceOfflineCount: dev.offline,
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

  private readDisk(): { usagePercent: number; usedGb: number; totalGb: number } {
    try {
      // df -k <cwd> 跨 Linux/macOS 通用
      const out = execSync(`df -k ${process.cwd()}`, { encoding: 'utf8', timeout: 1500 });
      const lines = out.trim().split('\n');
      if (lines.length < 2) throw new Error('df no row');
      const parts = lines[lines.length - 1].split(/\s+/);
      // parts: filesystem 1K-blocks used available cap% mount
      const total = Number(parts[1]) * 1024;
      const used = Number(parts[2]) * 1024;
      const usagePercent = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;
      return {
        usagePercent,
        usedGb: Math.round((used / 1024 / 1024 / 1024) * 100) / 100,
        totalGb: Math.round((total / 1024 / 1024 / 1024) * 100) / 100,
      };
    } catch {
      return { usagePercent: 0, usedGb: 0, totalGb: 0 };
    }
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
