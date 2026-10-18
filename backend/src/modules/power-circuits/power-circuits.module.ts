import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { PowerDomain } from '../../entities/power-domain.entity';
import { PowerDomainRoleGrant } from '../../entities/power-domain-role-grant.entity';
import { User } from '../../entities/user.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuitsController } from './power-circuits.controller';
import { PowerCircuitsService } from './power-circuits.service';
import { PowerDomainGrantService } from './power-domain-grant.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdaptersModule } from '../../adapters/adapters.module';
import { ServicesPrimitivesModule } from '../../services/services-primitives.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PowerCircuit, PowerDomain, HardwareUnit, PowerDomainRoleGrant, User]),
    AdminAuthModule,
    AdaptersModule,
    ServicesPrimitivesModule,
  ],
  controllers: [PowerCircuitsController],
  providers: [PowerCircuitsService, PowerDomainGrantService],
  exports: [PowerCircuitsService, PowerDomainGrantService],
})
export class PowerCircuitsModule {}
