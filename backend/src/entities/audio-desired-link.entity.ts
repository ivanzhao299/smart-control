import { Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * 音频矩阵的**期望状态** — 单个交叉点 (OUT ← IN) 该不该通。
 *
 * 为什么需要这张表 (2026-07-17 根因):
 * EKX808 断电重启后会回到**它自己的开机预设**, 把现场配好的路由和增益全部冲掉。
 * 2026-07-17 实测: 夜里配好的 IN1→各区 / IN4→OUT5 全没了, 只剩预设里的
 * IN3→全部; 增益也被打回 IN1=+12 / IN2=-60 / IN3=+3.6 / IN4=-60。大屏和背景
 * 音乐同时哑掉, 而 PC 侧两路端点峰值都是 1.0 (声音出来了, 是矩阵不给过)。
 *
 * 在此之前, 矩阵路由只存在**一个本地 JSON 文件**里 (audio.controller 的
 * matrix/state, 已废弃) —— 那只是"前端点过什么"的记录, 从不回写设备, 所以
 * 期望状态**根本没有可靠存储**, 这才是它守不住的结构性原因。
 *
 * 业主 2026-07-17 定的方案 (比改设备预设更好: 设备预设也只是"另一个会被人改掉
 * 的地方", 而这里有 DB、有审计):
 *   "只需要我们的前端功能保持好预设... 每次连到矩阵先读取状态, 如与预设不符,
 *    就让其按我们的预设配置"
 *
 * 谁写这张表: 业主在界面上点交叉点 = **修改期望值** (不是漂移)。
 * 谁读这张表: AudioReconciler —— 见 audio-reconciler.service.ts。
 */
@Entity({ name: 'audio_desired_link' })
@Unique('uq_audio_desired_link', ['outCh', 'inCh'])
export class AudioDesiredLink {
  @PrimaryGeneratedColumn()
  id!: number;

  /** EKX 协议 0-based 输出索引 (0=OUT1 一楼门厅 ... 7=OUT8 二楼办公区) */
  @Column({ type: 'int', name: 'out_ch' })
  outCh!: number;

  /** EKX 协议 0-based 输入索引 (0=IN1 中控主机 ... 3=IN4 中控主机2; IN5-8 现场未接线) */
  @Column({ type: 'int', name: 'in_ch' })
  inCh!: number;

  /** 期望这个交叉点是通的吗 */
  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
