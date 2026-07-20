import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { AdaptersModule } from '../../adapters/adapters.module';
import { AlertModule } from '../alerts/alert.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';
import { SiteHeartbeatService } from './site-heartbeat.service';

@Module({
  // AlertModule: 站点失联时要能开告警 (alerts 不反向依赖 system, 单向无环)
  imports: [ServicesModule, AdaptersModule, AlertModule],
  controllers: [SystemController],
  providers: [SystemService, SiteHeartbeatService],
  exports: [SystemService, SiteHeartbeatService],
})
export class SystemModule {}
