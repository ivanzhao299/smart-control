import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AudioOutputZone } from '../../entities/audio-output-zone.entity';
import { AudioScene } from '../../entities/audio-scene.entity';
import { AudioConfigController } from './audio-config.controller';
import { AudioConfigService } from './audio-config.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([AudioOutputZone, AudioScene]), AdminAuthModule],
  controllers: [AudioConfigController],
  providers: [AudioConfigService],
  exports: [AudioConfigService],
})
export class AudioConfigModule {}
