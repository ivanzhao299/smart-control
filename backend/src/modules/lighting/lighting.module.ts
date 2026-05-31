import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { LightingController } from './lighting.controller';
import { LightZonesModule } from '../light-zones/light-zones.module';

@Module({
  imports: [AdaptersModule, LogsModule, LightZonesModule],
  controllers: [LightingController],
})
export class LightingModule {}
