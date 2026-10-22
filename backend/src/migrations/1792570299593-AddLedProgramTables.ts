import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/** led_program / led_program_segment —— LED 节目 bin 登记表, 2026-10-21 生产化扩表 */
export class AddLedProgramTables1792570299593 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(new Table({
      name: 'led_program',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'name', type: 'varchar', length: '128' },
        { name: 'contentJson', type: 'text', isNullable: true },
        { name: 'binPath', type: 'varchar', length: '512' },
        { name: 'fileSize', type: 'integer' },
        { name: 'md5', type: 'varchar', length: '32' },
        { name: 'cycles', type: 'integer', default: 1 },
        { name: 'fps', type: 'integer', default: 25 },
        { name: 'durationS', type: 'integer', default: 0 },
        { name: 'createdBy', type: 'varchar', length: '32', default: "'admin'" },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
      indices: [
        new TableIndex({ name: 'ix_led_program_md5', columnNames: ['md5'] }),
      ],
    }));

    await q.createTable(new Table({
      name: 'led_program_segment',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
        { name: 'programId', type: 'integer' },
        { name: 'seq', type: 'integer' },
        { name: 'type', type: 'varchar', length: '8' },
        { name: 'text', type: 'text', isNullable: true },
        { name: 'template', type: 'varchar', length: '32', isNullable: true },
        { name: 'color', type: 'varchar', length: '16', isNullable: true },
        { name: 'videoName', type: 'varchar', length: '255', isNullable: true },
        { name: 'durationMs', type: 'integer', isNullable: true },
        { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
      ],
      indices: [
        new TableIndex({ name: 'ix_led_segment_program', columnNames: ['programId'] }),
      ],
    }));
  }

  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM led_program');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: active led programs');
    await q.dropTable('led_program_segment');
    await q.dropTable('led_program');
  }
}
