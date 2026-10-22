import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LedProgram } from '../../entities/led-program.entity';
import { LedProgramSegment } from '../../entities/led-program-segment.entity';
import { Device } from '../../entities/device.entity';
import { LedProgramService } from './led-program.service';
import { LedProgramController } from './led-program.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LedProgram, LedProgramSegment, Device])],
  providers: [LedProgramService],
  controllers: [LedProgramController],
  exports: [LedProgramService],
})
export class LedProgramModule {}
