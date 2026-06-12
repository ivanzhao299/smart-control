import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Socket } from 'net';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import { Logger } from 'winston';
import { Device } from '../../entities/device.entity';
import { Scene } from '../../entities/scene.entity';
import { TestLog, TestType } from '../../entities/test-log.entity';
import { CommandDispatcherService } from '../../services/command-dispatcher.service';
import { ControlBus } from '../../services/control-bus';
import { QueryTestLogDto, TestReportDto } from './dto/test.dto';
import { PagedResult } from '../devices/devices.service';

const execFileAsync = promisify(execFile);

export interface DeviceTestResult {
  success: boolean;
  deviceId: string;
  deviceType: string;
  command: string;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface SceneTestResult {
  success: boolean;
  sceneCode: string;
  sceneName: string;
  dryRun: boolean;
  totalActions: number;
  succeededCount: number;
  failedCount: number;
  actionResults: Array<{
    deviceType: string;
    deviceId: string;
    command: string;
    params: Record<string, unknown>;
    success: boolean;
    error?: string;
    durationMs: number;
  }>;
  durationMs: number;
}

export interface PingResult {
  success: boolean;
  ip: string;
  reachable: boolean;
  latencyMs: number | null;
  error?: string;
}

export interface PortResult {
  success: boolean;
  ip: string;
  port: number;
  open: boolean;
  latencyMs: number | null;
  error?: string;
}

@Injectable()
export class TestCenterService {
  constructor(
    @InjectRepository(TestLog) private readonly logRepo: Repository<TestLog>,
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    private readonly dispatcher: CommandDispatcherService,
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // ---------- 单设备测试 ----------

  async testDevice(
    deviceId: string,
    command: string,
    params: Record<string, unknown> = {},
    operator = 'tester',
  ): Promise<DeviceTestResult> {
    const device = await this.deviceRepo.findOne({ where: { name: deviceId } });
    if (!device) throw new NotFoundException(`设备不存在: ${deviceId}`);

    this.broadcast('test_started', { testType: 'device', targetId: deviceId, command });

    const t0 = Date.now();
    const r = await this.dispatcher.dispatch({
      deviceType: device.category,
      deviceId,
      command,
      params,
    });
    const durationMs = Date.now() - t0;

    const result: DeviceTestResult = {
      success: r.ok,
      deviceId,
      deviceType: device.category,
      command,
      result: r.data,
      error: r.error,
      durationMs,
    };

    await this.writeLog({
      testType: 'device',
      targetType: device.category,
      targetId: deviceId,
      command,
      params,
      result,
      success: r.ok,
      durationMs,
      operator,
    });

    // 更新设备最近测试信息
    try {
      await this.deviceRepo.update(device.id, {
        lastTestAt: new Date(),
        lastTestResult: r.ok ? 'success' : `failure: ${(r.error ?? 'unknown').slice(0, 200)}`,
      });
    } catch (err) {
      this.logger.warn(`Failed to update device test info: ${(err as Error).message}`, {
        context: 'TestCenterService',
      });
    }

    this.broadcast(r.ok ? 'test_success' : 'test_failed', {
      testType: 'device',
      targetId: deviceId,
      result,
    });
    return result;
  }

  // ---------- 子系统批量测试 ----------

  async testSubsystem(
    type: string,
    command: string | undefined,
    params: Record<string, unknown> = {},
    operator = 'tester',
  ): Promise<{
    success: boolean;
    type: string;
    totalDevices: number;
    succeededCount: number;
    failedCount: number;
    devices: DeviceTestResult[];
    durationMs: number;
  }> {
    const devices = await this.deviceRepo.find({
      where: { category: type as Device['category'] },
      order: { id: 'ASC' },
    });
    if (devices.length === 0) {
      throw new NotFoundException(`子系统 ${type} 没有设备`);
    }
    const probeCmd = command ?? this.defaultProbeCommand(type);

    this.broadcast('test_started', { testType: 'subsystem', targetId: type, total: devices.length });
    const t0 = Date.now();
    const results: DeviceTestResult[] = [];
    let succeeded = 0;
    for (const d of devices) {
      const r = await this.testDevice(d.name, probeCmd, params, operator);
      results.push(r);
      if (r.success) succeeded += 1;
      this.broadcast('test_progress', {
        testType: 'subsystem',
        targetId: type,
        index: results.length,
        total: devices.length,
        current: d.name,
        success: r.success,
      });
    }
    const durationMs = Date.now() - t0;
    const success = succeeded === devices.length;

    await this.writeLog({
      testType: 'subsystem',
      targetType: 'subsystem',
      targetId: type,
      command: probeCmd,
      params,
      result: { total: devices.length, succeeded, failed: devices.length - succeeded, devices: results.map((r) => ({ deviceId: r.deviceId, success: r.success, error: r.error })) },
      success,
      durationMs,
      operator,
    });

    this.broadcast(success ? 'test_success' : 'test_failed', {
      testType: 'subsystem',
      targetId: type,
      totalDevices: devices.length,
      succeededCount: succeeded,
      failedCount: devices.length - succeeded,
    });

    return {
      success,
      type,
      totalDevices: devices.length,
      succeededCount: succeeded,
      failedCount: devices.length - succeeded,
      devices: results,
      durationMs,
    };
  }

  private defaultProbeCommand(category: string): string {
    switch (category) {
      case 'lighting': return 'getStatus';
      case 'led': return 'getStatus';
      case 'audio': return 'setVolume';
      case 'hvac': return 'getStatus';
      case 'power': return 'getStatus';
      default: return 'getStatus';
    }
  }

  // ---------- 场景测试 ----------

  async testScene(sceneCode: string, dryRun = false, operator = 'tester'): Promise<SceneTestResult> {
    const scene = await this.sceneRepo.findOne({ where: { code: sceneCode } });
    if (!scene) throw new NotFoundException(`场景不存在: ${sceneCode}`);
    const actions = (scene.actions ?? []).filter((a) => a.enabled);

    this.broadcast('test_started', { testType: 'scene', targetId: sceneCode, total: actions.length, dryRun });

    const t0 = Date.now();
    const actionResults: SceneTestResult['actionResults'] = [];
    let succeeded = 0;
    let failed = 0;

    for (const a of actions) {
      const params = this.parseParams(a.params);
      const a0 = Date.now();
      let ok = false;
      let error: string | undefined;
      let resultData: unknown;
      if (dryRun) {
        ok = true;
        resultData = { dryRun: true };
      } else {
        const r = await this.dispatcher.dispatch({
          deviceType: a.deviceType,
          deviceId: a.deviceId,
          command: a.command,
          params,
        });
        ok = r.ok;
        error = r.error;
        resultData = r.data;
      }
      const aDur = Date.now() - a0;
      actionResults.push({
        deviceType: a.deviceType,
        deviceId: a.deviceId,
        command: a.command,
        params,
        success: ok,
        error,
        durationMs: aDur,
      });
      if (ok) succeeded += 1;
      else failed += 1;
      this.broadcast('test_progress', {
        testType: 'scene',
        targetId: sceneCode,
        index: actionResults.length,
        total: actions.length,
        current: `${a.deviceType}.${a.command}@${a.deviceId}`,
        success: ok,
      });
      // 让结果中包含 data 字段供前端展示
      void resultData;
    }

    const durationMs = Date.now() - t0;
    const success = failed === 0;
    const result: SceneTestResult = {
      success,
      sceneCode,
      sceneName: scene.name,
      dryRun,
      totalActions: actions.length,
      succeededCount: succeeded,
      failedCount: failed,
      actionResults,
      durationMs,
    };

    await this.writeLog({
      testType: 'scene',
      targetType: 'scene',
      targetId: sceneCode,
      command: dryRun ? 'dryRun' : 'execute',
      params: { dryRun },
      result,
      success,
      durationMs,
      operator,
    });

    this.broadcast(success ? 'test_success' : 'test_failed', {
      testType: 'scene',
      targetId: sceneCode,
      result,
    });

    return result;
  }

  // ---------- 网络测试 ----------

  async ping(ip: string, timeoutMs = 2000, operator = 'tester'): Promise<PingResult> {
    this.broadcast('test_started', { testType: 'network_ping', targetId: ip });
    const t0 = Date.now();
    let r: PingResult;
    try {
      // 跨平台 ping 参数 (历史 bug: GK9000 是 Windows, 但代码只考虑 Linux/macOS,
      // 用 `-c 1 -W` 在 Windows 上根本不识别 -> 所有 ping 都 failed)
      // - Windows:  ping -n 1 -w <timeoutMs>   ← -w 单位是毫秒
      // - macOS:    ping -c 1 -W <timeoutMs>   ← BSD ping, -W 单位是毫秒
      // - Linux:    ping -c 1 -W <timeoutSec>  ← iputils, -W 单位是秒
      const platform = process.platform;
      const args: string[] = (() => {
        if (platform === 'win32') {
          return ['-n', '1', '-w', String(timeoutMs), ip];
        }
        if (platform === 'darwin') {
          return ['-c', '1', '-W', String(timeoutMs), ip];
        }
        const timeoutSec = Math.max(1, Math.floor(timeoutMs / 1000));
        return ['-c', '1', '-W', String(timeoutSec), ip];
      })();
      const out = await execFileAsync('ping', args, {
        timeout: timeoutMs + 1000,
        windowsHide: true,
      });
      // 解析延迟. Linux/macOS: time=X ms. Windows: "时间=Xms" 或 "time=Xms" (英文系统)
      const m = /(?:time|时间)[=<]([\d.]+)\s*ms/i.exec(out.stdout);
      const latencyMs = m ? Number.parseFloat(m[1]) : Date.now() - t0;
      // Windows 即使主机不通也可能 exit 0 (输出 "请求超时" / "Request timed out"), 检查 stdout
      const lower = out.stdout.toLowerCase();
      const failed = lower.includes('请求超时') || lower.includes('request timed out')
        || lower.includes('无法访问') || lower.includes('destination host unreachable')
        || lower.includes('100% loss') || lower.includes('100% packet loss');
      if (failed) {
        r = { success: true, ip, reachable: false, latencyMs: null, error: 'host unreachable' };
      } else {
        r = { success: true, ip, reachable: true, latencyMs };
      }
    } catch (err) {
      r = {
        success: true,
        ip,
        reachable: false,
        latencyMs: null,
        error: (err as Error).message.split('\n')[0],
      };
    }
    const durationMs = Date.now() - t0;
    await this.writeLog({
      testType: 'network_ping',
      targetType: 'ip',
      targetId: ip,
      command: 'ping',
      params: { timeoutMs },
      result: r,
      success: r.reachable,
      durationMs,
      operator,
    });
    this.broadcast(r.reachable ? 'test_success' : 'test_failed', {
      testType: 'network_ping',
      targetId: ip,
      result: r,
    });
    return r;
  }

  /**
   * 查 GK9000 当前 ARP 表 — 用于排查"网线同交换机但 ping 不通"场景:
   * 设备如果 IP 配在别的网段, 跨网段 ping 不通, 但只要同 broadcast domain
   * (同交换机 + 同 VLAN) ARP 广播一定到, GK9000 网卡缓存里就有它的 MAC + IP.
   *
   * 返回结构: [{ ip, mac, type? }, ...]
   */
  async arpTable(): Promise<Array<{ ip: string; mac: string; iface?: string; type?: string }>> {
    try {
      const platform = process.platform;
      const cmd = platform === 'win32' ? 'arp' : 'arp';
      const args = platform === 'win32' ? ['-a'] : ['-an'];
      const out = await execFileAsync(cmd, args, { timeout: 5000, windowsHide: true });
      const entries: Array<{ ip: string; mac: string; iface?: string; type?: string }> = [];
      if (platform === 'win32') {
        // Windows 输出格式:
        //   Interface: 192.168.124.11 --- 0x6
        //     Internet Address      Physical Address      Type
        //     192.168.124.1         00-aa-bb-cc-dd-ee     dynamic
        let currentIface = '';
        for (const line of out.stdout.split(/\r?\n/)) {
          const ifaceMatch = /Interface:\s+([\d.]+)/i.exec(line);
          if (ifaceMatch) {
            currentIface = ifaceMatch[1];
            continue;
          }
          const m = /^\s*([\d.]+)\s+([0-9a-f-]{17})\s+(\S+)\s*$/i.exec(line);
          if (m) {
            entries.push({ ip: m[1], mac: m[2].replace(/-/g, ':').toLowerCase(), iface: currentIface, type: m[3] });
          }
        }
      } else {
        // Linux/macOS 输出格式: ? (192.168.x.x) at ab:cd:ef:01:02:03 [ether] on en0
        for (const line of out.stdout.split(/\r?\n/)) {
          const m = /\(([\d.]+)\)\s+at\s+([0-9a-f:]{17})/i.exec(line);
          if (m) {
            entries.push({ ip: m[1], mac: m[2].toLowerCase() });
          }
        }
      }
      return entries;
    } catch (err) {
      return [];
    }
  }

  async portCheck(
    ip: string,
    port: number,
    timeoutMs = 2000,
    operator = 'tester',
  ): Promise<PortResult> {
    this.broadcast('test_started', { testType: 'network_port', targetId: `${ip}:${port}` });
    const t0 = Date.now();
    const result: PortResult = await new Promise<PortResult>((resolve) => {
      const sock = new Socket();
      let done = false;
      const finish = (open: boolean, error?: string): void => {
        if (done) return;
        done = true;
        sock.destroy();
        resolve({
          success: true,
          ip,
          port,
          open,
          latencyMs: open ? Date.now() - t0 : null,
          error,
        });
      };
      sock.setTimeout(timeoutMs);
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false, `timeout after ${timeoutMs}ms`));
      sock.once('error', (err) => finish(false, err.message));
      try {
        sock.connect(port, ip);
      } catch (err) {
        finish(false, (err as Error).message);
      }
    });
    const durationMs = Date.now() - t0;
    await this.writeLog({
      testType: 'network_port',
      targetType: 'ip_port',
      targetId: `${ip}:${port}`,
      command: 'tcp-connect',
      params: { timeoutMs },
      result,
      success: result.open,
      durationMs,
      operator,
    });
    this.broadcast(result.open ? 'test_success' : 'test_failed', {
      testType: 'network_port',
      targetId: `${ip}:${port}`,
      result,
    });
    return result;
  }

