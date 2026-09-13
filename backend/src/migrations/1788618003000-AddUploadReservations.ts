import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class AddUploadReservations1788618003000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.createTable(new Table({ name: 'upload_reservations', columns: [
      { name: 'id', type: 'varchar', length: '64', isPrimary: true },
      { name: 'owner_user_id', type: 'integer' },
      { name: 'bytes', type: 'bigint' },
      { name: 'created_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
    ], foreignKeys: [{ name: 'fk_upload_reservation_owner', columnNames: ['owner_user_id'], referencedTableName: 'users', referencedColumnNames: ['id'], onDelete: 'RESTRICT' }], indices: [{ name: 'ix_upload_reservation_owner', columnNames: ['owner_user_id'] }] }));
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM upload_reservations');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: active upload reservations');
    await q.dropTable('upload_reservations');
  }
}
