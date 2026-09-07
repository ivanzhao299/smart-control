import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';
export class LinkUploadMedia1788618006000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn('upload_reservations', new TableColumn({ name: 'target_media_id', type: 'integer', isNullable: true }));
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM upload_reservations WHERE target_media_id IS NOT NULL');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: linked upload media');
    await q.dropColumn('upload_reservations', 'target_media_id');
  }
}
