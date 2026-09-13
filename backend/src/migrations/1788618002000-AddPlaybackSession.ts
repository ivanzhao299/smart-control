import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPlaybackSession1788618002000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn('playback_channels', new TableColumn({ name: 'playback_session', type: 'varchar', length: '64', isNullable: true }));
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM playback_channels WHERE playback_session IS NOT NULL');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: stop active sessions before rollback');
    await q.dropColumn('playback_channels', 'playback_session');
  }
}
