import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdapterConfig, AppConfig, WebSocketConfig } from '../../common/config/configuration';
import { DeviceStatusService } from '../../services/device-status.service';
import { SceneEngineService } from '../../services/scene-engine.service';
import { DeviceHealthService } from '../../services/device-health.service';
import { AdapterConnectionRegistry } from '../../adapters/connection-registry';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(
    private readonly config: ConfigService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly engine: SceneEngineService,
    private readonly health: DeviceHealthService,
    private readonly registry: AdapterConnectionRegistry,
    private readonly system: SystemService,
  ) {}

  @Get('info')
  info() {
    const app = this.config.getOrThrow<AppConfig>('app');
    const adapter = this.config.getOrThrow<AdapterConfig>('adapter');
    const ws = this.config.getOrThrow<WebSocketConfig>('websocket');
    const meta = this.system.meta();
    const flags = this.system.productionFlags();
    return {
      message: '查询成功',
      data: {
        app: app.appName,
        env: app.nodeEnv,
        version: meta.version,
        sprint: meta.sprint,
        buildTime: meta.buildTime,
        nodeVersion: process.version,
        platform: meta.platform || app.platform,
        host: meta.host || app.hostMachine || 'unknown',
        hostMachine: app.hostMachine || 'unknown',
        uptimeSec: this.system.uptimeSec(),
        mockMode: adapter.mock,
        testMode: flags.testMode,
        debug: flags.debug,
        mockLatencyMs: adapter.mockLatencyMs,
        websocketPath: ws.path,
        apiPrefix: app.apiPrefix,
      },
    };
  }

  @Get('runtime/devices')
  deviceStatuses() {
    return { message: '查询成功', data: this.deviceStatus.list() };
  }

  @Get('runtime/scenes')
  runningScenes() {
    return { message: '查询成功', data: this.engine.listRunning() };
  }

  @Get('runtime/gateways')
  gateways() {
    return { message: '查询成功', data: this.registry.list() };
  }

  @Get('runtime/health')
  healthInfo() {
    return { message: '查询成功', data: this.health.summary() };
  }

  @Post('runtime/health/probe')
  async probe() {
    await this.health.probeAll();
    return { message: '健康检查已执行', data: this.health.summary() };
  }

  @Get('backups')
  async listBackups() {
    return { message: '查询成功', data: await this.system.listBackups() };
  }

  @Post('backup')
  async backup() {
    const res = await this.system.backup();
    return { message: '数据库备份完成', data: res };
  }

  @Post('restore')
  async restore(@Body() body: { snapshot?: string } = {}) {
    const res = await this.system.restore(body?.snapshot);
    return { message: '恢复 (模拟) 已计算', data: res };
  }
}
