import { Module } from '@nestjs/common';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { VideoBindingController } from './video-binding.controller';
import { VideoBindingService } from './video-binding.service';
import { ParkOpsControlController } from './park-ops-control.controller';

@Module({
  controllers: [CamerasController, VideoBindingController, ParkOpsControlController],
  providers: [CamerasService, VideoBindingService],
  exports: [CamerasService, VideoBindingService],
})
export class CamerasModule {}
