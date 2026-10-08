import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add sunset schedules for the second batch of HPERFOR breakers (2026-10-08).
 *
 * Purely additive and idempotent: attaches on/off sunset rules to the three new
 * circuits created by AddHperforExtraBreakersCatalog:
 *   - 楼顶大字 (roof-sign):     日落开, 日落后 120 分关
 *   - 路灯2   (streetlight-2):  日落开, 日落后 240 分关
 *   - 路灯3   (streetlight-3):  日落开, 日落后 240 分关
 * Runs every weekday. Rules are matched by (circuit, action, mode='sunset') so
 * re-running never duplicates rows; user-edited rules with a different mode are
 * left untouched.
 */

interface ScheduleRule {
  code: string;
  action: 'on' | 'off';
  offset: number;
}

const RULES: ScheduleRule[] = [
  { code: 'roof-sign', action: 'on', offset: 0 },
  { code: 'roof-sign', action: 'off', offset: 120 },
  { code: 'streetlight-2', action: 'on', offset: 0 },
  { code: 'streetlight-2', action: 'off', offset: 240 },
  { code: 'streetlight-3', action: 'on', offset: 0 },
  { code: 'streetlight-3', action: 'off', offset: 240 },
];

export class AddHperforExtraBreakerSchedules1790400000000 implements MigrationInterface {
  name = 'AddHperforExtraBreakerSchedules1790400000000';

  async up(q: QueryRunner): Promise<void> {
    for (const r of RULES) {
      await q.query(
        `INSERT INTO power_schedules
         (circuit_id, action, mode, time, offset_min, weekdays, enabled,
          created_at, updated_at)
         SELECT pc.id, ?, 'sunset', NULL, ?, '1,2,3,4,5,6,7', 1,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         FROM power_circuit pc
         WHERE pc.code = ?
           AND NOT EXISTS (
             SELECT 1 FROM power_schedules ps
             WHERE ps.circuit_id = pc.id AND ps.action = ? AND ps.mode = 'sunset'
           )`,
        [r.action, r.offset, r.code, r.action],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const codes = ['roof-sign', 'streetlight-2', 'streetlight-3'];
    for (const code of codes) {
      await q.query(
        `DELETE FROM power_schedules
         WHERE mode = 'sunset'
           AND circuit_id IN (
             SELECT id FROM power_circuit WHERE code = ?
           )`,
        [code],
      );
    }
  }
}
