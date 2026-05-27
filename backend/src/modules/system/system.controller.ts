import { Body, Controller, Get, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdapterConfig, AppConfig, WebSocketConfig } from '../../common/config/configuration';
import { DeviceStatusService } from '../../services/device-status.service';
import { SceneEngineService } from '../../services/scene-engine.service';
import { DeviceHealthService } from '../../services/device-health.service';
import { AdapterConnectionRegistry } from '../../adapters/connection-registry';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  constructor(
    private readonly config: ConfigService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly engine: SceneEngineService,
    private readonly health: DeviceHealthService,
    private readonly registry: AdapterConnectionRegistry,
    private readonly lighting: LightingAdapter,
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
        commit: meta.commit ?? null,
        ref: meta.ref ?? null,
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

  // 现场主控机心跳: update.ps1 跑成功后回拨, 报当前 commit / 时间. 远程靠这个看 GK9000 状态.
  @Post('site-heartbeat')
  siteHeartbeat(@Body() body: {
    host?: string;
    commit?: string;
    ref?: string;
    version?: string;
    buildAt?: string;
    updatedAt?: string;
    diagnostics?: unknown;
  }) {
    const host = (body?.host || '').trim();
    if (!host) {
      return { message: 'host 不能为空', data: null };
    }
    const entry = this.system.recordSiteHeartbeat({ ...body, host });
    return { message: 'heartbeat 已记录', data: entry };
  }

  @Get('site-heartbeat')
  listSiteHeartbeat() {
    return { message: '查询成功', data: this.system.listSiteHeartbeats() };
  }

  /**
   * 现场 DALI 自检 — 在 GK9000 本机调这个 endpoint, 返回:
   *   - 当前 adapter 模式 (mock / cy-dali64a / iot-gateway) + MOCK_MODE 状态
   *   - 真实模式下: 网关能不能 ping 通, 总线上探到的 64 个驱动地址哪些在线 / 故障
   *
   * 用例: 远端 (cnjinhu.top 或本机) 都可调. cnjinhu.top 上跑只会拿到云端 mock 结果,
   * 因为 cnjinhu 后端的 LIGHTING_ADAPTER_KIND 是 mock; GK9000 本机才是真实 cy-dali64a.
   */
  @Get('dali-selftest')
  async daliSelftest() {
    const result = await this.lighting.selfDiagnose();
    return { message: '查询成功', data: result };
  }
}
