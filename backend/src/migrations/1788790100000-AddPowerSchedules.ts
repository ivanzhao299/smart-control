import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/** power_schedules —— 电源回路自动开关 (定时/日落/日出) 规则表, 2026-10-01 */
export class AddPowerSchedules1788790100000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(new Table({
      name: 'power_schedules',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'circuit_id', type: 'integer' },
        { name: 'action', type: 'varchar', length: '8' },
        { name: 'mode', type: 'varchar', length: '16' },
        { name: 'time', type: 'varchar', length: '8', isNullable: true },
        { name: 'offset_min', type: 'integer', default: 0 },
        { name: 'weekdays', type: 'varchar', length: '16', isNullable: true },
        { name: 'enabled', type: 'boolean', default: 1 },
        { name: 'next_run_at', type: 'datetime', isNullable: true },
        { name: 'created_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
      indices: [
        new TableIndex({ name: 'ix_power_schedules_circuit', columnNames: ['circuit_id'] }),
      ],
    }));
  }

  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM power_schedules');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: active power schedules');
    await q.dropTable('power_schedules');
  }
}
