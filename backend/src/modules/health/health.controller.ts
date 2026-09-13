import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdapterConfig, AppConfig } from '../../common/config/configuration';
import { HealthService } from './health.service';
import { Public } from '../../common/decorators/public.decorator';

@Controller('system')
export class HealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly health: HealthService,
  ) {}

  /** Sprint-08 增强健康检查 + Sprint-01 现场主机标识 */
  @Public()
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
        platform: app.platform,
        host: app.hostMachine || 'unknown',
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
        version: '0.9.0',
        sprint: 'Sprint-09',
        testMode: (process.env.TEST_MODE ?? 'false').toLowerCase() === 'true',
        nodeVersion: process.version,
        platform: app.platform,
        platformRaw: process.platform,
        host: app.hostMachine || 'unknown',
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
