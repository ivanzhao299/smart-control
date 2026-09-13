import { MigrationInterface, QueryRunner, TableColumn, TableForeignKey, TableIndex, TableUnique } from 'typeorm';

export class AddPersonalPlaylists1788618001000 implements MigrationInterface {
  name = 'AddPersonalPlaylists1788618001000';
  async up(q: QueryRunner): Promise<void> {
    await q.addColumn('playlist_item', new TableColumn({ name: 'owner_user_id', type: 'integer', isNullable: true }));
    await q.dropUniqueConstraint('playlist_item', 'uq_playlist_slot_media');
    await q.createForeignKey('playlist_item', new TableForeignKey({ name: 'fk_playlist_owner', columnNames: ['owner_user_id'], referencedTableName: 'users', referencedColumnNames: ['id'], onDelete: 'RESTRICT' }));
    await q.createIndex('playlist_item', new TableIndex({ name: 'ix_playlist_owner', columnNames: ['owner_user_id'] }));
    await q.createIndex('playlist_item', new TableIndex({ name: 'uq_playlist_user_slot_media', columnNames: ['owner_user_id', 'slot', 'media_id'], isUnique: true, where: 'owner_user_id IS NOT NULL' }));
    await q.createIndex('playlist_item', new TableIndex({ name: 'uq_playlist_public_slot_media', columnNames: ['slot', 'media_id'], isUnique: true, where: 'owner_user_id IS NULL' }));
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query('SELECT COUNT(*) AS n FROM playlist_item WHERE owner_user_id IS NOT NULL');
    if (Number(row.n)) throw new Error('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE: preserve personal playlists before restoring baseline');
    await q.dropIndex('playlist_item', 'uq_playlist_user_slot_media');
    await q.dropIndex('playlist_item', 'uq_playlist_public_slot_media');
    await q.dropIndex('playlist_item', 'ix_playlist_owner');
    await q.dropForeignKey('playlist_item', 'fk_playlist_owner');
    await q.dropColumn('playlist_item', 'owner_user_id');
    await q.createUniqueConstraint('playlist_item', new TableUnique({ name: 'uq_playlist_slot_media', columnNames: ['slot', 'media_id'] }));
  }
}
