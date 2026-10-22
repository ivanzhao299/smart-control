import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../entities/device.entity';
import { DeviceState } from '../entities/device-state.entity';
import { Scene } from '../entities/scene.entity';
import { SceneAction } from '../entities/scene-action.entity';
import { SceneExecution } from '../entities/scene-execution.entity';
import { HvacZone } from '../entities/hvac-zone.entity';
import { HvacIndoor } from '../entities/hvac-indoor.entity';
import { LightGroup } from '../entities/light-group.entity';
import { HardwareUnit } from '../entities/hardware-unit.entity';
import { AdaptersModule } from '../adapters/adapters.module';
import { LogsModule } from '../modules/logs/logs.module';
import { AlertModule } from '../modules/alerts/alert.module';
import { PowerCircuitsModule } from '../modules/power-circuits/power-circuits.module';
import { ServicesPrimitivesModule } from './services-primitives.module';
import { DeviceStatusService } from './device-status.service';
import { CommandDispatcherService } from './command-dispatcher.service';
import { SceneEngineService } from './scene-engine.service';
import { DeviceHealthService } from './device-health.service';
import { SceneLightingService } from './scene-lighting.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Device, DeviceState, Scene, SceneAction, SceneExecution, HvacZone, HvacIndoor, LightGroup, HardwareUnit]),
    ServicesPrimitivesModule,
    AdaptersModule,
    LogsModule,
    AlertModule,
    PowerCircuitsModule,
  ],
  providers: [
    DeviceStatusService,
    CommandDispatcherService,
    SceneEngineService,
    DeviceHealthService,
    SceneLightingService,
  ],
  exports: [
    ServicesPrimitivesModule,
    AlertModule,
    DeviceStatusService,
    CommandDispatcherService,
    SceneEngineService,
    DeviceHealthService,
  ],
})
export class ServicesModule {}
