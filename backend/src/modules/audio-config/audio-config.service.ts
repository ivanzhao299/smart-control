import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { AudioOutputZone } from '../../entities/audio-output-zone.entity';
import { AudioScene } from '../../entities/audio-scene.entity';

export interface AudioZoneUpsertDto {
  channel?: number;
  name?: string;
  floor?: string | null;
  color?: string | null;
  sortOrder?: number;
  enabled?: boolean;
}

export interface AudioSceneUpsertDto {
  presetNum?: number;
  name?: string;
  hint?: string | null;
  sortOrder?: number;
  enabled?: boolean;
}

/** 默认 8 输出通道: OUT1-OUT8 (channel 0-7), 业主后续改名 */
const DEFAULT_ZONES = Array.from({ length: 8 }, (_, i) => ({
  channel: i,
  name: `OUT ${i + 1}`,
  floor: null as string | null,
  color: null as string | null,
  sortOrder: i,
}));

/** 默认 12 场景 (U01-U12), 名字跟原前端硬编码一致, 业主后续改 */
const DEFAULT_SCENES: Array<{ presetNum: number; name: string; hint: string }> = [
  { presetNum: 1, name: '早班接待', hint: '8-10 点全场低音量 BGM' },
  { presetNum: 2, name: '日常运营', hint: '10-17 点标准音量' },
  { presetNum: 3, name: '路演演讲', hint: 'LED 区主声道' },
  { presetNum: 4, name: '大型发布会', hint: '全场开 + 突出' },
  { presetNum: 5, name: '会议室独立', hint: 'ZONE 8 独立 + AEC' },
  { presetNum: 6, name: '跟随讲解', hint: 'WTG-800 自动激活' },
  { presetNum: 7, name: '政府接待 VIP', hint: '全场 +0dB' },
  { presetNum: 8, name: '夜间静音', hint: '18-8 点全静音' },
  { presetNum: 9, name: '应急广播', hint: '消防/疏散最大声' },
  { presetNum: 10, name: '大屏视频', hint: 'ZONE 1 + SUB12' },
  { presetNum: 11, name: '自定义 1', hint: '备用' },
  { presetNum: 12, name: '自定义 2', hint: '备用' },
];

@Injectable()
export class AudioConfigService implements OnModuleInit {
  constructor(
    @InjectRepository(AudioOutputZone) private readonly zoneRepo: Repository<AudioOutputZone>,
    @InjectRepository(AudioScene) private readonly sceneRepo: Repository<AudioScene>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /** 启动 seed: 表空时插默认 8 通道 + 12 场景. 不覆盖业主改过的 */
  async onModuleInit(): Promise<void> {
    if ((await this.zoneRepo.count()) === 0) {
      await this.zoneRepo.save(DEFAULT_ZONES.map((z) => this.zoneRepo.create(z)));
      this.logger.info('[AudioConfig] seeded 8 输出通道 (OUT1-OUT8)');
    }
    if ((await this.sceneRepo.count()) === 0) {
      await this.sceneRepo.save(
        DEFAULT_SCENES.map((s, i) => this.sceneRepo.create({ ...s, sortOrder: i })),
      );
      this.logger.info('[AudioConfig] seeded 12 场景 (U01-U12)');
    }
  }

  // ============ 输出通道 ============

  async listZones(includeDisabled = false): Promise<AudioOutputZone[]> {
    const qb = this.zoneRepo.createQueryBuilder('z').orderBy('z.sortOrder', 'ASC').addOrderBy('z.channel', 'ASC');
    if (!includeDisabled) qb.where('z.enabled = :e', { e: true });
    return qb.getMany();
  }

  async upsertZone(id: number | null, dto: AudioZoneUpsertDto): Promise<AudioOutputZone> {
    let row = id ? await this.zoneRepo.findOne({ where: { id } }) : null;
    if (id && !row) throw new NotFoundException(`输出通道不存在: id=${id}`);
    if (!row) {
      if (typeof dto.channel !== 'number') throw new Error('channel 必填');
      row = this.zoneRepo.create({ channel: dto.channel, name: dto.name ?? `OUT ${dto.channel + 1}` });
    }
    if (dto.channel !== undefined) {
      if (dto.channel < 0 || dto.channel > 7) throw new Error('channel 必须 0-7');
      row.channel = dto.channel;
    }
    if (dto.name !== undefined) {
      const v = dto.name.trim();
      if (!v) throw new Error('名称不能为空');
      row.name = v.slice(0, 64);
    }
    if (dto.floor !== undefined) row.floor = dto.floor?.trim() || null;
    if (dto.color !== undefined) row.color = dto.color?.trim() || null;
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    return this.zoneRepo.save(row);
  }

  async deleteZone(id: number): Promise<{ removedId: number }> {
    const row = await this.zoneRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`输出通道不存在: id=${id}`);
    await this.zoneRepo.remove(row);
    return { removedId: id };
  }

  // ============ 场景 ============

  async listScenes(includeDisabled = false): Promise<AudioScene[]> {
    const qb = this.sceneRepo.createQueryBuilder('s').orderBy('s.sortOrder', 'ASC').addOrderBy('s.presetNum', 'ASC');
    if (!includeDisabled) qb.where('s.enabled = :e', { e: true });
    return qb.getMany();
  }

  async upsertScene(id: number | null, dto: AudioSceneUpsertDto): Promise<AudioScene> {
    let row = id ? await this.sceneRepo.findOne({ where: { id } }) : null;
    if (id && !row) throw new NotFoundException(`场景不存在: id=${id}`);
    if (!row) {
      if (typeof dto.presetNum !== 'number') throw new Error('presetNum 必填');
      row = this.sceneRepo.create({ presetNum: dto.presetNum, name: dto.name ?? `U${String(dto.presetNum).padStart(2, '0')}` });
    }
    if (dto.presetNum !== undefined) {
      if (dto.presetNum < 1 || dto.presetNum > 12) throw new Error('presetNum 必须 1-12');
      row.presetNum = dto.presetNum;
    }
    if (dto.name !== undefined) {
      const v = dto.name.trim();
      if (!v) throw new Error('名称不能为空');
      row.name = v.slice(0, 64);
    }
    if (dto.hint !== undefined) row.hint = dto.hint?.trim() || null;
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    return this.sceneRepo.save(row);
  }

  async deleteScene(id: number): Promise<{ removedId: number }> {
    const row = await this.sceneRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`场景不存在: id=${id}`);
    await this.sceneRepo.remove(row);
    return { removedId: id };
  }
}
