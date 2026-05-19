import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { LedController } from './led.controller';

@Module({
  imports: [AdaptersModule, LogsModule],
  controllers: [LedController],
})
export class LedModule {}
