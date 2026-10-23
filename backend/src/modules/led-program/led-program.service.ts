import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { Repository } from 'typeorm';
import { LedProgram } from '../../entities/led-program.entity';
import { LedProgramSegment } from '../../entities/led-program-segment.entity';
import { Device } from '../../entities/device.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { LedProgramConfig } from '../../common/config/configuration';
import type { Actor } from '../../common/auth/actor';

export interface SegmentInput {
  type: 'text' | 'video';
  text?: string;
  template?: string;
  color?: string;
  videoName?: string;
  durationMs?: number;
}

export interface IngestMeta {
  name: string;
  cycles?: number;
  fps?: number;
  durationS?: number;
  autoPush?: boolean;
  segments?: SegmentInput[];
}

const BIN_MAGIC = Buffer.from('HZFLWZM\x00');

/**
 * LED 节目 bin 服务：页面端真生成 bin → 存盘(非系统盘) → 入库 → 转发 PVE 推流。
 * 不触碰 Smart Control 其他模块；bin 校验与 PVE receiver 同一套（魔数 + @0x30 布局偏移）。
 */
@Injectable()
export class LedProgramService {
  private readonly logger = new Logger(LedProgramService.name);
  private readonly cfg: LedProgramConfig;

  constructor(
    config: ConfigService,
    @InjectRepository(LedProgram)
    private readonly programRepo: Repository<LedProgram>,
    @InjectRepository(LedProgramSegment)
    private readonly segmentRepo: Repository<LedProgramSegment>,
    @InjectRepository(Device)
    private readonly deviceRepo: Repository<Device>,
    @InjectRepository(HardwareUnit)
    private readonly hwRepo: Repository<HardwareUnit>,
  ) {
    this.cfg = config.getOrThrow<LedProgramConfig>('ledProgram');
    mkdirSync(this.cfg.storageDir, { recursive: true });
  }

  /**
   * 解析 PVE 接收端 base URL：优先硬件清单 hardware_units (code=PVE-REC-01, addressing.url)，
   * 其次 devices 表 adapter='pve-receiver'，最后 env PVE_BIN_BASE_URL。
   * 在硬件明细页改 IP/端口即生效，不必改 .env。
   */
  private async pveBaseUrl(): Promise<string> {
    try {
      const hw = await this.hwRepo.findOne({ where: { code: 'PVE-REC-01', enabled: true } });
      if (hw?.addressing) {
        try {
          const addr = JSON.parse(hw.addressing);
          if (addr?.url) return String(addr.url).replace(/\/+$/, '');
        } catch { /* 忽略 JSON 解析失败，回退下一级 */ }
      }
      if (hw?.ip) return `http://${hw.ip}:8080`;
    } catch (e) {
      this.logger.warn(`读 PVE 硬件清单行失败: ${(e as Error).message}`);
    }
    try {
      const dev = await this.deviceRepo.findOne({
        where: { adapter: 'pve-receiver', enabled: true },
        order: { id: 'ASC' },
      });
      if (dev?.address) return dev.address.replace(/\/+$/, '');
      if (dev?.ip) return `http://${dev.ip}:8080`;
    } catch (e) {
      this.logger.warn(`读 PVE 设备行失败，回退 env: ${(e as Error).message}`);
    }
    return this.cfg.pveBaseUrl;
  }

  /** 校验 bin：魔数 + @0x30 布局偏移落在文件内 */
  private validateBin(buf: Buffer): { cycles: number; frames: number; layOff: number } {
    if (buf.length < 0x40 || !buf.subarray(0, 8).equals(BIN_MAGIC)) {
      throw new BadRequestException('bin 魔数不符（期望 HZFLWZM\\0），非勇电节目文件');
    }
    const layOff = buf.readUInt32LE(0x30);
    if (layOff < 0x40 || layOff > buf.length) {
      throw new BadRequestException(`bin 布局偏移越界: 0x${layOff.toString(16)} > 0x${buf.length.toString(16)}`);
    }
    const cycles = buf.readUInt16LE(0x20);
    const frames = Math.floor((layOff - 1536) / 33792);
    if (frames <= 0 || frames > 100_000) {
      throw new BadRequestException(`bin 帧数异常: ${frames}`);
    }
    return { cycles, frames, layOff };
  }

