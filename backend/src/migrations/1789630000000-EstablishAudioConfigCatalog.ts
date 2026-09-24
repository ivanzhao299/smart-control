import { MigrationInterface, QueryRunner } from 'typeorm';

interface ZoneSeed {
  channel: number;
  name: string;
  floor: string;
  sortOrder: number;
}

interface InputSeed {
  channel: number;
  name: string;
  sortOrder: number;
  enabled: boolean;
  desiredGainDb: number | null;
  desiredMuted: boolean | null;
}

interface SceneSeed {
  presetNum: number;
  name: string;
  hint: string;
  sortOrder: number;
}

const ZONES: ZoneSeed[] = [
  { channel: 0, name: 'LED大屏·左', floor: '1F', sortOrder: 0 },
  { channel: 1, name: 'LED大屏·右', floor: '1F', sortOrder: 1 },
  { channel: 2, name: '投影仪·左', floor: '1F', sortOrder: 2 },
  { channel: 3, name: '投影仪·右', floor: '1F', sortOrder: 3 },
  { channel: 4, name: '二楼办公区', floor: '2F', sortOrder: 4 },
  { channel: 5, name: '二楼走廊区', floor: '2F', sortOrder: 5 },
  { channel: 6, name: '前厅和东北区', floor: '1F', sortOrder: 6 },
  { channel: 7, name: '一楼展位', floor: '1F', sortOrder: 7 },
];

const INPUTS: InputSeed[] = [
  {
    channel: 0,
    name: 'LED大屏·左',
    sortOrder: 0,
    enabled: true,
    desiredGainDb: 0,
    desiredMuted: false,
  },
  {
    channel: 1,
    name: 'LED大屏·右',
    sortOrder: 1,
    enabled: true,
    desiredGainDb: 0,
    desiredMuted: false,
  },
  {
    channel: 2,
    name: '投影仪·左',
    sortOrder: 2,
    enabled: true,
    desiredGainDb: 0,
    desiredMuted: false,
  },
  {
    channel: 3,
    name: '投影仪·右',
    sortOrder: 3,
    enabled: true,
    desiredGainDb: 0,
    desiredMuted: false,
  },
  {
    channel: 4,
    name: 'USB 声卡',
    sortOrder: 4,
    enabled: true,
    desiredGainDb: 0,
    desiredMuted: false,
  },
  {
    channel: 5,
    name: '调音台',
    sortOrder: 5,
    enabled: true,
    desiredGainDb: null,
    desiredMuted: null,
  },
  {
    channel: 6,
    name: '定时播放器',
    sortOrder: 6,
    enabled: true,
    desiredGainDb: null,
    desiredMuted: null,
  },
  {
    channel: 7,
    name: 'IN 8 (未接线)',
    sortOrder: 7,
    enabled: false,
    desiredGainDb: null,
    desiredMuted: null,
  },
];

const SCENES: SceneSeed[] = [
  { presetNum: 1, name: '早班接待', hint: '8-10 点全场低音量 BGM', sortOrder: 0 },
  { presetNum: 2, name: '日常运营', hint: '10-17 点标准音量', sortOrder: 1 },
  { presetNum: 3, name: '路演演讲', hint: 'LED 区主声道', sortOrder: 2 },
  { presetNum: 4, name: '大型发布会', hint: '全场开 + 突出', sortOrder: 3 },
  { presetNum: 5, name: '会议室独立', hint: 'ZONE 8 独立 + AEC', sortOrder: 4 },
  { presetNum: 6, name: '跟随讲解', hint: 'WTG-800 自动激活', sortOrder: 5 },
  { presetNum: 7, name: '政府接待 VIP', hint: '全场 +0dB', sortOrder: 6 },
  { presetNum: 8, name: '夜间静音', hint: '18-8 点全静音', sortOrder: 7 },
  { presetNum: 9, name: '应急广播', hint: '消防/疏散最大声', sortOrder: 8 },
  { presetNum: 10, name: '大屏视频', hint: 'ZONE 1 + SUB12', sortOrder: 9 },
  { presetNum: 11, name: '自定义 1', hint: '备用', sortOrder: 10 },
  { presetNum: 12, name: '自定义 2', hint: '备用', sortOrder: 11 },
];

const ENABLED_LINKS = new Set(['0_0', '1_1', '2_2', '3_3', '4_4', '5_4', '6_4', '7_4']);

/** Move audio catalog defaults and the 2026-07-26 one-time rewiring out of application startup. */
export class EstablishAudioConfigCatalog1789630000000 implements MigrationInterface {
  name = 'EstablishAudioConfigCatalog1789630000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.isEmpty(queryRunner, 'audio_output_zone')) await this.seedZones(queryRunner);
    if (await this.isEmpty(queryRunner, 'audio_input_source')) await this.seedInputs(queryRunner);
    if (await this.isEmpty(queryRunner, 'audio_desired_link')) await this.seedLinks(queryRunner);
    if (await this.isEmpty(queryRunner, 'audio_scene')) await this.seedScenes(queryRunner);

