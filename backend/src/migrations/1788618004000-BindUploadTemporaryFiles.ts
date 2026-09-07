import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class BindUploadTemporaryFiles1788618004000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn('upload_reservations', new TableColumn({ name: 'temp_name', type: 'varchar', length: '64', isNullable: true }));
    await q.addColumn('upload_reservations', new TableColumn({ name: 'instance_id', type: 'varchar', length: '36', isNullable: true }));
    await q.createIndex('upload_reservations', new TableIndex({ name: 'uq_upload_temp_name', columnNames: ['temp_name'], isUnique: true }));
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM upload_reservations WHERE temp_name IS NOT NULL OR instance_id IS NOT NULL');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: bound upload temporary files');
    await q.dropIndex('upload_reservations', 'uq_upload_temp_name');
    await q.dropColumn('upload_reservations', 'instance_id');
    await q.dropColumn('upload_reservations', 'temp_name');
  }
}
