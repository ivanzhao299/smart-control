import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdapterConfig, AppConfig } from '../../common/config/configuration';
import { HealthService } from './health.service';

@Controller('system')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly health: HealthService,
  ) {}

  /** Sprint-08 增强健康检查 */
  @Get('health')
  async healthCheck() {
    const report = await this.health.report();
    const app = this.config.getOrThrow<AppConfig>('app');
    return {
      message: '查询成功',
      data: {
        ...report,
        app: app.appName,
        env: app.nodeEnv,
      },
    };
  }

  /** 系统资源 / 版本 / 环境 详情 */
  @Get('status')
  systemStatus() {
    const app = this.config.getOrThrow<AppConfig>('app');
    const adapter = this.config.getOrThrow<AdapterConfig>('adapter');
    const r = this.health.resources();
    return {
      message: '查询成功',
      data: {
        app: app.appName,
        env: app.nodeEnv,
        version: '0.8.0',
        sprint: 'Sprint-08',
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        pid: process.pid,
        mockMode: adapter.mock,
        cpu: {
          usagePercent: r.cpuUsagePercent,
          loadAvg1m: r.cpuLoadAvg1m,
          cores: require('os').cpus().length,
        },
        memory: {
          usagePercent: r.memoryUsagePercent,
          usedMb: r.memoryUsedMb,
          totalMb: r.memoryTotalMb,
        },
        disk: {
          usagePercent: r.diskUsagePercent,
          usedGb: r.diskUsedGb,
          totalGb: r.diskTotalGb,
        },
        uptime: {
          osSec: r.uptimeSec,
          processSec: r.nodeUptimeSec,
        },
        timestamp: new Date().toISOString(),
      },
    };
  }
}
