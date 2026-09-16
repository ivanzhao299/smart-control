import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Current authoritative value for a versioned runtime configuration domain. */
@Entity({ name: 'runtime_config_documents' })
export class RuntimeConfigDocument {
  @PrimaryColumn({ type: 'varchar', length: 100, name: 'config_key' })
  key!: string;

  @Column({ type: 'integer', name: 'schema_version' })
  schemaVersion!: number;

  @Column({ type: 'integer' })
  revision!: number;

  @Column({ type: 'text' })
  document!: string;

  @Column({ type: 'varchar', length: 64, name: 'document_sha256' })
  documentSha256!: string;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', name: 'updated_at' })
  updatedAt!: Date;
}
