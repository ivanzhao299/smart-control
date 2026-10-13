import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, MoreThan, Repository } from 'typeorm';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, normalize } from 'path';
import { LprDevice } from '../../entities/lpr-device.entity';
import { LprPassRecord } from '../../entities/lpr-pass-record.entity';
import { LprWhitelist } from '../../entities/lpr-whitelist.entity';
import { LprGateEvent } from '../../entities/lpr-gate-event.entity';
import { ControlBus } from '../../services/control-bus';
import { AuditService } from '../audit/audit.service';
import {
  carColorLabel,
  carTypeLabel,
  directionLabel,
  gateStatusLabel,
  normalizePlate,
  plateColorLabel,
  plateTypeLabel,
  triggerTypeLabel,
} from './lpr-codes';
import type {
  AlarmPlateBody,
  DeviceCreateDto,
  DeviceUpsertDto,
  DeviceView,
  GateOpenDto,
  GateStatusBody,
  LprStats,
  PassRecordView,
  PlateResultPayload,
  WhitelistUpsertDto,
} from './lpr.types';

/** 心跳/comet 超过该时长未通讯则视为离线 */
const ONLINE_GRACE_MS = 90_000;
/**
 * 短轮询心跳落库最小间隔 (ms)。XLT 相机以 ~1s 周期 comet 短轮询(且服务端立即回空),
 * 若每次都落库会放大 SQLite 写入; 以 3s 粒度刷新 lastHeartbeat 已远小于 90s 在线判定窗口。
 */
const TOUCH_DB_MIN_MS = 3_000;
/** 单张抓拍图落盘上限 (字节), 超出丢弃, 防异常大包 */
const MAX_SNAP_BYTES = 3_000_000;
/** 单次 comet/回复最多下发的白名单条数 (协议要求 ≤5) */
const WL_BATCH = 5;

/** 通道方向归一化: 仅接受 in/out, 其余 (含 null/非法) 归为 null */
function normalizeDirection(v: unknown): 'in' | 'out' | null {
  return v === 'in' || v === 'out' ? v : null;
}

/** 开闸 IO 编号归一化到 0..3, 非法时回退到 fallback */
function clampGateIo(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : fallback;
}

interface DeviceMeta {
  ip?: string | null;
  deviceName?: string | null;
  model?: string | null;
  channel?: number | null;
}

