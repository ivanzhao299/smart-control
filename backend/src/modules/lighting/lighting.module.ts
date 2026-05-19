import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { LightingController } from './lighting.controller';

@Module({
  imports: [AdaptersModule, LogsModule],
  controllers: [LightingController],
})
export class LightingModule {}