  // ---------- 测试日志 ----------

  async findLogs(q: QueryTestLogDto): Promise<PagedResult<TestLog>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: FindOptionsWhere<TestLog> = {};
    if (q.testType) where.testType = q.testType as TestType;
    if (q.targetType) where.targetType = q.targetType;
    if (q.targetId) where.targetId = q.targetId;
    if (q.success !== undefined) where.success = q.success;
    if (q.startTime && q.endTime) {
      where.createdAt = Between(new Date(q.startTime), new Date(q.endTime));
    }
    const [list, total] = await this.logRepo.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async findLog(id: number): Promise<TestLog> {
    const r = await this.logRepo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`测试日志不存在: id=${id}`);
    return r;
  }

  // ---------- 测试报告 ----------

  async report(dto: TestReportDto): Promise<{
    startTime: string;
    endTime: string;
    totalTests: number;
    succeededCount: number;
    failedCount: number;
    avgDurationMs: number;
    byTestType: Record<string, { total: number; succeeded: number; failed: number }>;
    failures: Array<{
      id: number;
      testType: string;
      targetType: string;
      targetId: string;
      error: string;
      createdAt: string;
    }>;
  }> {
    const end = dto.endTime ? new Date(dto.endTime) : new Date();
    const start = dto.startTime ? new Date(dto.startTime) : new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const where: FindOptionsWhere<TestLog> = {
      createdAt: Between(start, end),
    };
    if (dto.testType) where.testType = dto.testType as TestType;
    const list = await this.logRepo.find({ where, order: { id: 'DESC' } });

    const total = list.length;
    const succeeded = list.filter((r) => r.success).length;
    const failed = total - succeeded;
    const avg = total > 0 ? Math.round(list.reduce((s, r) => s + r.durationMs, 0) / total) : 0;

    const byTestType: Record<string, { total: number; succeeded: number; failed: number }> = {};
    for (const r of list) {
      const k = r.testType;
      if (!byTestType[k]) byTestType[k] = { total: 0, succeeded: 0, failed: 0 };
      byTestType[k].total += 1;
      if (r.success) byTestType[k].succeeded += 1;
      else byTestType[k].failed += 1;
    }

    const failures = list
      .filter((r) => !r.success)
      .slice(0, 50)
      .map((r) => ({
        id: r.id,
        testType: r.testType,
        targetType: r.targetType,
        targetId: r.targetId,
        error: this.extractError(r.result),
        createdAt: r.createdAt.toISOString(),
      }));

    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      totalTests: total,
      succeededCount: succeeded,
      failedCount: failed,
      avgDurationMs: avg,
      byTestType,
      failures,
    };
  }

  // ---------- 联调清单 ----------

  async checklist(): Promise<{
    generatedAt: string;
    devices: Array<{
      id: number;
      name: string;
      category: string;
      ip: string | null;
      address: string | null;
      enabled: boolean;
      lastTestAt: string | null;
      lastTestResult: string | null;
      debugRemark: string | null;
    }>;
    networkTargets: Array<{ ip: string; lastReachable: boolean | null; lastTestedAt: string | null }>;
    failingItems: Array<{ deviceId: string; lastTestResult: string; lastTestAt: string }>;
  }> {
    const devices = await this.deviceRepo.find({ order: { id: 'ASC' } });
    const ips = Array.from(
      new Set(devices.map((d) => d.ip).filter((ip): ip is string => Boolean(ip))),
    );
    const lastByIp = new Map<string, TestLog>();
    if (ips.length > 0) {
      const rows = await this.logRepo
        .createQueryBuilder('t')
        .where('t.test_type = :tt AND t.target_id IN (:...ips)', { tt: 'network_ping', ips })
        .orderBy('t.id', 'DESC')
        .getMany();
      for (const r of rows) {
        if (!lastByIp.has(r.targetId)) lastByIp.set(r.targetId, r);
      }
    }
    return {
      generatedAt: new Date().toISOString(),
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        category: d.category,
        ip: d.ip,
        address: d.address,
        enabled: d.enabled,
        lastTestAt: d.lastTestAt ? d.lastTestAt.toISOString() : null,
        lastTestResult: d.lastTestResult,
        debugRemark: d.debugRemark,
      })),
      networkTargets: ips.map((ip) => {
        const t = lastByIp.get(ip);
        return {
          ip,
          lastReachable: t ? t.success : null,
          lastTestedAt: t ? t.createdAt.toISOString() : null,
        };
      }),
      failingItems: devices
        .filter((d) => d.lastTestResult && !d.lastTestResult.startsWith('success'))
        .map((d) => ({
          deviceId: d.name,
          lastTestResult: d.lastTestResult ?? '',
          lastTestAt: d.lastTestAt ? d.lastTestAt.toISOString() : '',
        })),
    };
  }

  // ---------- 工具 ----------

  private parseParams(raw: string | null | undefined): Record<string, unknown> {
    if (!raw) return {};
    try {
      const p = JSON.parse(raw);
      return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  private extractError(raw: string | null): string {
    if (!raw) return '';
    try {
      const j = JSON.parse(raw);
      return (j?.error ?? j?.message ?? JSON.stringify(j)).slice(0, 200);
    } catch {
      return raw.slice(0, 200);
    }
  }

  private async writeLog(input: {
    testType: TestType;
    targetType: string;
    targetId: string;
    command?: string;
    params?: Record<string, unknown> | unknown;
    result?: unknown;
    success: boolean;
    durationMs: number;
    operator: string;
  }): Promise<void> {
    try {
      const entity = this.logRepo.create({
        testType: input.testType,
        targetType: input.targetType,
        targetId: input.targetId,
        command: input.command ?? null,
        params: input.params ? JSON.stringify(input.params) : null,
        result: input.result ? JSON.stringify(input.result) : null,
        success: input.success,
        durationMs: input.durationMs,
        operator: input.operator,
      });
      await this.logRepo.save(entity);
    } catch (err) {
      this.logger.warn(`Failed to write test log: ${(err as Error).message}`, {
        context: 'TestCenterService',
      });
    }
  }

  private broadcast(
    type: 'test_started' | 'test_progress' | 'test_success' | 'test_failed',
    payload: Record<string, unknown>,
  ): void {
    try {
      this.bus.publish({
        type,
        ...payload,
        at: new Date().toISOString(),
      });
    } catch {
      // 不阻塞主流程
    }
  }
}
