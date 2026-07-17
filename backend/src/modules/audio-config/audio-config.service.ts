import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { AudioOutputZone } from '../../entities/audio-output-zone.entity';
import { AudioInputSource } from '../../entities/audio-input-source.entity';
import { AudioScene } from '../../entities/audio-scene.entity';
import type { SceneContent, SceneOutputConfig } from '../../adapters/audio/ekx808.adapter';

export interface AudioZoneUpsertDto {
  channel?: number;
  name?: string;
  floor?: string | null;
  color?: string | null;
  sortOrder?: number;
  enabled?: boolean;
}

export interface AudioInputUpsertDto {
  channel?: number;
  name?: string;
  color?: string | null;
  sortOrder?: number;
  enabled?: boolean;
}

export interface AudioSceneUpsertDto {
  presetNum?: number;
  name?: string;
  hint?: string | null;
  /** 场景内容 (矩阵路由+音量+静音). null=清空回退设备预设, undefined=不动 */
  content?: SceneContent | null;
  sortOrder?: number;
  enabled?: boolean;
}

/** 默认 8 输出通道: OUT1-OUT8 (channel 0-7), 业主后续改名 */
/**
 * 默认 8 路输出 —— 名字取自**现场机柜标签**照片 (2026-07-16 业主拍给我的那张):
 *   输出1 一楼门厅  输出2 一楼东北   输出3 一楼中厅   输出4 一楼南厅
 *   输出5 一楼大屏  输出6 一楼投影仪  输出7 二楼走廊   输出8 二楼办公区
 *
 * 原来是 `OUT 1`..`OUT 8` 的占位。生产库里早已被改成上面这些真名, 但**种子里没有** ——
 * 重装/新机器就会退回占位名, 现场对不上标签。现场标签是权威, 代码跟着它走。
 * 业主仍可在前端就地改名 (分区音量页双击名字), 幂等 seed 不会覆盖改过的。
 */
const DEFAULT_ZONE_NAMES = [
  '一楼门厅', '一楼东北', '一楼中厅', '一楼南厅',
  '一楼大屏', '一楼投影仪', '二楼走廊', '二楼办公区',
];
const DEFAULT_ZONES = Array.from({ length: 8 }, (_, i) => ({
  channel: i,
  name: DEFAULT_ZONE_NAMES[i],
  floor: (i < 6 ? '1F' : '2F') as string | null,
  color: null as string | null,
  sortOrder: i,
}));

/**
 * 默认 8 路输入 —— 同样取自机柜标签照片:
 *   输入1 中控主机 (声卡, 背景音乐这一路)   输入2 定时播放器
 *   输入3 调音台                          输入4 中控主机2 (HDMI, 大屏音频这一路)
 * IN5-IN8 现场**没有标签 = 没接线**, 保留占位名, 别乱起名误导人。
 */
const DEFAULT_INPUT_NAMES = [
  '中控主机', '定时播放器', '调音台', '中控主机2',
  'IN 5 (未接线)', 'IN 6 (未接线)', 'IN 7 (未接线)', 'IN 8 (未接线)',
];
const DEFAULT_INPUTS = Array.from({ length: 8 }, (_, i) => ({
  channel: i,
  name: DEFAULT_INPUT_NAMES[i],
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
    @InjectRepository(AudioInputSource) private readonly inputRepo: Repository<AudioInputSource>,
    @InjectRepository(AudioScene) private readonly sceneRepo: Repository<AudioScene>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /** 启动 seed: 表空时插默认 8 输出 + 8 输入 + 12 场景. 不覆盖业主改过的 */
  async onModuleInit(): Promise<void> {
    if ((await this.zoneRepo.count()) === 0) {
      await this.zoneRepo.save(DEFAULT_ZONES.map((z) => this.zoneRepo.create(z)));
      this.logger.info('[AudioConfig] seeded 8 输出通道 (OUT1-OUT8)');
    }
    if ((await this.inputRepo.count()) === 0) {
      await this.inputRepo.save(DEFAULT_INPUTS.map((s) => this.inputRepo.create(s)));
      this.logger.info('[AudioConfig] seeded 8 输入源 (IN1-IN8)');
    }
    if ((await this.sceneRepo.count()) === 0) {
      await this.sceneRepo.save(
        DEFAULT_SCENES.map((s, i) => this.sceneRepo.create({ ...s, sortOrder: i })),
      );
      this.logger.info('[AudioConfig] seeded 12 场景 (U01-U12)');
    }
  }

  // ============ 输入源 ============

  async listInputs(includeDisabled = false): Promise<AudioInputSource[]> {
    const qb = this.inputRepo.createQueryBuilder('s').orderBy('s.sortOrder', 'ASC').addOrderBy('s.channel', 'ASC');
    if (!includeDisabled) qb.where('s.enabled = :e', { e: true });
    return qb.getMany();
  }

  async upsertInput(id: number | null, dto: AudioInputUpsertDto): Promise<AudioInputSource> {
    let row = id ? await this.inputRepo.findOne({ where: { id } }) : null;
    if (id && !row) throw new NotFoundException(`输入源不存在: id=${id}`);
    if (!row) {
      if (typeof dto.channel !== 'number') throw new Error('channel 必填');
      row = this.inputRepo.create({ channel: dto.channel, name: dto.name ?? `IN ${dto.channel + 1}` });
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
    if (dto.color !== undefined) row.color = dto.color?.trim() || null;
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    return this.inputRepo.save(row);
  }

  async deleteInput(id: number): Promise<{ removedId: number }> {
    const row = await this.inputRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`输入源不存在: id=${id}`);
    await this.inputRepo.remove(row);
    return { removedId: id };
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
    if (dto.content !== undefined) {
      row.content = dto.content === null ? null : JSON.stringify(this.sanitizeContent(dto.content));
    }
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

  async getSceneByPreset(presetNum: number): Promise<AudioScene | null> {
    return this.sceneRepo.findOne({ where: { presetNum } });
  }

  /** 解析场景的 content JSON → SceneContent, 非法/空返回 null */
  parseSceneContent(scene: AudioScene | null): SceneContent | null {
    if (!scene?.content) return null;
    try {
      const parsed = JSON.parse(scene.content) as SceneContent;
      return parsed && Array.isArray(parsed.outputs) ? parsed : null;
    } catch {
      return null;
    }
  }

  /** 校验+规整场景内容: 丢掉非法 ch, 去重排序 inputs, 钳 volume 0-100 */
  private sanitizeContent(content: SceneContent): SceneContent {
    const outs = Array.isArray(content?.outputs) ? content.outputs : [];
    const cleaned = outs
      .map((o): SceneOutputConfig | null => {
        const ch = Number(o.ch);
        if (!Number.isInteger(ch) || ch < 0 || ch > 7) return null;
        const out: SceneOutputConfig = { ch };
        if (Array.isArray(o.inputs)) {
          out.inputs = [...new Set(o.inputs.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 7))].sort((a, b) => a - b);
        }
        if (typeof o.volume === 'number' && Number.isFinite(o.volume)) {
          out.volume = Math.max(0, Math.min(100, Math.round(o.volume)));
        }
        if (typeof o.muted === 'boolean') out.muted = o.muted;
        return out;
      })
      .filter((o): o is SceneOutputConfig => o !== null);
    return { outputs: cleaned };
  }
}
