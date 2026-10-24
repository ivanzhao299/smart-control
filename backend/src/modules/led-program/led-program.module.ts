import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedProgram } from '../../entities/led-program.entity';
import { LedProgramSegment } from '../../entities/led-program-segment.entity';
import { Device } from '../../entities/device.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { PowerSchedule } from '../../entities/power-schedule.entity';
import { LedProgramService } from './led-program.service';
import { LedProgramController } from './led-program.controller';
import { LedAutoPlayService } from './led-auto-play.service';
import { PvePowerService } from './pve-power.service';

@Module({
  imports: [TypeOrmModule.forFeature([LedProgram, LedProgramSegment, Device, HardwareUnit, PowerCircuit, PowerSchedule])],
  providers: [LedProgramService, LedAutoPlayService, PvePowerService],
  controllers: [LedProgramController],
  exports: [LedProgramService, PvePowerService],
})
export class LedProgramModule {}
