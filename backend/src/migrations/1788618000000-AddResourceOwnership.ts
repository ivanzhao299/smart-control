import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex } from 'typeorm';

/** Additive migration: original paths and IDs remain intact. */
export class AddResourceOwnership1788618000000 implements MigrationInterface {
  name = 'AddResourceOwnership1788618000000';

  async up(q: QueryRunner): Promise<void> {
    for (const table of ['media_assets', 'playback_history']) {
      await q.addColumn(table, new TableColumn({ name: 'owner_user_id', type: 'integer', isNullable: true }));
      await q.createForeignKey(table, new TableForeignKey({
        name: `fk_${table}_owner`, columnNames: ['owner_user_id'],
        referencedTableName: 'users', referencedColumnNames: ['id'], onDelete: 'RESTRICT',
      }));
      await q.createIndex(table, new TableIndex({ name: `ix_${table}_owner`, columnNames: ['owner_user_id'] }));
    }
    // Migration marks historical content shared. Entity defaults for NEW content are private.
    await q.addColumn('media_assets', new TableColumn({ name: 'visibility', type: 'varchar', default: "'private'" }));
    await q.query(`UPDATE media_assets SET visibility = 'shared'`);
    await q.addColumn('media_assets', new TableColumn({ name: 'source', type: 'varchar', default: "'upload'" }));
    await q.query(`UPDATE media_assets SET source = 'legacy'`);
    await q.addColumn('users', new TableColumn({ name: 'storage_quota_bytes', type: 'bigint', default: '10737418240' }));
    await q.addColumn('playback_channels', new TableColumn({ name: 'initiator_user_id', type: 'integer', isNullable: true }));
  }

  async down(q: QueryRunner): Promise<void> {
    // Never discard ownership and expose newly private content through the old public endpoint.
    const [media] = await q.query(`SELECT COUNT(*) AS n FROM media_assets WHERE owner_user_id IS NOT NULL OR visibility != 'shared' OR source != 'legacy'`);
    const [history] = await q.query(`SELECT COUNT(*) AS n FROM playback_history WHERE owner_user_id IS NOT NULL`);
    const [channels] = await q.query(`SELECT COUNT(*) AS n FROM playback_channels WHERE initiator_user_id IS NOT NULL`);
    if (Number(media.n) || Number(history.n) || Number(channels.n)) {
      throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: preserve new user data and restore the pre-release backup under maintenance');
    }
    await q.dropColumn('playback_channels', 'initiator_user_id');
    await q.dropColumn('users', 'storage_quota_bytes');
    await q.dropColumn('media_assets', 'source');
    await q.dropColumn('media_assets', 'visibility');
    for (const table of ['playback_history', 'media_assets']) {
      await q.dropIndex(table, `ix_${table}_owner`);
      await q.dropForeignKey(table, `fk_${table}_owner`);
      await q.dropColumn(table, 'owner_user_id');
    }
  }
}
