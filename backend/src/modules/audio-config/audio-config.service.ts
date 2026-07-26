import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { AudioOutputZone } from '../../entities/audio-output-zone.entity';
import { AudioInputSource } from '../../entities/audio-input-source.entity';
import { AudioScene } from '../../entities/audio-scene.entity';
import { AudioDesiredLink } from '../../entities/audio-desired-link.entity';
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

/**
 * 默认 8 路输出 —— 2026-07-26 业主定的全量接线 (权威, 代码跟着接线走):
 *   OUT1/2 LED大屏 左/右   OUT3/4 投影仪 左/右
 *   OUT5 二楼办公区        OUT6 二楼走廊区
 *   OUT7 前厅和东北区      OUT8 一楼展位
 *
 * ⚠️ OUT1-4 的名字必须保持 `前缀·左` / `前缀·右` 格式 —— AudioPage 的立体声
 * 配对**纯靠这个命名约定**识别 (两路合一张卡, 右路跟随左路)。
 * 业主仍可在前端就地改名, 幂等 seed 不会覆盖改过的。
 */
const DEFAULT_ZONE_NAMES = [
  'LED大屏·左', 'LED大屏·右', '投影仪·左', '投影仪·右',
  '二楼办公区', '二楼走廊区', '前厅和东北区', '一楼展位',
];
const DEFAULT_ZONE_FLOORS = ['1F', '1F', '1F', '1F', '2F', '2F', '1F', '1F'];
const DEFAULT_ZONES = Array.from({ length: 8 }, (_, i) => ({
  channel: i,
  name: DEFAULT_ZONE_NAMES[i],
  floor: DEFAULT_ZONE_FLOORS[i] as string | null,
  color: null as string | null,
  sortOrder: i,
}));

/**
 * 默认 8 路输入 —— 2026-07-26 业主定的全量接线 (8 路全用上, 只有 IN8 空):
 *   IN1/2 HDMI1 分离器 → LED 大屏视频声 左/右
 *   IN3/4 HDMI2 分离器 → 投影仪视频声 左/右
 *   IN5 USB 声卡 (中控主机, 背景音乐)   IN6 调音台
 *   IN7 定时播放器                      IN8 未接线
 *
 * IN1-IN5 给 desiredGainDb=0 / desiredMuted=false: 2026-07-17 教训 —— 矩阵断电
 * 重启会把增益打回预设 (-60dB), 交叉点通了也没声; AudioReconciler 每 30s 把
 * 实际增益纠回期望值, 视频声与 BGM 这几路必须托管住。调音台/定时播放器留 null
 * (现场人工调, 系统不抢)。
 */
const DEFAULT_INPUT_NAMES = [
  'LED大屏·左', 'LED大屏·右', '投影仪·左', '投影仪·右',
  'USB 声卡', '调音台', '定时播放器', 'IN 8 (未接线)',
];
const DEFAULT_INPUTS = Array.from({ length: 8 }, (_, i) => ({
  channel: i,
  name: DEFAULT_INPUT_NAMES[i],
  color: null as string | null,
  sortOrder: i,
  enabled: i !== 7,
  desiredGainDb: i <= 4 ? 0 : null,
  desiredMuted: i <= 4 ? false : null,
}));

/**
 * 默认路由 (期望交叉点) —— "默认是这种接线逻辑" (业主 2026-07-26):
 *   LED 视频声直通:  OUT1←IN1, OUT2←IN2 (立体声左右各走各)
 *   投影视频声直通:  OUT3←IN3, OUT4←IN4
 *   分区 BGM:        OUT5-8 ← IN5 (USB 声卡, 中控主机背景音乐)
 *
 * 落成**完整 8×8 期望** (8 通 + 56 断), 不是只存通的 8 条: 设备里可能残留
 * 旧接线时代的交叉点 (旧 IN1=BGM→分区), 割接后物理含义全变, 不显式声明"断"
 * 的话 reconciler 不会去关它们 —— LED 左声道就会灌进分区喇叭。
 * 业主在矩阵 UI 点交叉点即改期望, AudioReconciler (30s) 持续把设备纠成期望态。
 */
