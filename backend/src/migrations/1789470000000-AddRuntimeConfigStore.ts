import { MigrationInterface, QueryRunner, Table, TableForeignKey, TableIndex } from 'typeorm';

export class AddRuntimeConfigStore1789470000000 implements MigrationInterface {
  name = 'AddRuntimeConfigStore1789470000000';

  async up(q: QueryRunner): Promise<void> {
    await q.createTable(
      new Table({
        name: 'runtime_config_documents',
        columns: [
          { name: 'config_key', type: 'varchar', length: '100', isPrimary: true },
          { name: 'schema_version', type: 'integer' },
          { name: 'revision', type: 'integer' },
          { name: 'document', type: 'text' },
          { name: 'document_sha256', type: 'varchar', length: '64' },
          { name: 'created_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );

    await q.createTable(
      new Table({
        name: 'runtime_config_revisions',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'config_key', type: 'varchar', length: '100' },
          { name: 'schema_version', type: 'integer' },
          { name: 'revision', type: 'integer' },
          { name: 'document', type: 'text' },
          { name: 'document_sha256', type: 'varchar', length: '64' },
          { name: 'actor', type: 'varchar', length: '64', default: "'system'" },
          { name: 'source', type: 'varchar', length: '160', default: "'runtime-config-store'" },
          { name: 'created_at', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
        ],
      }),
    );
    await q.createForeignKey(
      'runtime_config_revisions',
      new TableForeignKey({
        name: 'FK_runtime_config_revisions_document',
        columnNames: ['config_key'],
        referencedTableName: 'runtime_config_documents',
        referencedColumnNames: ['config_key'],
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      }),
    );
    await q.createIndex(
      'runtime_config_revisions',
      new TableIndex({
        name: 'UQ_runtime_config_revisions_key_revision',
        columnNames: ['config_key', 'revision'],
        isUnique: true,
      }),
    );
    await q.createIndex(
      'runtime_config_revisions',
      new TableIndex({
        name: 'IDX_runtime_config_revisions_key',
        columnNames: ['config_key'],
      }),
    );
  }

  async down(q: QueryRunner): Promise<void> {
    const [{ count }] = await q.query('SELECT COUNT(*) AS count FROM runtime_config_documents');
    if (Number(count) > 0) {
      throw new Error('RUNTIME_CONFIG_ROLLBACK_REQUIRES_ARCHIVE: configuration documents exist');
    }
    await q.dropTable('runtime_config_revisions');
    await q.dropTable('runtime_config_documents');
  }
}
