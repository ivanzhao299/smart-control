import { Module } from '@nestjs/common';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { VideoBindingController } from './video-binding.controller';
import { VideoBindingService } from './video-binding.service';
import { ParkOpsControlController } from './park-ops-control.controller';
import { ParkOpsMetricsController } from './park-ops-metrics.controller';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [AdminAuthModule],
  controllers: [CamerasController, VideoBindingController, ParkOpsControlController, ParkOpsMetricsController],
  providers: [CamerasService, VideoBindingService],
  exports: [CamerasService, VideoBindingService],
})
export class CamerasModule {}
