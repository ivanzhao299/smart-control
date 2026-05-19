import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../entities/device.entity';
import { Scene } from '../entities/scene.entity';
import { SceneAction } from '../entities/scene-action.entity';
import { AdaptersModule } from '../adapters/adapters.module';
import { LogsModule } from '../modules/logs/logs.module';
import { ServicesPrimitivesModule } from './services-primitives.module';
import { DeviceStatusService } from './device-status.service';
import { CommandDispatcherService } from './command-dispatcher.service';
import { SceneEngineService } from './scene-engine.service';
import { DeviceHealthService } from './device-health.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, Scene, SceneAction]),
    ServicesPrimitivesModule,
    AdaptersModule,
    LogsModule,
  ],
  providers: [
    DeviceStatusService,
    CommandDispatcherService,
    SceneEngineService,
    DeviceHealthService,
  ],
  exports: [
    ServicesPrimitivesModule,
    DeviceStatusService,
    CommandDispatcherService,
    SceneEngineService,
    DeviceHealthService,
  ],
})
export class ServicesModule {}
