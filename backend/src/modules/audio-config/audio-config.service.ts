import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AudioOutputZone } from '../../entities/audio-output-zone.entity';
import { AudioInputSource } from '../../entities/audio-input-source.entity';
import { AudioScene } from '../../entities/audio-scene.entity';
import type { SceneContent } from '../../adapters/audio/ekx808.adapter';
import type { Actor } from '../../common/auth/actor';
import {
  AudioInputUpsertDto,
  AudioSceneUpsertDto,
  AudioZoneUpsertDto,
} from './dto/audio-config.dto';
import {
  deleteAudioConfigRow,
  invalidAudioConfig,
  mutateAudioConfig,
  saveAudioConfigRow,
} from './audio-config-write';
export {
  AudioInputUpsertDto,
  AudioSceneUpsertDto,
  AudioZoneUpsertDto,
} from './dto/audio-config.dto';

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

  async upsertInput(
    id: number | null,
    dto: AudioInputUpsertDto,
    actor?: Actor,
  ): Promise<AudioInputSource> {
    return mutateAudioConfig(
      this.inputRepo,
      id,
      dto.expectedRevision,
      actor,
      async (manager, repo, current) => {
        let row = current;
        const before = row ? { ...row } : null;
        if (!row) {
          if (typeof dto.channel !== 'number') throw invalidAudioConfig('channel 必填');
          row = repo.create({
            channel: dto.channel,
            name: dto.name ?? `IN ${dto.channel + 1}`,
          });
        }
        if (dto.channel !== undefined) {
          if (!Number.isInteger(dto.channel) || dto.channel < 0 || dto.channel > 7)
            throw invalidAudioConfig('channel 必须 0-7');
          row.channel = dto.channel;
        }
        if (dto.name !== undefined) {
          const v = dto.name.trim();
          if (!v) throw invalidAudioConfig('名称不能为空');
          row.name = v.slice(0, 64);
        }
        if (dto.color !== undefined) row.color = dto.color?.trim() || null;
        if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
        if (dto.enabled !== undefined) row.enabled = dto.enabled;
        return saveAudioConfigRow(manager, repo, before, row, actor);
      },
    );
  }

  async deleteInput(
    id: number,
    expectedRevision?: number,
    actor?: Actor,
  ): Promise<{ removedId: number }> {
    return mutateAudioConfig(this.inputRepo, id, expectedRevision, actor, (manager, repo, row) =>
      deleteAudioConfigRow(manager, repo, row!, actor),
    );
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

  async upsertZone(
    id: number | null,
    dto: AudioZoneUpsertDto,
    actor?: Actor,
  ): Promise<AudioOutputZone & { pairedZone?: AudioOutputZone }> {
    return mutateAudioConfig(
      this.zoneRepo,
      id,
      dto.expectedRevision,
      actor,
      async (manager, repo, current) => {
        let row = current;
        const before = row ? { ...row } : null;
        if (!row) {
          if (typeof dto.channel !== 'number') throw invalidAudioConfig('channel 必填');
          const initialName = dto.name?.trim() || `OUT ${dto.channel + 1}`;
          row = repo.create({
            channel: dto.channel,
            name: this.stereoName(dto.channel, initialName),
          });
        }
        if (dto.channel !== undefined) {
          if (!Number.isInteger(dto.channel) || dto.channel < 0 || dto.channel > 7)
            throw invalidAudioConfig('channel 必须 0-7');
          row.channel = dto.channel;
        }
        if (dto.name !== undefined) {
          const value = dto.name.trim();
          if (!value) throw invalidAudioConfig('名称不能为空');
          row.name = this.stereoName(row.channel, value);
        }
        if (dto.floor !== undefined) row.floor = dto.floor?.trim() || null;
        if (dto.color !== undefined) row.color = dto.color?.trim() || null;
        if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
        if (dto.enabled !== undefined) row.enabled = dto.enabled;
        const saved = await saveAudioConfigRow(manager, repo, before, row, actor);
        let pairedZone: AudioOutputZone | undefined;

        if (dto.name !== undefined && row.channel >= 0 && row.channel <= 3) {
          const partnerChannel = row.channel % 2 === 0 ? row.channel + 1 : row.channel - 1;
          const partner = await repo.findOne({ where: { channel: partnerChannel } });
          if (partner) {
            const partnerName = this.stereoName(partnerChannel, row.name);
            if (partner.name !== partnerName) {
              const partnerBefore = { ...partner };
              partner.name = partnerName;
              pairedZone = await saveAudioConfigRow(manager, repo, partnerBefore, partner, actor);
            } else pairedZone = partner;
          }
        }
        return pairedZone ? { ...saved, pairedZone } : saved;
      },
    );
  }

  private stereoName(channel: number, value: string): string {
    if (channel < 0 || channel > 3) return value.slice(0, 64);
    const base = value.replace(/·[左右]$/u, '').trim();
    if (!base) throw invalidAudioConfig('立体声通道名称不能为空');
    return `${base.slice(0, 62)}·${channel % 2 === 0 ? '左' : '右'}`;
  }

  async deleteZone(
    id: number,
    expectedRevision?: number,
    actor?: Actor,
  ): Promise<{ removedId: number }> {
    return mutateAudioConfig(this.zoneRepo, id, expectedRevision, actor, (manager, repo, row) =>
      deleteAudioConfigRow(manager, repo, row!, actor),
    );
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

  async upsertScene(
    id: number | null,
    dto: AudioSceneUpsertDto,
    actor?: Actor,
  ): Promise<AudioScene> {
    return mutateAudioConfig(
      this.sceneRepo,
      id,
      dto.expectedRevision,
      actor,
      async (manager, repo, current) => {
        let row = current;
        const before = row ? { ...row } : null;
        if (!row) {
          if (typeof dto.presetNum !== 'number') throw invalidAudioConfig('presetNum 必填');
          row = repo.create({
            presetNum: dto.presetNum,
            name: dto.name ?? `U${String(dto.presetNum).padStart(2, '0')}`,
          });
        }
        if (dto.presetNum !== undefined) {
          if (!Number.isInteger(dto.presetNum) || dto.presetNum < 1 || dto.presetNum > 12)
            throw invalidAudioConfig('presetNum 必须 1-12');
          row.presetNum = dto.presetNum;
        }
        if (dto.name !== undefined) {
          const v = dto.name.trim();
          if (!v) throw invalidAudioConfig('名称不能为空');
          row.name = v.slice(0, 64);
        }
        if (dto.hint !== undefined) row.hint = dto.hint?.trim() || null;
        if (dto.content !== undefined) {
          row.content =
            dto.content === null ? null : JSON.stringify(this.sanitizeContent(dto.content));
        }
        if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
        if (dto.enabled !== undefined) row.enabled = dto.enabled;
        return saveAudioConfigRow(manager, repo, before, row, actor);
      },
    );
  }

  async deleteScene(
    id: number,
    expectedRevision?: number,
    actor?: Actor,
  ): Promise<{ removedId: number }> {
    return mutateAudioConfig(this.sceneRepo, id, expectedRevision, actor, (manager, repo, row) =>
      deleteAudioConfigRow(manager, repo, row!, actor),
    );
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

  /** Validated DTO input; sort deterministically, never silently drop a requested route. */
  private sanitizeContent(content: SceneContent): SceneContent {
    return {
      outputs: content.outputs
        .map((output) => ({
          ...output,
          ...(output.inputs ? { inputs: [...output.inputs].sort((a, b) => a - b) } : {}),
        }))
        .sort((a, b) => a.ch - b.ch),
    };
  }
}
