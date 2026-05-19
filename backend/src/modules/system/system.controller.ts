import { Controller, Get, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdapterConfig, AppConfig, WebSocketConfig } from '../../common/config/configuration';
import { DeviceStatusService } from '../../services/device-status.service';
import { SceneEngineService } from '../../services/scene-engine.service';
import { DeviceHealthService } from '../../services/device-health.service';
import { AdapterConnectionRegistry } from '../../adapters/connection-registry';

@Controller('system')
export class SystemController {
  constructor(
    private readonly config: ConfigService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly engine: SceneEngineService,
    private readonly health: DeviceHealthService,
    private readonly registry: AdapterConnectionRegistry,
  ) {}

  @Get('info')
  info() {
    const app = this.config.getOrThrow<AppConfig>('app');
    const adapter = this.config.getOrThrow<AdapterConfig>('adapter');
    const ws = this.config.getOrThrow<WebSocketConfig>('websocket');
    return {
      message: '查询成功',
      data: {
        app: app.appName,
        env: app.nodeEnv,
        version: '0.9.0',
        sprint: 'Sprint-09',
        mockMode: adapter.mock,
        testMode: (process.env.TEST_MODE ?? 'false').toLowerCase() === 'true',
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
}
