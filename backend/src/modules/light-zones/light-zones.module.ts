import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LightZone } from '../../entities/light-zone.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { LightZonesController } from './light-zones.controller';
import { LightZonesService } from './light-zones.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([LightZone, HardwareUnit]), AdminAuthModule],
  controllers: [LightZonesController],
  providers: [LightZonesService],
  exports: [LightZonesService],
})
export class LightZonesModule {}
