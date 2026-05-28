import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 驱动模板 (Driver Template)
 *
 * 描述系统"支持哪些品牌哪些型号、各自能做什么、需要什么参数".
 * 不是设备实例(实例在 hardware_unit), 而是设备类的"说明书".
 *
 * 两种来源:
 *   - builtin = true:  代码里有 driver class, 启动时 upsert 进 DB. 用户不能编辑.
 *   - builtin = false: UI 创建的"挂壳"模板, 协议帧编解码必须仍由代码里某个 adapter 提供
 *                       (P4 阶段加, 用来给同协议族下的新品牌做轻量配置而不写代码).
 *
 * 类比 HomeAssistant 的 integration / Niagara 的 NDriver:
 *   - kind        = "cy-dali64a" / "nova-vx" / "ekx-808" / "zhonghong-mbt"
 *   - vendor      = 厂商
 *   - protocol    = 底层协议族 (modbus-rtu / modbus-tcp / nova-vx-tcp / custom-tcp)
 *   - capabilities = 这个驱动能做什么 (turn_on/turn_off/set_brightness/recall_scene/...)
 *   - paramSchema  = 实例化时要填什么参数 (IP / slaveId / port / addressing)
 */
@Entity({ name: 'driver_templates' })
export class DriverTemplate {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 驱动唯一标识, e.g. "cy-dali64a" / "nova-vx" / "ekx-808" / "zhonghong-mbt" */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  kind!: string;

  /** 显示名 (e.g. "元创智控 CY-DALI64A (DALI 网关)") */
  @Column({ type: 'varchar', length: 128 })
  displayName!: string;

  /** 厂商 (e.g. "元创智控", "诺瓦 NovaStar", "得胜 TAKSTAR") */
  @Column({ type: 'varchar', length: 64 })
  vendor!: string;

  /** 设备品类 (lighting / led / audio / hvac / ...) */
  @Index()
  @Column({ type: 'varchar', length: 32 })
  category!: string;

  /** 底层协议族 (modbus-rtu / modbus-tcp / nova-vx-tcp / takstar-ekx-tcp / ...) */
  @Column({ type: 'varchar', length: 64 })
  protocol!: string;

  /**
   * 能力清单 JSON: 一个字符串数组, 列驱动对外暴露的命令.
   *   ["turn_on","turn_off","set_brightness","recall_scene"]
   */
  @Column({ type: 'text' })
  capabilitiesJson!: string;

  /**
   * 默认寻址 JSON: 实例化时 addressing 字段的脚手架.
   *   {"slaveId":1,"port":502}  (DALI)
   *   {"box":"1","port":5200}    (Nova)
   *   {"tcpPort":5000,"devAddr":1} (EKX-808)
   */
  @Column({ type: 'text', nullable: true })
  defaultAddressingJson!: string | null;

  /**
   * 实例化参数 schema (JSON Schema-like 子集, 给前端动态生成表单):
   *   {
   *     "ip":      {"type":"string","label":"IP 地址","required":true,"placeholder":"192.168.x.x"},
   *     "port":    {"type":"number","label":"端口","default":502},
   *     "slaveId": {"type":"number","label":"Modbus 从机号","default":1,"min":1,"max":247}
   *   }
   */
  @Column({ type: 'text', nullable: true })
  paramSchemaJson!: string | null;

  /** 备注 / 配套文档链接 */
  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  /** 代码内置 (启动时由 adapter.describe() 同步) 还是 UI 创建 */
  @Column({ type: 'boolean', default: true })
  builtin!: boolean;

  /** 启用 (禁用后实例化时不显示在下拉里) */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
