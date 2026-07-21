import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { LightingController } from './lighting.controller';
import { LightZonesModule } from '../light-zones/light-zones.module';
import { DaliLightsModule } from '../dali-lights/dali-lights.module';

@Module({
  // DaliLightsModule: 分区控制"单灯优先"要用 DaliLightsService.controlZone (逐灯直控)
  imports: [AdaptersModule, LogsModule, LightZonesModule, DaliLightsModule],
  controllers: [LightingController],
})
export class LightingModule {}
