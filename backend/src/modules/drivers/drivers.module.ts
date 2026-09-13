import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { DriversController } from './drivers.controller';
import { DriverRegistryService } from './driver-registry.service';

@Module({
  imports: [TypeOrmModule.forFeature([DriverTemplate])],
  controllers: [DriversController],
  providers: [DriverRegistryService],
  exports: [DriverRegistryService, TypeOrmModule],
})
export class DriversModule {}
