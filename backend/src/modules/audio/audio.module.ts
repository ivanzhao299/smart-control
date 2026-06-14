import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { AudioConfigModule } from '../audio-config/audio-config.module';
import { AudioController } from './audio.controller';

@Module({
  imports: [AdaptersModule, LogsModule, AudioConfigModule],
  controllers: [AudioController],
})
export class AudioModule {}
