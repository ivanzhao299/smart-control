import { BadRequestException, Body, Controller, ForbiddenException, Get, Logger, Post, Query, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { AdapterConfig, AppConfig, WebSocketConfig } from '../../common/config/configuration';
import { DeviceStatusService } from '../../services/device-status.service';
import { SceneEngineService } from '../../services/scene-engine.service';
import { DeviceHealthService } from '../../services/device-health.service';
import { AdapterConnectionRegistry } from '../../adapters/connection-registry';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';
import { SystemService } from './system.service';

@Controller('system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

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

  /** 清空所有网关的 lastError + 失败计数, 重新探活一次. 后台"清空告警"按钮调. */
  @Post('runtime/gateways/clear-faults')
  async clearGatewayFaults() {
    const cleared = this.registry.clearAllFaults();
    // 立即重新探活, 把真实状态填回去
    await this.health.probeAll();
    return {
      message: `清空 ${cleared} 个网关的旧告警, 已重新探活`,
      data: this.registry.list(),
    };
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
   * DALI 短地址直控 — 绕开 group 分配, 直接对单个驱动器调亮度.
   * 用于排查 "网关通 / 灯具识别到 / group 命令没响应" 时的快速验证.
   *
   * GET /api/system/dali-poke?short=1&value=80   将短地址 1 调到 80% 亮度
   * GET /api/system/dali-poke?short=2&value=0    将短地址 2 关掉
   *
   * 没认证, 因为只 LAN 内可达 (生产 nginx 全局加 Basic Auth 已经够安全)
   */
  @Get('dali-poke')
  async daliPoke(
    @Query('short') shortStr?: string,
    @Query('value') valueStr?: string,
  ): Promise<unknown> {
    const short = Number(shortStr ?? 1);
    const value = Number(valueStr ?? 50);
    if (!Number.isInteger(short) || short < 1 || short > 64) {
      return { message: 'short 必须 1-64', data: null };
    }
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return { message: 'value 必须 0-100', data: null };
    }
    const deviceId = JSON.stringify({ slaveId: 1, short });
    this.logger.warn(`dali-poke: short=${short} value=${value}% envHost=${process.env.DALI_RTU_HOST ?? '(default)'}`);
    try {
      const result = await this.lighting.setBrightness(deviceId, { value });
      if (result && (result as { ok?: boolean }).ok === false) {
        const errMsg = (result as { error?: string }).error ?? '未知错误';
        return { message: `命令失败 (ok=false): ${errMsg}`, data: result };
      }
      return { message: `已对短地址 ${short} 设亮度 ${value}%`, data: result };
    } catch (err) {
      return { message: `命令异常: ${(err as Error).message}`, data: null };
    }
  }

  /**
   * 自重启 — 只能从 backend 本机的 loopback 调用 (127.0.0.1 / ::1).
   *
   * 场景: GK9000 上 backend 进程归 admin (因为最初用 restart.ps1 -Hard 启动),
   * watcher 跑在普通 user 身份, pm2 delete / Stop-Process 都因权限不足无法
   * 终止它. 所以 backend 自己提供这个 endpoint, 收到 POST 后 setTimeout 200ms
   * 后 process.exit(0), 让 pm2 的 autorestart 把它拉起来 — 新进程读最新 dist
   * + 最新 .env, 实现真正的 "重启换代码 + 换环境变量".
   *
   * 安全: 严格只允许 loopback 来源 (req.socket.remoteAddress). nginx 代理来的
   * 请求 remoteAddress 是 nginx upstream IP, 不会是 127.0.0.1, 因此远程公网
   * 即使知道 token 也调不通. 双保险: token + 来源 IP 检查.
   */
  @Post('admin-restart')
  adminRestart(@Req() req: Request, @Body() body: { token?: string } = {}) {
    const remoteAddr = req.socket?.remoteAddress ?? '';
    const isLoopback = remoteAddr === '127.0.0.1'
      || remoteAddr === '::1'
      || remoteAddr === '::ffff:127.0.0.1';
    if (!isLoopback) {
      this.logger.warn(`admin-restart denied: remote=${remoteAddr} (not loopback)`);
      throw new ForbiddenException('admin-restart 仅允许本机 loopback 调用');
    }
    if (body?.token !== 'jinhu-restart-2026') {
      throw new BadRequestException('token 错误');
    }
    this.logger.warn(`admin-restart triggered from ${remoteAddr}, exiting in 200ms`);
    setTimeout(() => process.exit(0), 200);
    return { message: '即将重启 (200ms 后 exit 0, pm2 autorestart 会拉起)', data: { exitsAt: Date.now() + 200 } };
  }

  /**
   * 远程触发 frontend 重 build (2026-05-30 加).
   * 同 admin-restart 一样, 严格 loopback + token. 用 child_process spawn
   * `npm run build` 在 frontend 目录, 异步执行不阻塞响应. 失败的话看
   * scripts/update.ps1 那条链路的日志.
   *
   * 场景: watcher 卡住 / 上次 build 中途挂了导致 dist/assets/ 为空, 不想
   * RDC 进 GK9000 又想远程恢复.
   */
  @Post('admin-rebuild-frontend')
  async adminRebuildFrontend(@Req() req: Request, @Body() body: { token?: string } = {}): Promise<unknown> {
    const remoteAddr = req.socket?.remoteAddress ?? '';
    const isLoopback = remoteAddr === '127.0.0.1'
      || remoteAddr === '::1'
      || remoteAddr === '::ffff:127.0.0.1';
    if (!isLoopback) throw new ForbiddenException('仅本机 loopback');
    if (body?.token !== 'jinhu-restart-2026') throw new BadRequestException('token 错误');

    const { spawn } = await import('child_process');
    const { resolve } = await import('path');
    const frontendDir = resolve(process.cwd(), '..', 'frontend');
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(cmd, ['run', 'build'], {
      cwd: frontendDir,
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
    });
    child.unref();
    this.logger.warn(`admin-rebuild-frontend started (pid=${child.pid}, cwd=${frontendDir})`);
    return {
      message: `已启动后台 npm run build (pid=${child.pid}), 2-3 分钟后看 ${frontendDir}/dist 是否更新`,
      data: { pid: child.pid, cwd: frontendDir, startedAt: new Date().toISOString() },
    };
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

  /**
   * 分层 DALI 诊断 (2026-05-27): 路径用 `diag` 避开 `-selftest` 命名,
   * 排除路由解析问题. 每层独立超时, 失败不阻塞下一层.
   */
  @Get('diag')
  async diag() {
    const result = await this.lighting.diagnoseLayered();
    return { message: '查询成功', data: result };
  }

  /** 验证 backend 跑的是最新 build — 返回硬编码 marker 字符串 */
  @Get('build-marker')
  buildMarker() {
    return {
      message: 'build-marker',
      data: {
        marker: '2026-05-29-novastar-scan',
        nodeVersion: process.version,
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        uptimeSec: Math.round(process.uptime()),
      },
    };
  }

  /**
   * 诺瓦 NovaStar 设备发现 — UDP 广播 + TCP 候选 IP 探测.
   *
   * 用 V/VX 系列自带的 UDP 搜索协议: 向 .255:3800 广播 "rqProMI:",
   * 任何在线的 NovaStar 设备会回 "rpProMI:App,0161" (16 字节固定值).
   * 同时并行 TCP 探一些常见默认 IP (诺瓦出厂常用 192.168.0.10 / .1.10 等).
   *
   * GET /api/system/scan-novastar?subnet=192.168.50&timeoutMs=3000
   * 默认 subnet 取 NIC 当前的 LAN 段.
   */
  @Get('scan-novastar')
  async scanNovastar(
    @Query('subnet') subnetStr?: string,
    @Query('timeoutMs') timeoutMsStr?: string,
  ): Promise<unknown> {
    const dgram = await import('dgram');
    const net = await import('net');
    const os = await import('os');

    const timeoutMs = Math.max(500, Math.min(8000, Number(timeoutMsStr ?? 3000)));

    // 自动推断 subnet (取 192.168.x.0/24 的第一个 IPv4 NIC), 也支持手动指定
    function inferSubnets(): string[] {
      const subs: string[] = [];
      const ifs = os.networkInterfaces();
      for (const list of Object.values(ifs)) {
        if (!list) continue;
        for (const it of list) {
          if (it.family !== 'IPv4' || it.internal) continue;
          const parts = it.address.split('.');
          if (parts.length === 4) subs.push(`${parts[0]}.${parts[1]}.${parts[2]}`);
        }
      }
      return Array.from(new Set(subs));
    }
    // 接受 "192.168.50" / "192.168.50.30" / "192.168.50.0/24" 都正确截成 "192.168.50"
    function normalizeSubnet(s: string): string | null {
      const m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
      return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
    }
    const subnets = subnetStr
      ? [normalizeSubnet(subnetStr)].filter((x): x is string => !!x)
      : inferSubnets();

    // UDP 广播 + 收应答
    const found: Array<{ ip: string; raw: string; via: 'udp' | 'tcp' }> = [];
    const udpResults = await Promise.all(
      subnets.map(
        (sub) =>
          new Promise<void>((resolve) => {
            const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
            const broadcast = `${sub}.255`;
            sock.on('message', (msg, rinfo) => {
              const txt = msg.toString('ascii');
              if (txt.startsWith('rpProMI:')) {
                found.push({ ip: rinfo.address, raw: txt, via: 'udp' });
              }
            });
            sock.on('error', () => resolve());
            sock.bind(0, () => {
              sock.setBroadcast(true);
              const payload = Buffer.from('rqProMI:', 'ascii');
              sock.send(payload, 3800, broadcast, () => {});
            });
            setTimeout(() => {
              try { sock.close(); } catch { /* ignore */ }
              resolve();
            }, timeoutMs);
          }),
      ),
    );
    void udpResults;

    // TCP 候选探测 — 出厂默认 + 当前配置 + 常见自助分配
    const tcpCandidates = new Set<string>();
    for (const sub of subnets) {
      tcpCandidates.add(`${sub}.30`); // 我们记的 IP
      tcpCandidates.add(`${sub}.10`); // 诺瓦工厂默认之一
    }
    tcpCandidates.add('192.168.0.10');
    tcpCandidates.add('192.168.1.10');

    async function tcpProbe(ip: string): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        const s = new net.Socket();
        let done = false;
        const finish = (ok: boolean) => {
          if (done) return;
          done = true;
          try { s.destroy(); } catch { /* ignore */ }
          resolve(ok);
        };
        s.setTimeout(1200);
        s.once('connect', () => finish(true));
        s.once('timeout', () => finish(false));
        s.once('error', () => finish(false));
        s.connect(5200, ip);
      });
    }
    const tcpResults = await Promise.all(
      Array.from(tcpCandidates).map(async (ip) => ({ ip, ok: await tcpProbe(ip) })),
    );
    for (const r of tcpResults) {
      if (r.ok && !found.some((f) => f.ip === r.ip)) {
        found.push({ ip: r.ip, raw: 'tcp 5200 open', via: 'tcp' });
      }
    }

    return {
      message: '扫描完成',
      data: {
        subnetsScanned: subnets,
        tcpCandidates: Array.from(tcpCandidates),
        timeoutMs,
        found,
        hint: found.length === 0
          ? '未发现 NovaStar 设备 — 看 V2460 前面板菜单的 IP, 或确认它接在跟 GK9000 同一台交换机'
          : `发现 ${found.length} 台设备, 改 DB 里 LED-NOVA-1.ip 即可`,
      },
    };
  }
}
