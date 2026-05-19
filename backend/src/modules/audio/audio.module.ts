import { Module } from '@nestjs/common';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { AudioController } from './audio.controller';

@Module({
  imports: [AdaptersModule, LogsModule],
  controllers: [AudioController],
})
export class AudioModule {}
