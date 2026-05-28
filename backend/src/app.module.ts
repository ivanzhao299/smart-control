import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './common/config/configuration';
import { TypeOrmConfigService } from './common/config/typeorm.config';
import { LoggerModule } from './common/logger/logger.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { HealthModule } from './modules/health/health.module';
import { DevicesModule } from './modules/devices/devices.module';
import { ScenesModule } from './modules/scenes/scenes.module';
import { LogsModule } from './modules/logs/logs.module';
import { UsersModule } from './modules/users/users.module';
import { SystemModule } from './modules/system/system.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { LightingModule } from './modules/lighting/lighting.module';
import { LedModule } from './modules/led/led.module';
import { AudioModule } from './modules/audio/audio.module';
import { HvacModule } from './modules/hvac/hvac.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { SceneExecutionsModule } from './modules/scene-executions/scene-executions.module';
import { AlertModule } from './modules/alerts/alert.module';
import { TestCenterModule } from './modules/test-center/test-center.module';
import { UatModule } from './modules/uat/uat.module';
import { HardwareModule } from './modules/hardware/hardware.module';
import { MediaModule } from './modules/media/media.module';
import { DriversModule } from './modules/drivers/drivers.module';
import { AdaptersModule } from './adapters/adapters.module';
import { ServicesModule } from './services/services.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    LoggerModule,
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
    AdaptersModule,
    ServicesModule,
    HealthModule,
    SystemModule,
    UsersModule,
    LogsModule,
    DevicesModule,
    ScenesModule,
    LightingModule,
    LedModule,
    AudioModule,
    HvacModule,
    SchedulerModule,
    SceneExecutionsModule,
    AlertModule,
    TestCenterModule,
    UatModule,
    HardwareModule,
    MediaModule,
    DriversModule,
    WebsocketModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
