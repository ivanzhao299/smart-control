import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 客户端鉴权 — 业主访问 PWA / 未来 APP 时的密码门禁.
 *
 * 跟 admin-auth 的区别:
 *   - admin-auth: 进 /admin 后台前的管理员口令 (维护方持)
 *   - client-auth: 进 PWA 主界面前的业主口令 (业主持, 也分给现场操作人员)
 *
 * 设计: 单行表 (id=1), 启动时如不存在写默认密码 1234.
 * 业主进后台后改成自己的, 也分给手机/平板用. 改了之后已 login 的 session
 * 全部失效, 强制全员重登 (passwordChangedAt > token.issuedAt 即失效).
 *
 * 为啥前端要这个: 业主原话 "为后续生成 APP 作准备" — APP 装到不同设备,
 * 不能让任何人开 APP 就直接控展厅设备, 加道密码门是基本.
 */
@Entity({ name: 'client_auth_v1' })
export class ClientAuth {
  @PrimaryGeneratedColumn()
  id!: number;

  /** scrypt 哈希后密码, 跟 admin-auth 同套 */
  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  /** 改密时间, 用于让早签发的 token 失效 */
  @Column({ type: 'datetime' })
  passwordChangedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
