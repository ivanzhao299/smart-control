import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { AudioAdapter } from '../../adapters/audio/audio.adapter';
import { AudioDesiredLink } from '../../entities/audio-desired-link.entity';
import { AudioInputSource } from '../../entities/audio-input-source.entity';

/**
 * 音频矩阵对账器 —— 让设备**始终等于我们 DB 里的期望状态**。
 *
 * ## 为什么存在 (2026-07-17 根因)
 * EKX808 断电重启后会回到它自己的开机预设, 把现场配好的路由和增益全冲掉。实测:
 * 夜里配好的 IN1→各区 / IN4→OUT5 全没了, 只剩预设的 IN3→全部; 增益也被打回
 * IN4=-60dB。大屏和背景音乐同时哑, 而 PC 侧两路端点峰值都是 1.0 —— 声音出来了,
 * 是矩阵不给过。业主之前每次都得叫人重配一遍。
 *
 * 业主定的方案 (不改设备预设 —— 那只是"另一个会被人改掉的地方"):
 *   "每次连到矩阵先读取状态, 如与预设不符, 就让其按我们的预设配置"
 *
 * ## 绝不跟人抢控制权
 * 这是硬约束。之前 player-watchdog 就是因为没想过"有人正在操作", 每 5 分钟把业主
 * 从 RDP 踢掉一次。这里绝不重蹈覆辙:
 *   - 业主在界面上点交叉点 / 调增益 = **修改期望值**, 由 controller 同步写进 DB,
 *     所以对账器读到的"期望"永远是最新的, 不会把人的操作当漂移纠回去。
 *   - 任何写操作发生后 QUIET_MS 内不对账 (setMatrix 是异步落到设备的, 立刻读回
 *     可能读到旧值, 那会把用户刚点的又纠回去 —— 就是界面"闪一下弹回去")。
 *   - 只纠**我们明确声明过**的东西: 没有 desiredGainDb 的输入不碰增益; 没有
 *     AudioDesiredLink 记录的交叉点不碰。空 DB = 完全不干预。
 *
 * ## 为什么是轮询而不是"连接时触发"
 * 业主原话是"每次连到矩阵先读取状态"。但 adapter 是**按需短连接 + keepAlive**,
 * 没有可靠的"刚重连"事件; 而且设备可能比后端晚上电 —— 那种情况下只在启动时对一次
 * 账根本补不上。所以改成低频轮询: 一条 READ_FULL_MATRIX ~284ms, 30s 一轮的开销
 * 可以忽略, 却能覆盖"设备半夜自己断电重启"这种任何事件都抓不到的情况。
 */
@Injectable()
export class AudioReconcilerService implements OnModuleInit {
  /**
   * 多久对一次账。
   *
   * 2026-07-18 白天改过一次 30s→10s (想缩短断电重启后的哑音窗口), 当晚复盘发现
   * 是个净负面改动, 已经改回来:
   *
   * EkxDspAdapter 的 TCP 连接 idleTimeoutMs=8000 (刻意设计成这样, 好让业主拿厂家
   * PC Editor 抢连接调试), 意味着**任何大于 8s 的轮询间隔, 每一轮都要重新握手**。
   * 10s 轮询把握手频率从每 30s 一次提到每 10s 一次 (3 倍), 而 EKX-808 是文档里
   * 明确写过的"单客户端设备, 并发连接直接废"的脆弱设备。改完当天 app log 对比:
   * 10s 生效前 (09:05-11:03, ~2h) "读矩阵失败/重连" 类日志约 5 次; 生效后同样
   * 2h 内 (12:31-13:14, 43min 内就有 8 次) —— 频率涨了约 4 倍, 而且当晚那次真正
   * 的"没声音"根本不是矩阵问题 (matrix/live 读出来是对的), 是播放器没把音频路由
   * 到 HDMI (浏览器层, 见 PlayerPage.vue routeVideoAudio), 轮询间隔再短也帮不上。
   * 净效果: 没解决当晚的问题, 反而让本来就脆弱的单客户端连接更频繁地握手/超时。
   */
  private readonly INTERVAL_MS = 30_000;
  /** 最近一次写操作后, 静默多久再对账 (给设备落值的时间, 别把人刚点的纠回去) */
  private readonly QUIET_MS = 5_000;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWriteAt = 0;
  private running = false;

  constructor(
    private readonly audio: AudioAdapter,
    @InjectRepository(AudioDesiredLink)
    private readonly linkRepo: Repository<AudioDesiredLink>,
    @InjectRepository(AudioInputSource)
    private readonly inputRepo: Repository<AudioInputSource>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    this.schedule();
  }

