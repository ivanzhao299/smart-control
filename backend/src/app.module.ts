import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './common/config/configuration';
import { TypeOrmConfigService } from './common/config/typeorm.config';
import { LoggerModule } from './common/logger/logger.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { LatencyInterceptor } from './common/interceptors/latency.interceptor';
import { EtagInterceptor } from './common/interceptors/etag.interceptor';
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
import { BrandsModule } from './modules/brands/brands.module';
import { SystemBrandingModule } from './modules/system-branding/system-branding.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { PlaybackModule } from './modules/playback/playback.module';
import { AuditModule } from './modules/audit/audit.module';
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
    BrandsModule,
    SystemBrandingModule,
    AdminAuthModule,
    PlaybackModule,
    AuditModule,
    WebsocketModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // 顺序: Latency (最外, 测真总耗时) → Etag (304 短路) → Response (包 success)
    { provide: APP_INTERCEPTOR, useClass: LatencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: EtagInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}
