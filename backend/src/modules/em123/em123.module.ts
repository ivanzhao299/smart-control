import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Em123Meter } from '../../entities/em123-meter.entity';
import { Em123Daily } from '../../entities/em123-daily.entity';
import { Em123Hourly } from '../../entities/em123-hourly.entity';
import { Em123Controller } from './em123.controller';
import { Em123Service } from './em123.service';

/**
 * em123 智慧能源平台模块: 电/水表档案 + 按日用量 + 关口总表小时负荷。
 * 定时只读拉取 + 库表持久化 + 内存聚合缓存 + 大屏只读接口。
 * 独立于 adapters/power 的可控回路体系, 不做任何远程控制。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Em123Meter, Em123Daily, Em123Hourly])],
  controllers: [Em123Controller],
  providers: [Em123Service],
  exports: [Em123Service],
})
export class Em123Module {}