const DEFAULT_ON = new Set(['0_0', '1_1', '2_2', '3_3', '4_4', '5_4', '6_4', '7_4']);
const DEFAULT_LINKS = Array.from({ length: 64 }, (_, i) => {
  const outCh = Math.floor(i / 8);
  const inCh = i % 8;
  return { outCh, inCh, enabled: DEFAULT_ON.has(`${outCh}_${inCh}`) };
});

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
    @InjectRepository(AudioDesiredLink) private readonly linkRepo: Repository<AudioDesiredLink>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /** 启动 seed: 表空时插默认 8 输出 + 8 输入 + 默认路由 + 12 场景. 不覆盖业主改过的 */
  async onModuleInit(): Promise<void> {
    if ((await this.zoneRepo.count()) === 0) {
      await this.zoneRepo.save(DEFAULT_ZONES.map((z) => this.zoneRepo.create(z)));
      this.logger.info('[AudioConfig] seeded 8 输出通道 (OUT1-OUT8)');
    }
    if ((await this.inputRepo.count()) === 0) {
      await this.inputRepo.save(DEFAULT_INPUTS.map((s) => this.inputRepo.create(s)));
      this.logger.info('[AudioConfig] seeded 8 输入源 (IN1-IN8)');
    }
    if ((await this.linkRepo.count()) === 0) {
      await this.linkRepo.save(DEFAULT_LINKS.map((l) => this.linkRepo.create(l)));
      this.logger.info('[AudioConfig] seeded 8×8 默认路由期望 (8 通 / 56 断)');
    }
    if ((await this.sceneRepo.count()) === 0) {
      await this.sceneRepo.save(
        DEFAULT_SCENES.map((s, i) => this.sceneRepo.create({ ...s, sortOrder: i })),
      );
      this.logger.info('[AudioConfig] seeded 12 场景 (U01-U12)');
    }
    await this.heal20260726Rewiring();
  }

  /**
   * 一次性割接 (2026-07-26): 音频矩阵按业主定的全量接线重排。
   *
   * 生产库还是 07-24 的旧映射 (IN1=中控主机...), 而 seed 遇已有行只跳过 ——
   * 不 heal 的话新接线永远上不了生产 (老坑, 同 healLedCircuitToBreaker)。
   *
   * 哨兵 = IN1 还叫「中控主机」: 割接后 IN1 改名, 此方法从此不再触发;
   * 业主后续在 UI 里怎么改都不会被冲掉。
   *
   * 旧 desired_link 全清: in_ch 的物理含义整个变了 (旧 IN1=BGM, 新 IN1=LED左),
   * 留着旧交叉点会把 LED 左声道灌进分区喇叭。清掉重建默认直通+BGM 路由,
   * AudioReconciler (30s 周期) 会自动把设备纠成新期望。
   */
  private async heal20260726Rewiring(): Promise<void> {
    const in0 = await this.inputRepo.findOne({ where: { channel: 0 } });
    if (!in0 || in0.name !== '中控主机') return;

    for (const d of DEFAULT_INPUTS) {
      const row = (await this.inputRepo.findOne({ where: { channel: d.channel } }))
        ?? this.inputRepo.create({ channel: d.channel, name: d.name });
      row.name = d.name;
      row.enabled = d.enabled;
      row.desiredGainDb = d.desiredGainDb;
      row.desiredMuted = d.desiredMuted;
      await this.inputRepo.save(row);
    }
    for (const d of DEFAULT_ZONES) {
      const row = (await this.zoneRepo.findOne({ where: { channel: d.channel } }))
        ?? this.zoneRepo.create({ channel: d.channel, name: d.name });
      row.name = d.name;
      row.floor = d.floor;
      row.enabled = true;
      await this.zoneRepo.save(row);
    }
    await this.linkRepo.clear();
    await this.linkRepo.save(DEFAULT_LINKS.map((l) => this.linkRepo.create(l)));
    this.logger.warn(
      '[AudioConfig] 2026-07-26 割接完成: 输入/输出全量重命名, 路由重建为直通+BGM (LED IN1/2→OUT1/2, 投影 IN3/4→OUT3/4, USB声卡→OUT5-8)',
      { context: 'AudioConfig' },
    );
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
