import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

@Injectable()
export class AudioConfigService {
  constructor(
    @InjectRepository(AudioOutputZone) private readonly zoneRepo: Repository<AudioOutputZone>,
    @InjectRepository(AudioInputSource) private readonly inputRepo: Repository<AudioInputSource>,
    @InjectRepository(AudioScene) private readonly sceneRepo: Repository<AudioScene>,
  ) {}

  // ============ 输入源 ============

  async listInputs(includeDisabled = false): Promise<AudioInputSource[]> {
    const qb = this.inputRepo
      .createQueryBuilder('s')
      .orderBy('s.sortOrder', 'ASC')
      .addOrderBy('s.channel', 'ASC');
    if (!includeDisabled) qb.where('s.enabled = :e', { e: true });
    return qb.getMany();
  }

  async upsertInput(id: number | null, dto: AudioInputUpsertDto): Promise<AudioInputSource> {
    let row = id ? await this.inputRepo.findOne({ where: { id } }) : null;
    if (id && !row) throw new NotFoundException(`输入源不存在: id=${id}`);
    if (!row) {
      if (typeof dto.channel !== 'number') throw new Error('channel 必填');
      row = this.inputRepo.create({
        channel: dto.channel,
        name: dto.name ?? `IN ${dto.channel + 1}`,
      });
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
    const qb = this.zoneRepo
      .createQueryBuilder('z')
      .orderBy('z.sortOrder', 'ASC')
      .addOrderBy('z.channel', 'ASC');
    if (!includeDisabled) qb.where('z.enabled = :e', { e: true });
    return qb.getMany();
  }

  async upsertZone(id: number | null, dto: AudioZoneUpsertDto): Promise<AudioOutputZone> {
    return this.zoneRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(AudioOutputZone);
      let row = id ? await repo.findOne({ where: { id } }) : null;
      if (id && !row) throw new NotFoundException(`输出通道不存在: id=${id}`);
      if (!row) {
        if (typeof dto.channel !== 'number') throw new Error('channel 必填');
        const initialName = dto.name?.trim() || `OUT ${dto.channel + 1}`;
        row = repo.create({
          channel: dto.channel,
          name: this.stereoName(dto.channel, initialName),
        });
      }
      if (dto.channel !== undefined) {
        if (dto.channel < 0 || dto.channel > 7) throw new Error('channel 必须 0-7');
        row.channel = dto.channel;
      }
      if (dto.name !== undefined) {
        const value = dto.name.trim();
        if (!value) throw new Error('名称不能为空');
        row.name = this.stereoName(row.channel, value);
      }
      if (dto.floor !== undefined) row.floor = dto.floor?.trim() || null;
      if (dto.color !== undefined) row.color = dto.color?.trim() || null;
      if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
      if (dto.enabled !== undefined) row.enabled = dto.enabled;
      const saved = await repo.save(row);

      if (dto.name !== undefined && row.channel >= 0 && row.channel <= 3) {
        const partnerChannel = row.channel % 2 === 0 ? row.channel + 1 : row.channel - 1;
        const partner = await repo.findOne({ where: { channel: partnerChannel } });
        if (partner) {
          const partnerName = this.stereoName(partnerChannel, row.name);
          if (partner.name !== partnerName) {
            partner.name = partnerName;
            await repo.save(partner);
          }
        }
      }
      return saved;
    });
  }

  private stereoName(channel: number, value: string): string {
    if (channel < 0 || channel > 3) return value.slice(0, 64);
    const base = value.replace(/·[左右]$/u, '').trim();
    if (!base) throw new Error('立体声通道名称不能为空');
    return `${base.slice(0, 62)}·${channel % 2 === 0 ? '左' : '右'}`;
  }

  async deleteZone(id: number): Promise<{ removedId: number }> {
    const row = await this.zoneRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`输出通道不存在: id=${id}`);
    await this.zoneRepo.remove(row);
    return { removedId: id };
  }

  // ============ 场景 ============

  async listScenes(includeDisabled = false): Promise<AudioScene[]> {
    const qb = this.sceneRepo
      .createQueryBuilder('s')
      .orderBy('s.sortOrder', 'ASC')
      .addOrderBy('s.presetNum', 'ASC');
    if (!includeDisabled) qb.where('s.enabled = :e', { e: true });
    return qb.getMany();
  }

  async upsertScene(id: number | null, dto: AudioSceneUpsertDto): Promise<AudioScene> {
    let row = id ? await this.sceneRepo.findOne({ where: { id } }) : null;
    if (id && !row) throw new NotFoundException(`场景不存在: id=${id}`);
    if (!row) {
      if (typeof dto.presetNum !== 'number') throw new Error('presetNum 必填');
      row = this.sceneRepo.create({
        presetNum: dto.presetNum,
        name: dto.name ?? `U${String(dto.presetNum).padStart(2, '0')}`,
      });
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
          out.inputs = [
            ...new Set(o.inputs.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 7)),
          ].sort((a, b) => a - b);
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
