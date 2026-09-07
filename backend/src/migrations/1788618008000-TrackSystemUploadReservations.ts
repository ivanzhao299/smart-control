import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class TrackSystemUploadReservations1788618008000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.changeColumn('upload_reservations', 'owner_user_id', new TableColumn({ name: 'owner_user_id', type: 'integer', isNullable: true }));
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM upload_reservations WHERE owner_user_id IS NULL');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: system upload reservations');
    await q.changeColumn('upload_reservations', 'owner_user_id', new TableColumn({ name: 'owner_user_id', type: 'integer', isNullable: false }));
  }
}
