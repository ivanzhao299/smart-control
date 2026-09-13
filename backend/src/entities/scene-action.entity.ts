import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Scene } from './scene.entity';

@Entity({ name: 'scene_actions' })
export class SceneAction {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ name: 'scene_id', type: 'int' })
  sceneId!: number;

  @ManyToOne(() => Scene, (scene) => scene.actions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'scene_id' })
  scene!: Scene;

  @Column({ name: 'device_type', type: 'varchar', length: 32 })
  deviceType!: string;

  @Column({ name: 'device_id', type: 'varchar', length: 128 })
  deviceId!: string;

  @Column({ type: 'varchar', length: 64 })
  command!: string;

  @Column({ type: 'text', default: '{}' })
  params!: string;

  @Column({ name: 'delay_ms', type: 'int', default: 0 })
  delayMs!: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
