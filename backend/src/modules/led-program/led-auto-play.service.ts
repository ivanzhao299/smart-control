/**
 * LED 定时轮播引擎
 *
 * 每分钟检查一次：
 *   1. 读 power_schedules 表，判断 1f-led 回路当前是否在"通电时段"内
 *   2. 通电时段内：轮播已入库的 BIN 节目，按顺序自动推流
 *   3. 节日当天自动优先选择节日模板节目
 *   4. 断电时段不动作（屏都关了没必要推）
 *
 * 轮播规则：
 *   - 从 led_program 表按 id 顺序轮播
 *   - 节日当天优先推 template_type = 节日模板的节目
 *   - 30 分钟切换一次（避免频繁推流打扰 PVE）
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LedProgram } from '../../entities/led-program.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { PowerSchedule } from '../../entities/power-schedule.entity';
import { LedProgramService } from './led-program.service';
import { getFestivalTemplate } from './led-templates';

@Injectable()
export class LedAutoPlayService implements OnModuleInit {
  private readonly logger = new Logger(LedAutoPlayService.name);
  private lastPushedProgramId: number | null = null;
  private lastPushTime: Date | null = null;
  private wasPowerOn = false;

  constructor(
    @InjectRepository(LedProgram)
    private readonly programRepo: Repository<LedProgram>,
    @InjectRepository(PowerCircuit)
    private readonly circuitRepo: Repository<PowerCircuit>,
    @InjectRepository(PowerSchedule)
    private readonly scheduleRepo: Repository<PowerSchedule>,
    private readonly ledSvc: LedProgramService,
  ) {}

  onModuleInit() {
    this.logger.log('LED 自动轮播引擎已启动（每分钟检查）');
  }

  /**
   * 根据 power_schedules 计算当前是否在 LED 通电时段内。
   * 逻辑：找 1f-led 回路的所有 enabled schedules，
   *   - 找 action=on 的时间点和 action=off 的时间点
   *   - 当前时间在 on..off 之间 = 通电
   */
  private async isLedPowerWindow(): Promise<boolean> {
    try {
      const circuit = await this.circuitRepo.findOne({ where: { code: '1f-led' } });
      if (!circuit) return false;

      const schedules = await this.scheduleRepo.find({
        where: { circuitId: circuit.id, enabled: true },
      });
      if (!schedules.length) return false; // 没有定时计划 = 默认不通电

      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay(); // 1=周一..7=周日

      // 收集今天的 on/off 时间点
      const onTimes: number[] = [];
      const offTimes: number[] = [];

      for (const s of schedules) {
        // 检查星期
        if (s.weekdays) {
          const days = s.weekdays.split(',').map(d => parseInt(d.trim(), 10));
          if (!days.includes(dayOfWeek)) continue;
        }
        if (!s.time) continue;
        const [h, m] = s.time.split(':').map(Number);
        const minutes = h * 60 + m;
        if (s.action === 'on') onTimes.push(minutes);
        else offTimes.push(minutes);
      }

      if (!onTimes.length || !offTimes.length) return false;

      // 简单判断：找最近一个 on 时间点，看之后有没有 off 时间点
      const lastOn = Math.max(...onTimes);
      const firstOffAfterOn = offTimes.find(t => t > lastOn);

      // 跨天处理：如果 on 在晚上，off 在第二天
      if (lastOn > (firstOffAfterOn ?? 24 * 60)) {
        // on 在晚上，off 在第二天凌晨
        return nowMin >= lastOn || nowMin < (firstOffAfterOn ?? 0);
      }

      return nowMin >= lastOn && nowMin < (firstOffAfterOn ?? 24 * 60);
    } catch (e) {
      this.logger.warn(`计算播放时段失败: ${(e as Error).message}`);
      return false;
    }
  }

  /** 选下一个要播的节目 */
  private async pickNextProgram(): Promise<LedProgram | null> {
    const festivalType = getFestivalTemplate(new Date());

    // 节日当天：优先选节日模板的节目
    if (festivalType) {
      const fest = await this.programRepo.findOne({
        where: { templateType: festivalType },
        order: { createdAt: 'DESC' },
      });
      if (fest) return fest;
    }

    // 日常：轮播所有节目，排除上一次播的
    const all = await this.programRepo.find({
      order: { id: 'ASC' },
      take: 50,
    });
    if (!all.length) return null;

    if (this.lastPushedProgramId !== null) {
      const idx = all.findIndex(p => p.id === this.lastPushedProgramId);
      if (idx >= 0 && idx < all.length - 1) return all[idx + 1];
    }
    return all[0];
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    const powerOn = await this.isLedPowerWindow();

    // 刚进入通电时段：记录状态，等 2 分钟让屏体预热再推
    if (powerOn && !this.wasPowerOn) {
      this.logger.log('进入 LED 通电时段，预热中…2分钟后开始轮播');
      this.wasPowerOn = true;
      return;
    }

    // 刚进入断电时段：重置
    if (!powerOn && this.wasPowerOn) {
      this.logger.log('进入 LED 断电时段，停止轮播');
      this.wasPowerOn = false;
      this.lastPushedProgramId = null;
      this.lastPushTime = null;
      return;
    }

    if (!powerOn) return;

    // 已通电：30 分钟切换一次
    const now = new Date();
    if (this.lastPushTime && (now.getTime() - this.lastPushTime.getTime()) < 30 * 60 * 1000) {
      return;
    }

    const next = await this.pickNextProgram();
    if (!next) {
      this.logger.debug('无可用节目，等待手动生成或前端自动编排');
      return;
    }

    try {
      await this.ledSvc.push(next.id);
      this.lastPushedProgramId = next.id;
      this.lastPushTime = now;
      this.logger.log(`自动轮播：推流节目 #${next.id}「${next.name}」`);
    } catch (e) {
      this.logger.warn(`自动推流失败 #${next.id}: ${(e as Error).message}`);
    }
  }
}