  async ingest(
    file: Express.Multer.File,
    meta: IngestMeta,
    actor: Actor,
  ): Promise<{ program: LedProgram; md5: string; frames: number; pushed: boolean; pushMsg?: string }> {
    if (!file?.buffer) throw new BadRequestException('未收到 bin 文件');
    const buf = file.buffer;
    const MAX_BIN = 256 * 1024 * 1024; // 256MB 硬上限
    if (buf.length > MAX_BIN) {
      throw new BadRequestException(`bin 文件过大: ${(buf.length / 1024 / 1024).toFixed(1)}MB > 256MB 上限`);
    }
    const info = this.validateBin(buf);

    const md5 = createHash('md5').update(buf).digest('hex');
    const dst = join(this.cfg.storageDir, `${md5}.bin`);
    if (!existsSync(dst)) {
      writeFileSync(dst, buf);
      this.logger.log(`bin 已存盘: ${dst} (${buf.length}B, ${info.frames} 帧)`);
    } else {
      this.logger.log(`bin 已存在复用: ${dst}`);
    }

    const cycles = meta.cycles ?? info.cycles;
    const fps = meta.fps ?? 25;
    const program = await this.programRepo.save(this.programRepo.create({
      name: meta.name || basename(file.originalname || 'program.bin'),
      contentJson: meta.segments?.length ? JSON.stringify(meta.segments) : null,
      binPath: dst,
      fileSize: buf.length,
      md5,
      cycles,
      fps,
      durationS: meta.durationS ?? Math.round(info.frames / fps),
      createdBy: actor.username,
    }));

    const segments = (meta.segments ?? []).map((s, i) => this.segmentRepo.create({
      programId: program.id,
      seq: i,
      type: s.type,
      text: s.text ?? null,
      template: s.template ?? null,
      color: s.color ?? null,
      videoName: s.videoName ?? null,
      durationMs: s.durationMs ?? null,
    }));
    if (segments.length) await this.segmentRepo.save(segments);

    if (meta.autoPush) {
      const r = await this.forwardBin(program);
      return { program, md5, frames: info.frames, pushed: r.ok === true, pushMsg: r.msg };
    }
    return { program, md5, frames: info.frames, pushed: false };
  }

  /** 转发 bin 到 PVE receiver（POST /bin，raw binary + X-Bin-* headers，auto_push=1 自动推流） */
  async forwardBin(program: LedProgram): Promise<{ ok: boolean; msg?: string }> {
    const buf = readFileSync(program.binPath);
    const base = await this.pveBaseUrl();
    const token = this.cfg.pveBinToken;
    const headers: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'X-Bin-Name': `${program.md5}.bin`,
      'X-Bin-Meta': JSON.stringify({ name: program.name, cycles: program.cycles, fps: program.fps }),
      'X-Bin-Auto-Push': '1',
    };
    if (token) headers['X-Bin-Token'] = token;
    try {
      const res = await fetch(`${base}/bin`, {
        method: 'POST',
        headers,
        body: new Uint8Array(buf),
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; msg?: string; error?: string; frames?: number };
      if (!res.ok || body.ok !== true) {
        return { ok: false, msg: body.error || `PVE 返回 ${res.status}` };
      }
      return { ok: true, msg: `PVE 已接收并推流（${body.frames ?? '?'} 帧）` };
    } catch (e) {
      return { ok: false, msg: `PVE 转发失败: ${(e as Error).message}` };
    }
  }

  /** 推流：先把 bin 转发到 PVE（/bin auto_push=1），receiver 收到后自动开始组播推流 */
  async push(programId: number): Promise<{ ok: boolean; msg?: string }> {
    const program = await this.programRepo.findOne({ where: { id: programId } });
    if (!program) throw new NotFoundException('节目不存在');
    // 先转发 bin 到 PVE（auto_push=1，receiver 收到即推流）
    return this.forwardBin(program);
  }

  async history(limit = 50): Promise<Array<LedProgram & { segments: LedProgramSegment[] }>> {
    const programs = await this.programRepo.find({
      order: { id: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    const ids = programs.map((p) => p.id);
    const segments = ids.length
      ? await this.segmentRepo.find({ where: { programId: ids.length === 1 ? ids[0] : undefined } })
      : [];
    // 兼容单/多 id 查询：段表按 programId 分组
    const segByPid = new Map<number, LedProgramSegment[]>();
    if (ids.length === 1) {
      segByPid.set(ids[0], segments);
    } else if (segments.length) {
      for (const s of segments) {
        const arr = segByPid.get(s.programId) ?? [];
        arr.push(s);
        segByPid.set(s.programId, arr);
      }
    }
    return programs.map((p) => ({ ...p, segments: segByPid.get(p.id) ?? [] }));
  }

  /** PVE 连通/状态探测（3s 超时，失败不抛） */
  async status(): Promise<{ reachable: boolean; detail?: Record<string, unknown>; error?: string; base?: string }> {
    try {
      const base = await this.pveBaseUrl();
      const res = await fetch(`${base}/status`, {
        headers: this.cfg.pveBinToken ? { 'X-Bin-Token': this.cfg.pveBinToken } : {},
        signal: AbortSignal.timeout(3_000),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { reachable: res.ok === true, detail: body, base };
    } catch (e) {
      return { reachable: false, error: (e as Error).message };
    }
  }
}
