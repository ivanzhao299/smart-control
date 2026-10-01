import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PowerSchedule } from '../../entities/power-schedule.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuitsModule } from '../power-circuits/power-circuits.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PowerSchedulesController } from './power-schedules.controller';
import { PowerSchedulesService } from './power-schedules.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([PowerSchedule, PowerCircuit, HardwareUnit]),
    PowerCircuitsModule,
    AdminAuthModule,
  ],
  controllers: [PowerSchedulesController],
  providers: [PowerSchedulesService],
  exports: [PowerSchedulesService],
})
export class PowerSchedulesModule {}
