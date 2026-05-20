import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { LogsModule } from '../logs/logs.module';
import { HardwareController } from './hardware.controller';
import { HardwareService } from './hardware.service';

@Module({
  imports: [TypeOrmModule.forFeature([HardwareUnit]), LogsModule],
  controllers: [HardwareController],
  providers: [HardwareService],
  exports: [TypeOrmModule, HardwareService],
})
export class HardwareModule {}
