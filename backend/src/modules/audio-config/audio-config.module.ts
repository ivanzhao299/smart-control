import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioOutputZone } from '../../entities/audio-output-zone.entity';
import { AudioInputSource } from '../../entities/audio-input-source.entity';
import { AudioScene } from '../../entities/audio-scene.entity';
import { AudioConfigController } from './audio-config.controller';
import { AudioConfigService } from './audio-config.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([AudioOutputZone, AudioInputSource, AudioScene]), AdminAuthModule],
  controllers: [AudioConfigController],
  providers: [AudioConfigService],
  exports: [AudioConfigService],
})
export class AudioConfigModule {}
