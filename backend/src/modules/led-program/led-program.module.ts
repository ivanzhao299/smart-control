import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedProgram } from '../../entities/led-program.entity';
import { LedProgramSegment } from '../../entities/led-program-segment.entity';
import { Device } from '../../entities/device.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { LedProgramService } from './led-program.service';
import { LedProgramController } from './led-program.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LedProgram, LedProgramSegment, Device, HardwareUnit])],
  providers: [LedProgramService],
  controllers: [LedProgramController],
  exports: [LedProgramService],
})
export class LedProgramModule {}
