import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptersModule } from '../../adapters/adapters.module';
import { LogsModule } from '../logs/logs.module';
import { AudioConfigModule } from '../audio-config/audio-config.module';
import { AudioController } from './audio.controller';
import { AudioReconcilerService } from './audio-reconciler.service';
import { AudioDesiredLink } from '../../entities/audio-desired-link.entity';
import { AudioInputSource } from '../../entities/audio-input-source.entity';

@Module({
  imports: [
    AdaptersModule,
    LogsModule,
    AudioConfigModule,
    TypeOrmModule.forFeature([AudioDesiredLink, AudioInputSource]),
  ],
  controllers: [AudioController],
  providers: [AudioReconcilerService],
  exports: [AudioReconcilerService],
})
export class AudioModule {}
