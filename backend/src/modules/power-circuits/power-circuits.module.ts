import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuitsController } from './power-circuits.controller';
import { PowerCircuitsService } from './power-circuits.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdaptersModule } from '../../adapters/adapters.module';

@Module({
  imports: [TypeOrmModule.forFeature([PowerCircuit, HardwareUnit]), AdminAuthModule, AdaptersModule],
  controllers: [PowerCircuitsController],
  providers: [PowerCircuitsService],
  exports: [PowerCircuitsService],
})
export class PowerCircuitsModule {}