function fmtDateTime(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

@Injectable()
export class LprService {
  private readonly logger = new Logger(LprService.name);
  private readonly snapRoot: string;
  /** serialno -> 待下发命令内层对象 (开闸等); 短轮询相机每 ~1s 拉取, 命令持久化于此, 不依赖长连接 */
  private readonly queues = new Map<string, Array<Record<string, unknown>>>();
  /** serialno -> 最近一次心跳落库时间(ms), 用于短轮询下抑制高频 SQLite 写 */
  private readonly lastTouchDbAt = new Map<string, number>();

  constructor(
    @InjectRepository(LprDevice) private readonly deviceRepo: Repository<LprDevice>,
    @InjectRepository(LprPassRecord) private readonly passRepo: Repository<LprPassRecord>,
    @InjectRepository(LprWhitelist) private readonly wlRepo: Repository<LprWhitelist>,
    @InjectRepository(LprGateEvent) private readonly gateRepo: Repository<LprGateEvent>,
    private readonly bus: ControlBus,
    private readonly audit: AuditService,
  ) {
    this.snapRoot = process.env.LPR_SNAP_DIR || join(process.cwd(), '..', 'database', 'lpr-snaps');
    try {
      mkdirSync(this.snapRoot, { recursive: true });
    } catch (e) {
      this.logger.warn(`LPR 抓拍目录创建失败: ${(e as Error).message}`);
    }
  }

  // ============================ 设备 ============================

  /** 心跳/推送/comet 到达时登记或刷新设备; 新相机自动登记(放行仍需命中白名单) */
  private async touchDevice(serialno: string, meta: DeviceMeta = {}): Promise<LprDevice> {
    let dev = await this.deviceRepo.findOne({ where: { serialno } });
    const now = new Date();
    if (!dev) {
      dev = this.deviceRepo.create({
        serialno,
        deviceName: meta.deviceName?.trim() || `相机 ${serialno.slice(-4)}`,
        model: meta.model ?? null,
        ip: meta.ip ?? null,
        channel: meta.channel ?? null,
        location: null,
        gateIo: 0,
        passDirection: null,
        online: true,
        lastHeartbeat: now,
        enabled: true,
      });
      this.logger.log(`登记新 LPR 相机: ${serialno}`);
      this.lastTouchDbAt.set(serialno, now.getTime());
      return this.deviceRepo.save(dev);
    }

    const trimmedName = meta.deviceName?.trim() || '';
    const metaChanged =
      (!!meta.ip && meta.ip !== dev.ip) ||
      (!!meta.model && meta.model !== dev.model) ||
      (meta.channel !== null && meta.channel !== undefined && meta.channel !== dev.channel) ||
      (!!trimmedName && dev.deviceName.startsWith('相机 ') && trimmedName !== dev.deviceName);

    dev.online = true;
    dev.lastHeartbeat = now;
    if (meta.ip) dev.ip = meta.ip;
    if (meta.model) dev.model = meta.model;
    if (meta.channel !== null && meta.channel !== undefined) dev.channel = meta.channel;
    if (trimmedName && dev.deviceName.startsWith('相机 ')) dev.deviceName = trimmedName;

    // 短轮询下心跳可达每秒多次; 仅在字段变化或距上次落库超过阈值时才写库, 其余只更新内存对象。
    const lastDbAt = this.lastTouchDbAt.get(serialno) ?? 0;
    if (metaChanged || now.getTime() - lastDbAt >= TOUCH_DB_MIN_MS) {
      this.lastTouchDbAt.set(serialno, now.getTime());
      return this.deviceRepo.save(dev);
    }
    return dev;
  }

  private isOnline(dev: LprDevice, now = Date.now()): boolean {
    if (!dev.online || !dev.lastHeartbeat) return false;
    return now - new Date(dev.lastHeartbeat).getTime() <= ONLINE_GRACE_MS;
  }

  async listDevices(): Promise<DeviceView[]> {
    const devs = await this.deviceRepo.find({ order: { id: 'ASC' } });
    const now = Date.now();
    return Promise.all(
      devs.map(async (d): Promise<DeviceView> => {
        const gate = await this.gateRepo.findOne({ where: { serialno: d.serialno }, order: { id: 'DESC' } });
        const last = await this.passRepo.findOne({ where: { serialno: d.serialno }, order: { id: 'DESC' } });
        return {
          id: d.id,
          serialno: d.serialno,
          deviceName: d.deviceName,
          model: d.model,
          ip: d.ip,
          channel: d.channel,
          location: d.location,
          gateIo: d.gateIo,
          passDirection: d.passDirection,
          online: this.isOnline(d, now),
          lastHeartbeat: d.lastHeartbeat ? new Date(d.lastHeartbeat).toISOString() : null,
          enabled: d.enabled,
          gateStatus: gate?.gateStatus ?? null,
          gateStatusLabel: gateStatusLabel(gate?.gateStatus ?? null),
          lastPlate: last?.license ?? null,
          lastEventTime: last?.eventTime ? new Date(last.eventTime).toISOString() : null,
        };
      }),
    );
  }

  async updateDevice(id: number, dto: DeviceUpsertDto): Promise<DeviceView> {
    const dev = await this.deviceRepo.findOne({ where: { id } });
    if (!dev) throw new NotFoundException('设备不存在');
    if (dto.deviceName !== undefined) dev.deviceName = dto.deviceName.trim() || dev.deviceName;
    if (dto.model !== undefined) dev.model = dto.model;
    if (dto.ip !== undefined) dev.ip = dto.ip;
    if (dto.location !== undefined) dev.location = dto.location;
    if (dto.channel !== undefined) dev.channel = dto.channel;
    if (dto.gateIo !== undefined) dev.gateIo = clampGateIo(dto.gateIo, dev.gateIo);
    if (dto.passDirection !== undefined) dev.passDirection = normalizeDirection(dto.passDirection);
    if (dto.enabled !== undefined) dev.enabled = dto.enabled;
    await this.deviceRepo.save(dev);
    const list = await this.listDevices();
    const view = list.find((v) => v.id === id);
    if (!view) throw new NotFoundException('设备不存在');
    return view;
  }

  /**
   * 按序列号预登记相机 (设备上线前手动录入)。
   * 序列号已存在 (含已自动登记) 时按提供字段更新, 保证幂等; 新建设备上线前为离线态。
   */
  async createDevice(dto: DeviceCreateDto): Promise<DeviceView> {
    const serialno = dto.serialno?.trim();
    if (!serialno) throw new BadRequestException('相机序列号必填');
    let dev = await this.deviceRepo.findOne({ where: { serialno } });
    if (!dev) {
      dev = this.deviceRepo.create({
        serialno,
        deviceName: dto.deviceName?.trim() || `相机 ${serialno.slice(-4)}`,
        model: dto.model?.trim() || null,
        ip: dto.ip?.trim() || null,
        location: dto.location?.trim() || null,
        channel: dto.channel ?? null,
        gateIo: clampGateIo(dto.gateIo, 0),
        passDirection: normalizeDirection(dto.passDirection),
        online: false,
        lastHeartbeat: null,
        enabled: dto.enabled ?? true,
      });
      this.logger.log(`预登记 LPR 相机: ${serialno} (${dev.deviceName})`);
    } else {
      if (dto.deviceName?.trim()) dev.deviceName = dto.deviceName.trim();
      if (dto.model !== undefined) dev.model = dto.model?.trim() || null;
      if (dto.ip !== undefined) dev.ip = dto.ip?.trim() || null;
      if (dto.location !== undefined) dev.location = dto.location?.trim() || null;
      if (dto.channel !== undefined) dev.channel = dto.channel;
      if (dto.gateIo !== undefined) dev.gateIo = clampGateIo(dto.gateIo, dev.gateIo);
      if (dto.passDirection !== undefined) dev.passDirection = normalizeDirection(dto.passDirection);
      if (dto.enabled !== undefined) dev.enabled = dto.enabled;
    }
    await this.deviceRepo.save(dev);
    const list = await this.listDevices();
    const view = list.find((v) => v.serialno === serialno);
    if (!view) throw new NotFoundException('设备保存失败');
    return view;
  }

  private async resolveDevice(dto: GateOpenDto): Promise<LprDevice> {
    if (dto.deviceId) {
      const d = await this.deviceRepo.findOne({ where: { id: dto.deviceId } });
      if (d) return d;
    }
    if (dto.serialno) {
      const d = await this.deviceRepo.findOne({ where: { serialno: dto.serialno } });
      if (d) return d;
    }
    throw new NotFoundException('未找到对应道闸相机');
  }

  async heartbeat(serialno: string, meta: DeviceMeta): Promise<{ ok: true }> {
    if (!serialno) throw new BadRequestException('serialno 必填');
    await this.touchDevice(serialno, meta);
    return { ok: true };
  }

  // ============================ 识别推送 ============================

  /** 处理 AlarmInfoPlate 推送, 返回相机 HTTP 回复体 */
  async handlePlate(body: AlarmPlateBody, ip?: string | null): Promise<Record<string, unknown>> {
    const alarm = body?.AlarmInfoPlate;
    const result = alarm?.result;
    let list: PlateResultPayload[] = [];
    if (Array.isArray(result?.PlateResult)) list = result.PlateResult;
    else if (result?.PlateResult) list = [result.PlateResult];
    if (list.length === 0) return { Response_AlarmInfoPlate: {} };

    const topSerialno = alarm?.serialno;
    const topChannel = alarm?.channel;
    let openInner: Record<string, unknown> | null = null;
    let continuePush = false;
    let openPlateId: string | number | undefined;

    for (let i = 0; i < list.length; i += 1) {
      const p = list[i];
      const serialno = String(topSerialno ?? p.serialno ?? '').trim();
      if (!serialno) continue;
      const channel = topChannel ?? p.channel ?? null;
      const r = await this.processOne(p, serialno, channel, i, ip ?? null);
      if (r.isOffline) continuePush = true;
      if (r.open && !openInner) {
        openInner = { info: 'ok', plateid: r.plateId, channelNum: r.gateIo, delay: 0 };
        openPlateId = r.plateId;
      }
    }

    const inner: Record<string, unknown> = openInner ?? {};
    if (continuePush) {
      inner.ContinuePushOffline = { plateid: openPlateId ?? list[0]?.plateid ?? '', continue: 1 };
    }
    return { Response_AlarmInfoPlate: inner };
  }

  private async processOne(
    p: PlateResultPayload,
    serialno: string,
    channel: number | null,
    idx: number,
    ip: string | null,
  ): Promise<{ plateId: string; open: boolean; isOffline: boolean; gateIo: number }> {
    const sec = p.timeStamp?.Timeval?.sec;
    const eventTime = sec ? new Date(Number(sec) * 1000) : new Date();
    const plateId = String(p.plateid ?? `${serialno}-${sec ?? Date.now()}-${idx}`);
    const isOffline = Number(p.isoffline ?? 0) === 1;
    const license = normalizePlate(p.license);
    const dev = await this.touchDevice(serialno, { ip, channel, model: null });

    const existing = await this.passRepo.findOne({ where: { plateId } });
    if (existing) {
      // 重传/重发: 幂等, 不重复落库、不重复抬杆; 离线补传让相机继续推
      return { plateId, open: false, isOffline, gateIo: dev.gateIo };
    }

    const picSmall = this.saveSnap(p.imageFragmentFile, serialno, plateId, 'small');
    const picBig = this.saveSnap(p.imageFile, serialno, plateId, 'big');

    // 通行方向以通道配置为准 (现场标定), 无配置则留空
    const passDirection = dev.passDirection;

    // 集中决策: 后端匹配白名单后在回复里开闸 (不依赖相机本地白名单)
    let releaseResult = 'none';
    let open = false;
    if (dev.enabled && !isOffline && license) {
      const wl = await this.findActiveWhitelist(license, eventTime);
      if (wl) {
        if (wl.isBlack) releaseResult = 'deny';
        else {
          releaseResult = 'auto';
          open = true;
        }
      }
    }

    const record = this.passRepo.create({
      plateId,
      serialno,
      channel,
      license: license || '无牌',
      plateType: p.type ?? null,
      plateColor: p.colorType ?? null,
      carColor: p.carColor ?? null,
      carType: p.car_brand?.type ?? null,
      brand: p.car_brand?.brand || null,
      direction: p.direction ?? null,
      confidence: p.confidence ?? null,
      triggerType: p.triggerType ?? null,
      isFake: p.is_fake_plate ?? null,
      isDanger: p.is_danger ?? null,
      isoffline: isOffline ? 1 : 0,
      passDirection,
      releaseResult,
      picSmall,
      picBig,
      eventTime,
      raw: this.trimRaw(p),
    });
    const saved = await this.passRepo.save(record);

    this.bus.publish({
      type: 'lpr_pass',
      serialno,
      license: record.license,
      passDirection: passDirection ?? null,
      releaseResult,
      isFake: record.isFake,
      isDanger: record.isDanger,
      recordId: saved.id,
      at: new Date().toISOString(),
    });

    return { plateId, open, isOffline, gateIo: dev.gateIo };
  }

  // ============================ 道闸状态 ============================

  async handleGateStatus(body: GateStatusBody): Promise<{ ok: true }> {
    const serialno = String(body.serialno ?? body.sn ?? '').trim();
    if (!serialno || body.cmd !== 'barr_gate_status_notify') return { ok: true };
    const gateStatus = Number(body.gate_status);
    if (Number.isNaN(gateStatus)) return { ok: true };
    const connectStatus = body.connect_status === undefined ? null : Number(body.connect_status);
    const enabled = body.enable === undefined ? null : Number(body.enable);
    const dev = await this.touchDevice(serialno, { channel: body.channel ?? null });
    const ev = this.gateRepo.create({
      serialno,
      gateStatus,
      connectStatus: Number.isNaN(connectStatus as number) ? null : connectStatus,
      enabled: Number.isNaN(enabled as number) ? null : enabled,
      eventTime: new Date(),
    });
    await this.gateRepo.save(ev);
    this.bus.publish({
      type: 'lpr_gate_status',
      serialno,
      gateStatus,
      connectStatus: ev.connectStatus,
      at: new Date().toISOString(),
    });
    void dev;
    return { ok: true };
  }

  // ============================ 白名单 ============================

  private async findActiveWhitelist(license: string, at: Date): Promise<LprWhitelist | null> {
    const plate = normalizePlate(license);
    if (!plate) return null;
    const wl = await this.wlRepo.findOne({ where: { plate } });
    if (!wl || !wl.enable) return null;
    if (wl.enableTime && new Date(wl.enableTime) > at) return null;
    if (wl.overdueTime && new Date(wl.overdueTime) < at) return null;
    return wl;
  }

  async listWhitelist(groupName?: string): Promise<LprWhitelist[]> {
    return this.wlRepo.find({
      where: groupName ? { groupName } : {},
      order: { id: 'DESC' },
    });
  }

  async upsertWhitelist(dto: WhitelistUpsertDto, operator = 'admin'): Promise<LprWhitelist> {
    const plate = normalizePlate(dto.plate);
    if (!plate) throw new BadRequestException('车牌号必填');
    const isBlack = !!dto.isBlack || dto.groupName === 'black';
    let wl = await this.wlRepo.findOne({ where: { plate } });
    const before = wl ? { ...wl } : null;
    if (!wl) {
      wl = this.wlRepo.create({ plate });
    }
    wl.groupName = isBlack ? 'black' : dto.groupName || wl.groupName || 'staff';
    wl.isBlack = isBlack;
    wl.enable = dto.enable ?? true;
    wl.enableTime = dto.enableTime ? new Date(dto.enableTime) : null;
    wl.overdueTime = dto.overdueTime ? new Date(dto.overdueTime) : null;
    wl.remark = dto.remark ?? null;
    wl.syncState = 'pending';
    const saved = await this.wlRepo.save(wl);
    // 短轮询: 白名单置为 pending, 在线相机下一轮 comet (~1s) 即拉取, 无需唤醒长连接。
    await this.audit.record({
      entityType: 'device',
      entityId: `lpr-wl:${plate}`,
      action: before ? 'update' : 'create',
      operator,
      snapshotBefore: before,
      snapshotAfter: { plate: saved.plate, groupName: saved.groupName, isBlack: saved.isBlack, enable: saved.enable },
      remark: '车牌白名单维护',
    });
    return saved;
  }

  async removeWhitelist(id: number, operator = 'admin'): Promise<{ ok: true }> {
    const wl = await this.wlRepo.findOne({ where: { id } });
    if (!wl) throw new NotFoundException('白名单记录不存在');
    // 通知所有相机删除本地该车牌 (后端集中放行不依赖此步, 仅用于脱机白名单)
    await this.broadcastInner({
      white_list_operate: { operate_type: 1, white_list_data: [{ plate: wl.plate }] },
    });
    await this.audit.record({
      entityType: 'device',
      entityId: `lpr-wl:${wl.plate}`,
      action: 'delete',
      operator,
      snapshotBefore: { plate: wl.plate, groupName: wl.groupName },
      remark: '删除车牌白名单',
    });
    await this.wlRepo.remove(wl);
    return { ok: true };
  }

  /** 组装待下发白名单 (≤5 条), 组装后标记已下发 (阶段0: 下发给本次轮询相机) */
  private async takeWhitelistInner(): Promise<Record<string, unknown> | null> {
    const pending = await this.wlRepo.find({ where: { syncState: 'pending' }, order: { id: 'ASC' }, take: WL_BATCH });
    if (pending.length === 0) return null;
    const whiteListData = pending.map((w) => ({
      plate: w.plate,
      enable: w.enable ? 1 : 0,
      need_alarm: w.isBlack ? 1 : 0,
      ...(w.enableTime ? { enable_time: fmtDateTime(new Date(w.enableTime)) } : {}),
      ...(w.overdueTime ? { overdue_time: fmtDateTime(new Date(w.overdueTime)) } : {}),
    }));
    for (const w of pending) {
      w.syncState = 'synced';
      await this.wlRepo.save(w);
    }
    return { white_list_operate: { operate_type: 0, white_list_data: whiteListData } };
  }

  // ============================ 远程开闸 + comet ============================

  async openGate(dto: GateOpenDto, operator = 'pwa'): Promise<{ delivered: boolean; queued: boolean; serialno: string; deviceName: string }> {
    const dev = await this.resolveDevice(dto);
    const inner = { info: 'ok', channelNum: dev.gateIo, delay: dto.delay ?? 0 };
    // 短轮询: 命令入队, 由相机下一次 comet 轮询 (~1s) 取走, 保证不因子连接早断而丢失。
    const delivered = this.enqueueCommand(dev.serialno, inner);
    await this.audit.record({
      entityType: 'device',
      entityId: `lpr-gate:${dev.serialno}`,
      action: 'update',
      operator,
      snapshotAfter: { action: 'open_gate', channelNum: dev.gateIo, reason: dto.reason ?? null },
      remark: `远程开闸 ${dev.deviceName}${dto.reason ? ` ${dto.reason}` : ''}`,
    });
    this.bus.publish({
      type: 'lpr_gate_command',
      serialno: dev.serialno,
      delivered,
      queued: !delivered,
      operator,
      at: new Date().toISOString(),
    });
    return { delivered, queued: !delivered, serialno: dev.serialno, deviceName: dev.deviceName };
  }

  /**
   * 相机 comet 短轮询: 立即返回待发命令 / 白名单, 无则回空。
   * XLT 固件以 ~1s 周期轮询并在服务端立即响应后重连; 不挂长连接, 命令一律持久化在队列中
   * 由下一次轮询取走 (端到端延迟 ≤ 轮询周期), 从而避免"僵尸长连接吞命令"和大量 499 堆积。
   */
  async cometPoll(serialno: string, meta: DeviceMeta = {}): Promise<Record<string, unknown>> {
    if (!serialno) throw new BadRequestException('serialno 必填');
    await this.touchDevice(serialno, meta);

    let inner = this.shiftQueue(serialno);
    const wlInner = await this.takeWhitelistInner();
    if (wlInner) inner = { ...(inner ?? {}), ...wlInner };
    return { Response_AlarmInfoPlate: inner ?? {} };
  }

  private shiftQueue(serialno: string): Record<string, unknown> | null {
    const q = this.queues.get(serialno);
    if (q && q.length > 0) return q.shift() ?? null;
    return null;
  }

  /** 命令入队 (短轮询下统一走持久化队列, 相机下一次轮询取走); 返回 false 表示未走长连接即时投递 */
  private enqueueCommand(serialno: string, inner: Record<string, unknown>): boolean {
    const q = this.queues.get(serialno) ?? [];
    q.push(inner);
    this.queues.set(serialno, q);
    return false;
  }

  /** 向所有已登记相机的 comet 队列各广播一条内层指令 (如删除本地白名单); 相机下一轮轮询取走 */
  private async broadcastInner(inner: Record<string, unknown>): Promise<void> {
    const devs = await this.deviceRepo.find({ select: { id: true, serialno: true } });
    for (const d of devs) this.enqueueCommand(d.serialno, inner);
  }

  // ============================ 查询 / 统计 ============================

  async recent(limit = 20): Promise<PassRecordView[]> {
    const rows = await this.passRepo.find({ order: { id: 'DESC' }, take: Math.min(Number(limit) || 20, 100) });
    return rows.map((r) => this.toView(r));
  }

  async records(q: { plate?: string; serialno?: string; date?: string; limit?: number; offset?: number }): Promise<{ list: PassRecordView[]; total: number }> {
    const take = Math.min(Number(q.limit) || 50, 200);
    const skip = Number(q.offset) || 0;
    const where: Record<string, unknown> = {};
    if (q.plate) where.license = normalizePlate(q.plate);
    if (q.serialno) where.serialno = q.serialno;
    if (q.date) {
      const start = new Date(`${q.date}T00:00:00`);
      const end = new Date(`${q.date}T23:59:59.999`);
      where.createdAt = Between(start, end);
    }
    const [rows, total] = await this.passRepo.findAndCount({ where, order: { id: 'DESC' }, take, skip });
    return { list: rows.map((r) => this.toView(r)), total };
  }

  async stats(): Promise<LprStats> {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = await this.passRepo.find({ where: { createdAt: MoreThan(start) }, order: { id: 'DESC' } });
    const todayIn = today.filter((r) => r.passDirection === 'in');
    const todayOut = today.filter((r) => r.passDirection === 'out');
    const totalIn = await this.passRepo.count({ where: { passDirection: 'in' } });
    const totalOut = await this.passRepo.count({ where: { passDirection: 'out' } });
    const visitorPlates = new Set(
      (await this.wlRepo.find({ where: { groupName: 'visitor' } })).map((w) => w.plate),
    );
    const visitor = todayIn.filter((r) => visitorPlates.has(r.license)).length;
    const abnormal = today.filter(
      (r) => r.isFake === 1 || r.isDanger === 1 || r.releaseResult === 'deny',
    ).length;
    return {
      todayIn: todayIn.length,
      todayOut: todayOut.length,
      onsite: Math.max(0, totalIn - totalOut),
      visitor,
      abnormal,
      autoReleased: today.filter((r) => r.releaseResult === 'auto').length,
      totalToday: today.length,
    };
  }

  private toView(r: LprPassRecord): PassRecordView {
    return {
      id: r.id,
      plateId: r.plateId,
      serialno: r.serialno,
      channel: r.channel,
      license: r.license,
      plateType: r.plateType,
      plateTypeLabel: plateTypeLabel(r.plateType),
      plateColor: r.plateColor,
      plateColorLabel: plateColorLabel(r.plateColor),
      carColor: r.carColor,
      carColorLabel: carColorLabel(r.carColor),
      carType: r.carType,
      carTypeLabel: carTypeLabel(r.carType),
      brand: r.brand,
      direction: r.direction,
      directionLabel: directionLabel(r.direction),
      confidence: r.confidence,
      triggerType: r.triggerType,
      triggerTypeLabel: triggerTypeLabel(r.triggerType),
      isFake: r.isFake,
      isDanger: r.isDanger,
      isOffline: r.isoffline,
      passDirection: r.passDirection,
      releaseResult: r.releaseResult,
      picSmallUrl: r.picSmall ? `/api/lpr/snaps/${r.id}/small` : null,
      picBigUrl: r.picBig ? `/api/lpr/snaps/${r.id}/big` : null,
      eventTime: r.eventTime ? new Date(r.eventTime).toISOString() : null,
    };
  }

  // ============================ 抓拍图 ============================

  private saveSnap(b64: string | undefined, serialno: string, plateId: string, kind: 'small' | 'big'): string | null {
    if (!b64) return null;
    try {
      const buf = Buffer.from(b64, 'base64');
      if (buf.length === 0 || buf.length > MAX_SNAP_BYTES) return null;
      const dir = join(this.snapRoot, this.safeSeg(serialno));
      mkdirSync(dir, { recursive: true });
      const rel = join(this.safeSeg(serialno), `${this.safeSeg(String(plateId))}-${kind}.jpg`);
      writeFileSync(join(this.snapRoot, rel), buf);
      return rel;
    } catch (e) {
      this.logger.warn(`抓拍图保存失败 ${kind}: ${(e as Error).message}`);
      return null;
    }
  }

  async readSnap(recordId: number, kind: 'small' | 'big'): Promise<Buffer> {
    const r = await this.passRepo.findOne({ where: { id: recordId } });
    if (!r) throw new NotFoundException('记录不存在');
    const rel = kind === 'big' ? r.picBig : r.picSmall;
    if (!rel) throw new NotFoundException('该记录无抓拍图');
    const abs = normalize(join(this.snapRoot, rel));
    if (!abs.startsWith(this.snapRoot)) throw new BadRequestException('非法路径');
    if (!existsSync(abs)) throw new NotFoundException('抓拍图文件缺失');
    return readFileSync(abs);
  }

  private safeSeg(s: string): string {
    return s.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  private trimRaw(p: PlateResultPayload): string {
    try {
      const clone: Record<string, unknown> = { ...p };
      delete clone.imageFile;
      delete clone.imageFragmentFile;
      delete clone.binImageFile;
      const json = JSON.stringify(clone);
      return json.length > 20000 ? `${json.slice(0, 20000)}…` : json;
    } catch {
      return null as unknown as string;
    }
  }
}
