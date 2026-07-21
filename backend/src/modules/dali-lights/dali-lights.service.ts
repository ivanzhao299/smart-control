import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { In, Repository } from 'typeorm';
import { Logger } from 'winston';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';
import { DaliLight } from '../../entities/dali-light.entity';
import { LightScene } from '../../entities/light-scene.entity';
import { LightSceneItem } from '../../entities/light-scene-item.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';

export interface LightCmd {
  on?: boolean;
  brightness?: number; // 0-100
  kelvin?: number; // 2500-6500
}

export interface GatewayRef {
  code: string;
  slaveId: number;
}

/**
 * DALI 单灯管理 —— 软件层的查找/命名/分组/场景, 灯里不写任何东西。
 *
 * 控制模型: 一切最终落到"对 (slaveId, shortAddr) 直控"。分区控制 = 遍历区内灯逐盏直控;
 * 场景调用 = 遍历场景项(灯或区)逐个下发。都不依赖 DALI 硬件组。
 */
@Injectable()
export class DaliLightsService {
  private gwCache: { list: GatewayRef[]; at: number } = { list: [], at: 0 };
  private readonly GW_CACHE_TTL_MS = 5000;

  constructor(
    private readonly lighting: LightingAdapter,
    @InjectRepository(DaliLight) private readonly lightRepo: Repository<DaliLight>,
    @InjectRepository(LightScene) private readonly sceneRepo: Repository<LightScene>,
    @InjectRepository(LightSceneItem) private readonly sceneItemRepo: Repository<LightSceneItem>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  // ============ 网关 ============

  /** DALI 网关列表 (code + slaveId), 从 hardware_unit category='dali-gateway' 读, 5s 缓存 */
  async getGateways(): Promise<GatewayRef[]> {
    const now = Date.now();
    if (now - this.gwCache.at < this.GW_CACHE_TTL_MS) return this.gwCache.list;
    const rows = await this.hwRepo.find({ where: { category: 'dali-gateway' } });
    const list: GatewayRef[] = [];
    for (const row of rows) {
      if (!row.enabled) continue;
      let slaveId = 1;
      if (row.addressing) {
        try {
          const a = JSON.parse(row.addressing) as { slaveId?: number };
          if (typeof a.slaveId === 'number') slaveId = a.slaveId;
        } catch {
          /* 非 JSON 用默认 1 */
        }
      }
      list.push({ code: row.code, slaveId });
    }
    // 没有配网关时, 退化给一台默认(mock/单网关现场也能用)
    if (list.length === 0) list.push({ code: 'GW-DALI-1', slaveId: 1 });
    this.gwCache = { list, at: now };
    return list;
  }

  private async slaveIdOf(gatewayCode: string): Promise<number> {
    const gw = (await this.getGateways()).find((g) => g.code === gatewayCode);
    return gw?.slaveId ?? 1;
  }

  // ============ 扫描发现 ============

  /**
   * 扫描一台或全部网关的 64 短地址, 把发现的灯 upsert 进 dali_light。
   * 在线的: 建/更新 online=true; 曾发现过但这次不在线的: 更新 online=false; 从没见过的空地址: 跳过。
   */
  async scan(gatewayCode?: string): Promise<{ scanned: number; found: number; lights: DaliLight[] }> {
    const gws = (await this.getGateways()).filter((g) => !gatewayCode || g.code === gatewayCode);
    let found = 0;
    const seenAt = new Date();
    for (const gw of gws) {
      let online: boolean[];
      let fault: boolean[];
      try {
        ({ online, fault } = await this.lighting.scanGateway(gw.slaveId));
      } catch (err) {
        this.logger.warn(`扫描网关 ${gw.code} 失败: ${(err as Error).message}`, {
          context: 'DaliLightsService',
        });
        continue;
      }
      const existing = await this.lightRepo.find({ where: { gatewayCode: gw.code } });
      const byShort = new Map(existing.map((l) => [l.shortAddr, l]));
      for (let i = 0; i < 64; i += 1) {
        const short = i + 1;
        const isOnline = online[i] === true;
        const isFault = fault[i] === true;
        const prev = byShort.get(short);
        if (!isOnline && !prev) continue; // 空地址且从没见过 → 不建
        if (isOnline) found += 1;
        if (prev) {
          await this.lightRepo.update(
            { id: prev.id },
            { online: isOnline, fault: isFault, lastSeenAt: isOnline ? seenAt : prev.lastSeenAt },
          );
        } else {
          await this.lightRepo.save(
            this.lightRepo.create({
              gatewayCode: gw.code,
              shortAddr: short,
              online: isOnline,
              fault: isFault,
              lastSeenAt: seenAt,
            }),
          );
        }
      }
    }
    return { scanned: gws.length, found, lights: await this.list() };
  }

  // ============ 查询 ============

  async list(): Promise<DaliLight[]> {
    return this.lightRepo.find({ order: { gatewayCode: 'ASC', shortAddr: 'ASC' } });
  }

  private async getLightOrThrow(id: number): Promise<DaliLight> {
    const l = await this.lightRepo.findOne({ where: { id } });
    if (!l) throw new NotFoundException(`灯不存在: id=${id}`);
    return l;
  }

  // ============ 命名 / 分组 ============

  async rename(id: number, name: string): Promise<DaliLight> {
    const l = await this.getLightOrThrow(id);
    l.name = (name ?? '').trim() || null;
    return this.lightRepo.save(l);
  }

  /** 分到某分区(light_zone.code); null 或空 = 移出分区 */
  async assignZone(id: number, zoneCode: string | null): Promise<DaliLight> {
    const l = await this.getLightOrThrow(id);
    l.zoneCode = (zoneCode ?? '').trim() || null;
    return this.lightRepo.save(l);
  }

  /** 批量分区 (前端多选后一次性分组) */
  async assignZoneBatch(ids: number[], zoneCode: string | null): Promise<number> {
    const z = (zoneCode ?? '').trim() || null;
    const res = await this.lightRepo.update(ids.length ? { id: In(ids) } : {}, { zoneCode: z });
    return res.affected ?? 0;
  }

  // ============ 控制 ============

  /** 单灯直控 */
  async setLight(id: number, cmd: LightCmd): Promise<{ id: number; ok: boolean; error?: string }> {
    const l = await this.getLightOrThrow(id);
    const slaveId = await this.slaveIdOf(l.gatewayCode);
    const deviceId = JSON.stringify({ slaveId, short: l.shortAddr });
    let res;
    if (cmd.on === false) {
      res = await this.lighting.turnOff(deviceId);
    } else if (cmd.brightness != null || cmd.kelvin != null) {
      res = await this.lighting.setBrightness(deviceId, {
        value: cmd.brightness ?? 100,
        ...(cmd.kelvin != null ? { kelvin: cmd.kelvin } : {}),
      } as { value?: number; kelvin?: number });
    } else {
      res = await this.lighting.turnOn(deviceId);
    }
    return { id, ok: res.ok, error: res.error };
  }

  /** 闪烁识别 */
  async identify(id: number): Promise<{ id: number; ok: true }> {
    const l = await this.getLightOrThrow(id);
    const slaveId = await this.slaveIdOf(l.gatewayCode);
    await this.lighting.identifyLight(slaveId, l.shortAddr);
    return { id, ok: true };
  }

  /** 分区控制: 遍历区内灯逐盏直控 (串行, 避免同网关帧插队) */
  async controlZone(
    zoneCode: string,
    cmd: LightCmd,
  ): Promise<{ zoneCode: string; total: number; ok: number }> {
    const lights = await this.lightRepo.find({ where: { zoneCode, enabled: true } });
    let ok = 0;
    for (const l of lights) {
      const r = await this.setLight(l.id, cmd).catch((e) => ({ id: l.id, ok: false, error: String(e) }));
      if (r.ok) ok += 1;
    }
    return { zoneCode, total: lights.length, ok };
  }

  // ============ 场景 ============

  async listScenes(): Promise<Array<LightScene & { items: LightSceneItem[] }>> {
    const scenes = await this.sceneRepo.find({ where: { enabled: true }, order: { sortOrder: 'ASC', id: 'ASC' } });
    const out: Array<LightScene & { items: LightSceneItem[] }> = [];
    for (const s of scenes) {
      const items = await this.sceneItemRepo.find({ where: { sceneCode: s.code } });
      out.push({ ...s, items });
    }
    return out;
  }

  async createScene(input: {
    name: string;
    floor?: string | null;
    icon?: string | null;
    items?: Array<Pick<LightSceneItem, 'targetType' | 'targetRef' | 'on' | 'brightness' | 'kelvin'>>;
  }): Promise<LightScene> {
    const name = (input.name ?? '').trim();
    if (!name) throw new BadRequestException('场景名必填');
    const code = `ls-${Date.now()}`;
    const scene = await this.sceneRepo.save(
      this.sceneRepo.create({ code, name, floor: input.floor ?? null, icon: input.icon ?? null }),
    );
    await this.saveSceneItems(code, input.items ?? []);
    return scene;
  }

  async updateScene(
    code: string,
    input: {
      name?: string;
      floor?: string | null;
      icon?: string | null;
      items?: Array<Pick<LightSceneItem, 'targetType' | 'targetRef' | 'on' | 'brightness' | 'kelvin'>>;
    },
  ): Promise<LightScene> {
    const scene = await this.sceneRepo.findOne({ where: { code } });
    if (!scene) throw new NotFoundException(`场景不存在: ${code}`);
    if (input.name != null) scene.name = input.name.trim() || scene.name;
    if (input.floor !== undefined) scene.floor = input.floor;
    if (input.icon !== undefined) scene.icon = input.icon;
    await this.sceneRepo.save(scene);
    if (input.items) {
      await this.sceneItemRepo.delete({ sceneCode: code });
      await this.saveSceneItems(code, input.items);
    }
    return scene;
  }

  async deleteScene(code: string): Promise<void> {
    await this.sceneItemRepo.delete({ sceneCode: code });
    await this.sceneRepo.delete({ code });
  }

  private async saveSceneItems(
    sceneCode: string,
    items: Array<Pick<LightSceneItem, 'targetType' | 'targetRef' | 'on' | 'brightness' | 'kelvin'>>,
  ): Promise<void> {
    for (const it of items) {
      await this.sceneItemRepo.save(
        this.sceneItemRepo.create({
          sceneCode,
          targetType: it.targetType,
          targetRef: it.targetRef,
          on: it.on ?? true,
          brightness: it.brightness ?? null,
          kelvin: it.kelvin ?? null,
        }),
      );
    }
  }

  /** 调用场景: 遍历所有项, 灯直控 / 区展开成灯 */
  async recallScene(code: string): Promise<{ code: string; total: number; ok: number }> {
    const items = await this.sceneItemRepo.find({ where: { sceneCode: code } });
    if (items.length === 0) throw new NotFoundException(`场景无内容或不存在: ${code}`);
    let ok = 0;
    let total = 0;
    for (const it of items) {
      const cmd: LightCmd = { on: it.on, brightness: it.brightness ?? undefined, kelvin: it.kelvin ?? undefined };
      if (it.targetType === 'zone') {
        const r = await this.controlZone(it.targetRef, cmd);
        total += r.total;
        ok += r.ok;
      } else {
        // 'light': targetRef = 'gatewayCode:short'
        const [gw, shortStr] = it.targetRef.split(':');
        const light = await this.lightRepo.findOne({ where: { gatewayCode: gw, shortAddr: Number(shortStr) } });
        if (light) {
          total += 1;
          const r = await this.setLight(light.id, cmd).catch(() => ({ ok: false }));
          if (r.ok) ok += 1;
        }
      }
    }
    return { code, total, ok };
  }
}
