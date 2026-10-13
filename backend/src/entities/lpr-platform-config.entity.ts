import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * LPR 相机平台接入配置（单行, id 固定为 1）。
 *
 * 记录"相机 web 后台应配置成什么"的标准参数：平台域名、明文/HTTPS 端口、
 * comet/识别/IO/串口四条推送路径。用于：①后台/PWA 展示与新增相机接入指引；
 * ②生成现场配置参数。
 *
 * 重要边界：臻识 HTTP 推送协议**没有远程修改相机推送服务器地址的下行命令**，
 * 该地址保存在相机本地，本系统无法把它远程写进相机。因此这里的改动只更新
 * 系统记录与接入指引：
 *  - 仅换服务器/换 IP（域名不变）：只需改 DNS 的 A 记录，相机无需改动；
 *  - 换域名：需现场逐台登录相机 web 后台（或局域网批量工具）修改。
 */
@Entity({ name: 'lpr_platform_config' })
export class LprPlatformConfig {
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  /** 平台主机（域名，建议始终用域名而非 IP） */
  @Column({ type: 'varchar', length: 128, name: 'host' })
  host!: string;

  /** 明文 HTTP 端口（XLT 新机型只能走 80 明文） */
  @Column({ type: 'integer', name: 'http_port', default: 80 })
  httpPort!: number;

  /** HTTPS 端口（C5H 老机型可走 443） */
  @Column({ type: 'integer', name: 'https_port', default: 443 })
  httpsPort!: number;

  /** comet 轮询路径（心跳 + 下行命令通道） */
  @Column({ type: 'varchar', length: 128, name: 'comet_path', default: '/api/lpr/comet' })
  cometPath!: string;

  /** 车牌识别结果推送路径 */
  @Column({ type: 'varchar', length: 128, name: 'plate_path', default: '/api/lpr/plate' })
  platePath!: string;

  /** 端口(IO)触发推送路径 */
  @Column({ type: 'varchar', length: 128, name: 'gio_path', default: '/api/lpr/gio' })
  gioPath!: string;

  /** 串口(485)数据推送路径 */
  @Column({ type: 'varchar', length: 128, name: 'serial_path', default: '/api/lpr/serial' })
  serialPath!: string;

  /** 道闸状态推送路径 (cmd=barr_gate_status_notify, 相机在道闸状态改变时主动推送) */
  @Column({ type: 'varchar', length: 128, name: 'gate_status_path', default: '/api/lpr/gate-status' })
  gateStatusPath!: string;

  /** 备注（能力边界说明等, 可空） */
  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
