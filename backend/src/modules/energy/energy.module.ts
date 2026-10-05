import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { EnergyDaily } from '../../entities/energy-daily.entity';
import { EnergyController } from './energy.controller';
import { EnergyService } from './energy.service';
import { AdaptersModule } from '../../adapters/adapters.module';
import { ServicesPrimitivesModule } from '../../services/services-primitives.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PvModule } from '../pv/pv.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PowerCircuit, HardwareUnit, EnergyDaily]),
    AdaptersModule,
    ServicesPrimitivesModule,
    AdminAuthModule,
    PvModule,
  ],
  controllers: [EnergyController],
  providers: [EnergyService],
  exports: [EnergyService],
})
export class EnergyModule {}
