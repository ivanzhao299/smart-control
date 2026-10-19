import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Em123Meter } from '../../entities/em123-meter.entity';
import { Em123Daily } from '../../entities/em123-daily.entity';
import { Em123Hourly } from '../../entities/em123-hourly.entity';
import { Em123WriteLog } from '../../entities/em123-write-log.entity';
import { Em123Controller } from './em123.controller';
import { Em123Service } from './em123.service';

/**
 * em123 智慧能源平台模块: 电/水表档案 + 按日用量 + 关口总表小时负荷 + 写操作审计流水。
 * 一期只读拉取/聚合/导出; 二期改名/档案/现金录入/退费, 三期拉合闸/校时/费率(写操作全留痕)。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Em123Meter, Em123Daily, Em123Hourly, Em123WriteLog])],
  controllers: [Em123Controller],
  providers: [Em123Service],
  exports: [Em123Service],
})
export class Em123Module {}
