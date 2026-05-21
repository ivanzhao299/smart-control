import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from '../common/config/configuration';
import { TypeOrmConfigService } from '../common/config/typeorm.config';
import { LoggerModule } from '../common/logger/logger.module';
import { Device } from '../entities/device.entity';
import { Scene } from '../entities/scene.entity';
import { SceneAction } from '../entities/scene-action.entity';
import { User } from '../entities/user.entity';
import { OperationLog } from '../entities/operation-log.entity';
import { UatRecord } from '../entities/uat-record.entity';
import { HardwareUnit } from '../entities/hardware-unit.entity';
import { SeedService } from './seed.service';

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
    TypeOrmModule.forFeature([Device, Scene, SceneAction, User, OperationLog, UatRecord, HardwareUnit]),
    // ↑ SceneAction 已在原列表内, seed.service.ts 通过 actionRepo 写入
  ],
  providers: [SeedService],
})
export class SeedModule {}
