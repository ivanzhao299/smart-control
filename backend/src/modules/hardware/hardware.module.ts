import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptersModule } from '../../adapters/adapters.module';
import { Device } from '../../entities/device.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { LogsModule } from '../logs/logs.module';
import { AuditModule } from '../audit/audit.module';
import { HardwareController } from './hardware.controller';
import { HardwareService } from './hardware.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([HardwareUnit, Device]),
    LogsModule,
    AuditModule,
    // 让 controller 能 invalidate CyDali64aAdapter 的 DB 缓存
    AdaptersModule,
  ],
  controllers: [HardwareController],
  providers: [HardwareService],
  exports: [TypeOrmModule, HardwareService],
})
export class HardwareModule {}
