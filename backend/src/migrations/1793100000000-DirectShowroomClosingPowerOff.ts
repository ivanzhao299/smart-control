import { MigrationInterface, QueryRunner } from 'typeorm';

const LIGHTING_POWER_CODES = [
  'ewelink-02b88e41', // 展厅灯带
  'ewelink-02b8942a', // 展厅筒灯射灯
  '1f-showroom', // 沙盘展位
  'ewelink-02cbf4eb', // 金特夫展厅
  'ewelink-02cbf4ef', // 无纺布展厅
  'ewelink-02cbf50b', // 西展厅
] as const;

/**
 * 闭馆场景只负责按顺序断开真实电源回路。
 *
 * 大力网关的在线状态、亮度渐变和完成状态不再作为闭馆链路的一部分，
 * 避免网关探测或等待阻断电源关闭。保留旧动作记录但停用，便于审计。
 */
export class DirectShowroomClosingPowerOff1793100000000 implements MigrationInterface {
  name = 'DirectShowroomClosingPowerOff1793100000000';

  async up(q: QueryRunner): Promise<void> {
    const rows = (await q.query('SELECT id FROM scenes WHERE code = ?', ['closing'])) as Array<{ id: number }>;
    if (rows.length !== 1) return;
    const sceneId = rows[0].id;

    // 闭馆不再调用 DALI/大力网关，停用历史网关动作但保留记录。
    await q.query(
      `UPDATE scene_actions
       SET enabled = 0, updated_at = CURRENT_TIMESTAMP
       WHERE scene_id = ? AND device_type = 'lighting-broadcast'`,
      [sceneId],
    );

    // 停用旧的断电动作，再写入唯一的规范顺序，避免历史排序影响现场执行。
    await q.query(
      `UPDATE scene_actions
       SET enabled = 0, updated_at = CURRENT_TIMESTAMP
       WHERE scene_id = ? AND device_type = 'power-circuit' AND command = 'turnOff'`,
      [sceneId],
    );

    for (let i = LIGHTING_POWER_CODES.length - 1; i >= 0; i -= 1) {
      const code = LIGHTING_POWER_CODES[i];
      const sortOrder = 10 + (LIGHTING_POWER_CODES.length - 1 - i) * 10;
      await q.query(
        `INSERT INTO scene_actions
         (scene_id, device_type, device_id, command, params, delay_ms, sort_order,
          enabled, config_revision, created_at, updated_at)
         VALUES (?, 'power-circuit', ?, 'turnOff', '{}', 0, ?, 1, 1,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [sceneId, code, sortOrder],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    // The preceding showroom-sequence migration owns the archive fence. When the
    // chain test reaches this migration after removing that ledger entry, this
    // migration is safe to pop; while the preceding migration is still present,
    // preserve its fence so a rollback can never bypass the archive requirement.
    const rows = (await q.query(
      "SELECT name FROM migrations WHERE name = 'EstablishShowroomLightingSequence1793000000000'",
    )) as Array<{ name: string }>;
    if (rows.length > 0) {
      throw new Error('SHOWROOM_LIGHTING_SEQUENCE_ROLLBACK_REQUIRES_ARCHIVE');
    }
  }
}
