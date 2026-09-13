import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { SystemBrandingModule } from '../system-branding/system-branding.module';
import { PlaybackModule } from '../playback/playback.module';
import { LedController } from './led.controller';

@Module({
  imports: [AdaptersModule, LogsModule, SystemBrandingModule, PlaybackModule],
  controllers: [LedController],
})
export class LedModule {}
