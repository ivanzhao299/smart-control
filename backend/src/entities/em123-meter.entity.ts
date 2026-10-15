import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * em123 表计档案 + 最新状态 (Em123Meter) — 智慧能源管理平台 (2026-10-14).
 *
 * 每块电/水表一条, 以 meter_no (表号) 为业务键, 定时同步时 upsert 覆盖。
 *   - meterType: 'E'=电表 / 'W'=水表。
 *   - kind:      'master'=楼栋/关口总表(三相或楼栋总水表) / 'household'=分户表。
 *   - zone:      分区 A/B/C/D/E (字母分区); 公寓配套区(F3公寓/板房/院/沿街)为空。
 *   - areaGroup: 公寓配套区域分组(F3公寓/北院/东板房/南板房/北沿街)。
 *   - building:  楼栋键(如 A4/B3/E2); 公寓配套区取区域名。
 *   - room:      房间号(101/201…), 仅分户表有。
 *   - multiply:  CT 倍率; 实时读数 readingKwh = readingValue × multiply。
 *   - chargeMoney: 账户余额, 负数=欠费; 总表大额负余额属内部核算口径。
 *   - meterStatus: 平台合/拉闸(阀)状态, '0'=合闸(通) / '1'=拉闸(断)。
 *
 * 本期只读取数/状态, 不做远程拉合闸控制。
 */
@Entity({ name: 'em123_meter' })
@Index('ix_em123_meter_type_kind', ['meterType', 'kind'])
export class Em123Meter {
  /** 表号 (平台业务键, 主键; upsert 幂等) */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'meter_no' })
  meterNo!: string;

  /** 表类型: E=电 / W=水 */
  @Column({ type: 'varchar', length: 2, name: 'meter_type' })
  meterType!: string;

  /** 平台名称(住房名)原样, 如 "E2-1电表" / "F3公寓楼101电表" */
  @Column({ type: 'varchar', length: 128, name: 'meter_name' })
  meterName!: string;

  /** 平台住房/业主档案 id */
  @Column({ type: 'varchar', length: 32, name: 'house_id', nullable: true })
  houseId!: string | null;

  /** 分区 A/B/C/D/E (字母分区); 公寓配套区为空 */
  @Column({ type: 'varchar', length: 8, name: 'zone', nullable: true })
  zone!: string | null;

  /** 公寓配套区域分组: F3公寓/北院/东板房/南板房/北沿街 */
  @Column({ type: 'varchar', length: 32, name: 'area_group', nullable: true })
  areaGroup!: string | null;

  /** 楼栋键, 如 A4/B3/E2/B1; 公寓配套区取区域名 */
  @Column({ type: 'varchar', length: 32, name: 'building', nullable: true })
  building!: string | null;

  /** 楼栋展示名, 如 "A区4栋" / "F3公寓" */
  @Column({ type: 'varchar', length: 64, name: 'building_name', nullable: true })
  buildingName!: string | null;

  /** 房间号(101/201…), 仅分户表有 */
  @Column({ type: 'varchar', length: 16, name: 'room', nullable: true })
  room!: string | null;

  /** 表计角色: master=总表 / household=分户表 */
  @Column({ type: 'varchar', length: 12, default: 'household' })
  kind!: string;

  /** 表计型号编码 */
  @Column({ type: 'varchar', length: 32, name: 'meter_model', nullable: true })
  meterModel!: string | null;

  /** 表计型号名称, 如 DDZY314-Z / DTZY314-Z */
  @Column({ type: 'varchar', length: 64, name: 'model_name', nullable: true })
  modelName!: string | null;

  /** 内置 4G 模组 IMEI */
  @Column({ type: 'varchar', length: 32, name: 'device_imei', nullable: true })
  deviceImei!: string | null;

  /** 通信方式, 如 4G */
  @Column({ type: 'varchar', length: 16, name: 'conn_type', nullable: true })
  connType!: string | null;

  /** CT 倍率, 默认 1 */
  @Column({ type: 'double precision', name: 'multiply', default: 1 })
  multiply!: number;

  /** 电价/水价方案名 */
  @Column({ type: 'varchar', length: 64, name: 'price_name', nullable: true })
  priceName!: string | null;

  /** 原始字轮读数(未乘倍率) */
  @Column({ type: 'double precision', name: 'reading_value', default: 0 })
  readingValue!: number;

  /** 折算后读数 = readingValue × multiply (电 kWh / 水 t) */
  @Column({ type: 'double precision', name: 'reading_kwh', default: 0 })
  readingKwh!: number;

  /** 平台读数时间字符串 */
  @Column({ type: 'varchar', length: 32, name: 'reading_time', nullable: true })
  readingTime!: string | null;

  /** 账户余额(元), 负数=欠费 */
  @Column({ type: 'double precision', name: 'charge_money', default: 0 })
  chargeMoney!: number;

  /** 在线状态: online/offline */
  @Column({ type: 'varchar', length: 12, name: 'online_status', default: 'offline' })
  onlineStatus!: string;

  /** 合/拉闸(阀)状态: '0'=合闸(通) / '1'=拉闸(断) */
  @Column({ type: 'varchar', length: 4, name: 'meter_status', nullable: true })
  meterStatus!: string | null;

  /** 告警文案 */
  @Column({ type: 'varchar', length: 128, name: 'alarm_name', nullable: true })
  alarmName!: string | null;

  /** 列表排序(按平台名称) */
  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
