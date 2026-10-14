import { Module } from '@nestjs/common';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { VideoBindingController } from './video-binding.controller';
import { VideoBindingService } from './video-binding.service';
import { ParkOpsControlController } from './park-ops-control.controller';
import { ParkOpsControlService } from './park-ops-control.service';
import { ParkOpsMetricsController } from './park-ops-metrics.controller';
import { ParkOpsMetricsService } from './park-ops-metrics.service';
import { AiProxyController } from './ai-proxy.controller';
import { AiConfigPusher } from './ai-config.pusher';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { ClientAuthModule } from '../client-auth/client-auth.module';
import { LprModule } from '../lpr/lpr.module';
import { ParkOpsGuard } from './park-ops-guard.guard';

@Module({
  imports: [AdminAuthModule, ClientAuthModule, LprModule],
  controllers: [
    CamerasController,
    VideoBindingController,
    ParkOpsControlController,
    ParkOpsMetricsController,
    AiProxyController,
  ],
  providers: [
    CamerasService,
    VideoBindingService,
    ParkOpsControlService,
    ParkOpsMetricsService,
    AiConfigPusher,
    ParkOpsGuard,
  ],
  exports: [CamerasService, VideoBindingService, AiConfigPusher],
})
export class CamerasModule {}
