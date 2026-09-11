import { Module } from '@nestjs/common';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { VideoBindingController } from './video-binding.controller';
import { VideoBindingService } from './video-binding.service';

@Module({
  controllers: [CamerasController, VideoBindingController],
  providers: [CamerasService, VideoBindingService],
  exports: [CamerasService, VideoBindingService],
})
export class CamerasModule {}