    await this.applyLegacyRewiring(queryRunner);
    await this.repairLegacyStereoNames(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'audio_output_zone',
      'audio_input_source',
      'audio_desired_link',
      'audio_scene',
    ]) {
      if (!(await this.isEmpty(queryRunner, table))) {
        throw new Error(
          'AUDIO_CONFIG_CATALOG_ROLLBACK_REQUIRES_ARCHIVE: authoritative data exists',
        );
      }
    }
  }

  private async isEmpty(queryRunner: QueryRunner, table: string): Promise<boolean> {
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*) AS count FROM "${table}"`,
    )) as Array<{ count: number }>;
    return Number(count) === 0;
  }

  private async seedZones(queryRunner: QueryRunner): Promise<void> {
    for (const zone of ZONES) {
      await queryRunner.query(
        `INSERT INTO audio_output_zone
         (channel, name, floor, color, sort_order, enabled, "createdAt", "updatedAt")
         VALUES (?, ?, ?, NULL, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [zone.channel, zone.name, zone.floor, zone.sortOrder],
      );
    }
  }

  private async seedInputs(queryRunner: QueryRunner): Promise<void> {
    for (const input of INPUTS) {
      await queryRunner.query(
        `INSERT INTO audio_input_source
         (channel, name, color, sort_order, enabled, desired_gain_db, desired_muted,
          "createdAt", "updatedAt")
         VALUES (?, ?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          input.channel,
          input.name,
          input.sortOrder,
          input.enabled ? 1 : 0,
          input.desiredGainDb,
          input.desiredMuted === null ? null : input.desiredMuted ? 1 : 0,
        ],
      );
    }
  }

  private async seedLinks(queryRunner: QueryRunner): Promise<void> {
    for (let outCh = 0; outCh < 8; outCh += 1) {
      for (let inCh = 0; inCh < 8; inCh += 1) {
        await queryRunner.query(
          `INSERT INTO audio_desired_link (out_ch, in_ch, enabled, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
          [outCh, inCh, ENABLED_LINKS.has(`${outCh}_${inCh}`) ? 1 : 0],
        );
      }
    }
  }

  private async seedScenes(queryRunner: QueryRunner): Promise<void> {
    for (const scene of SCENES) {
      await queryRunner.query(
        `INSERT INTO audio_scene
         (preset_num, name, hint, content, sort_order, enabled, "createdAt", "updatedAt")
         VALUES (?, ?, ?, NULL, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [scene.presetNum, scene.name, scene.hint, scene.sortOrder],
      );
    }
  }

  /** Exact historical signature only; all other existing audio configuration is preserved. */
  private async applyLegacyRewiring(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      'SELECT name FROM audio_input_source WHERE channel = 0',
    )) as Array<{ name: string }>;
    if (rows[0]?.name !== '中控主机') return;

    for (const input of INPUTS) {
      await queryRunner.query(
        `INSERT INTO audio_input_source
         (channel, name, color, sort_order, enabled, desired_gain_db, desired_muted,
          "createdAt", "updatedAt")
         VALUES (?, ?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(channel) DO UPDATE SET
           name = excluded.name,
           enabled = excluded.enabled,
           desired_gain_db = excluded.desired_gain_db,
           desired_muted = excluded.desired_muted,
           "updatedAt" = CURRENT_TIMESTAMP`,
        [
          input.channel,
          input.name,
          input.sortOrder,
          input.enabled ? 1 : 0,
          input.desiredGainDb,
          input.desiredMuted === null ? null : input.desiredMuted ? 1 : 0,
        ],
      );
    }
    for (const zone of ZONES) {
      await queryRunner.query(
        `INSERT INTO audio_output_zone
         (channel, name, floor, color, sort_order, enabled, "createdAt", "updatedAt")
         VALUES (?, ?, ?, NULL, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(channel) DO UPDATE SET
           name = excluded.name,
           floor = excluded.floor,
           enabled = 1,
           "updatedAt" = CURRENT_TIMESTAMP`,
        [zone.channel, zone.name, zone.floor, zone.sortOrder],
      );
    }
    await queryRunner.query('DELETE FROM audio_desired_link');
    await this.seedLinks(queryRunner);
  }

  /** Preserve the final behavior of the retired startup repair exactly once. */
  private async repairLegacyStereoNames(queryRunner: QueryRunner): Promise<void> {
    const stripSuffix = (name: string): string => name.replace(/·[左右]$/u, '').trim();
    for (const [leftChannel, rightChannel] of [
      [0, 1],
      [2, 3],
    ] as Array<[number, number]>) {
      const rows = (await queryRunner.query(
        `SELECT channel, name, "updatedAt" AS updatedAt
         FROM audio_output_zone WHERE channel IN (?, ?) ORDER BY channel`,
        [leftChannel, rightChannel],
      )) as Array<{ channel: number; name: string; updatedAt: string }>;
      const left = rows.find((row) => row.channel === leftChannel);
      const right = rows.find((row) => row.channel === rightChannel);
      if (!left || !right) continue;
      let base = stripSuffix(left.name);
      const rightBase = stripSuffix(right.name);
      if (base !== rightBase) {
        base = (left.updatedAt >= right.updatedAt ? base : rightBase) || base || rightBase;
      }
      if (!base) base = stripSuffix(ZONES[leftChannel].name);
      const leftName = `${base}·左`;
      const rightName = `${base}·右`;
      if (left.name !== leftName) {
        await queryRunner.query(
          'UPDATE audio_output_zone SET name = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE channel = ?',
          [leftName, leftChannel],
        );
      }
      if (right.name !== rightName) {
        await queryRunner.query(
          'UPDATE audio_output_zone SET name = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE channel = ?',
          [rightName, rightChannel],
        );
      }
    }
  }
}
