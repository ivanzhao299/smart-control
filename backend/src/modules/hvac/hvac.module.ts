import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptersModule } from '../../adapters/adapters.module';
import { HvacZone } from '../../entities/hvac-zone.entity';
import { LogsModule } from '../logs/logs.module';
import { HvacController } from './hvac.controller';

@Module({
  // HvacZone: 功能区升格成 DB 一等公民, 业主可在 PWA 直接改名 (照 LightZone 的做法)
  imports: [TypeOrmModule.forFeature([HvacZone]), AdaptersModule, LogsModule],
  controllers: [HvacController],
})
export class HvacModule {}