  /**
   * 界面每次写设备后调这个 —— 让对账器安静一会儿。
   * 不是"暂停自愈", 只是等设备把值落稳再读, 避免读到旧值把人的操作纠回去。
   */
  noteWrite(): void {
    this.lastWriteAt = Date.now();
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.INTERVAL_MS);
    // 别让这个定时器把进程钉住不退出 (pm2 restart 时要能干净退)
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    if (Date.now() - this.lastWriteAt < this.QUIET_MS) return;
    this.running = true;
    try {
      await this.reconcile();
    } catch (err) {
      // 设备不在线是常态 (夜里断电), 不刷屏
      this.logger.debug(`[AudioReconciler] 跳过: ${(err as Error).message}`, {
        context: 'AudioReconciler',
      });
    } finally {
      this.running = false;
    }
  }

  /**
   * 读设备 → 跟期望比 → 只补差异。
   * 返回实际纠了多少项, 供 controller 的手动对账接口回显。
   */
  async reconcile(): Promise<{ checked: boolean; linkFixes: number; gainFixes: number; details: string[]; skipped?: string }> {
    const desired = await this.linkRepo.find();
    const inputs = await this.inputRepo.find();
    const wantGain = inputs.filter((i) => i.desiredGainDb !== null || i.desiredMuted !== null);

    // 空 DB = 业主还没声明过期望 -> 什么都不做。绝不"自作主张"去改现场设备。
    if (desired.length === 0 && wantGain.length === 0) {
      return { checked: false, linkFixes: 0, gainFixes: 0, details: [] };
    }

    // mock / 非 EKX 厂家: readFullMatrix 会直接抛。这不是故障, 是这套逻辑只对
    // EKX-808 有意义 —— 安静跳过, 别每 30 秒往日志里刷一条异常。
    if (!this.audio.supportsMatrixReadback()) {
      return { checked: false, linkFixes: 0, gainFixes: 0, details: [], skipped: '当前音频适配器不支持矩阵回读 (mock 或非 EKX-808)' };
    }

    const details: string[] = [];
    let linkFixes = 0;
    let gainFixes = 0;

    // ---- 路由 ----
    if (desired.length > 0) {
      const live = await this.audio.readFullMatrix();
      if (!live.ok || !live.data?.matrix) {
        throw new Error(live.error ?? '读矩阵失败');
      }
      const m = live.data.matrix;
      for (const d of desired) {
        const actual = m[d.outCh]?.[d.inCh];
        if (actual === undefined) continue;
        if (actual !== d.enabled) {
          const r = await this.audio.setMatrix(d.outCh, d.inCh, d.enabled);
          if (r.ok) {
            linkFixes += 1;
            details.push(`OUT${d.outCh + 1}<-IN${d.inCh + 1} ${actual ? 'on' : 'off'} => ${d.enabled ? 'on' : 'off'}`);
          }
        }
      }
    }

    // ---- 增益 / 静音 ----
    // 只读我们声明过期望的那几路 (现场只接了 IN1-IN4), 不用 readInputChannels() ——
    // 那个要逐通道跑 8x2=16 条命令 ~4.2s, 而 EKX 是单客户端串行锁, 会把界面拖卡。
    for (const i of wantGain) {
      const cur = await this.audio.diagnoseInput(i.channel);
      if (!cur.ok || !cur.data) continue;

      // 容差 0.5dB: 设备回的 dB 是 16 位编码换算来的, 会有零点几的抖动。
      // 卡太紧会每轮都"纠正"一个其实已经对了的值, 白打设备。
      if (i.desiredGainDb !== null && cur.data.gainDb !== null
          && Math.abs(cur.data.gainDb - i.desiredGainDb) > 0.5) {
        const r = await this.audio.setInputGainDb(i.channel, i.desiredGainDb);
        if (r.ok) {
          gainFixes += 1;
          details.push(`IN${i.channel + 1} gain ${cur.data.gainDb}dB => ${i.desiredGainDb}dB`);
        }
      }
      if (i.desiredMuted !== null && cur.data.muted !== null && cur.data.muted !== i.desiredMuted) {
        const r = await this.audio.setInputMuted(i.channel, i.desiredMuted);
        if (r.ok) {
          gainFixes += 1;
          details.push(`IN${i.channel + 1} muted ${cur.data.muted} => ${i.desiredMuted}`);
        }
      }
    }

    if (linkFixes + gainFixes > 0) {
      // 这条要显眼: 它意味着设备刚刚漂移过 (多半是断电重启回了开机预设)
      this.logger.warn(
        `[AudioReconciler] 设备与期望不符, 已纠正 ${linkFixes} 条路由 / ${gainFixes} 项增益: ${details.join('; ')}`,
        { context: 'AudioReconciler' },
      );
    }
    return { checked: true, linkFixes, gainFixes, details };
  }
}
