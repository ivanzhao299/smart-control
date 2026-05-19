import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { HvacController } from './hvac.controller';

@Module({
  imports: [AdaptersModule, LogsModule],
  controllers: [HvacController],
})
export class HvacModule {}
