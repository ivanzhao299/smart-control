import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { DriversController } from './drivers.controller';
import { DriverRegistryService } from './driver-registry.service';
import { BrandsModule } from '../brands/brands.module';

@Module({
  imports: [TypeOrmModule.forFeature([DriverTemplate]), BrandsModule],
  controllers: [DriversController],
  providers: [DriverRegistryService],
  exports: [DriverRegistryService, TypeOrmModule],
})
export class DriversModule {}
