import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class TrackUploadInstances1788618005000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(new Table({ name: 'upload_instances', columns: [
      { name: 'id', type: 'varchar', length: '36', isPrimary: true },
      { name: 'hostname', type: 'varchar', length: '255' },
      { name: 'pid', type: 'integer' },
      { name: 'started_at', type: 'varchar', length: '32' },
      { name: 'registered_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    ] }));
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM upload_reservations WHERE instance_id IS NOT NULL');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: upload instance references');
    await q.dropTable('upload_instances');
  }
}
