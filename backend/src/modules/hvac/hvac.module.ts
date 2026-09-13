import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptersModule } from '../../adapters/adapters.module';
import { HvacZone } from '../../entities/hvac-zone.entity';
import { HvacIndoor } from '../../entities/hvac-indoor.entity';
import { LogsModule } from '../logs/logs.module';
import { HvacController } from './hvac.controller';

@Module({
  // HvacIndoor: 内机是一等公民 (可改名 / 可编组); HvacZone 只是组名 + 楼层,
  // 成员关系存在 HvacIndoor.zoneCode 上, 不在 zone 里存内机清单.
  imports: [TypeOrmModule.forFeature([HvacZone, HvacIndoor]), AdaptersModule, LogsModule],
  controllers: [HvacController],
})
export class HvacModule {}
