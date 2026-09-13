import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Brand } from '../../entities/brand.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { BrandsController } from './brands.controller';
import { BrandsService } from './brands.service';

@Module({
  imports: [TypeOrmModule.forFeature([Brand, HardwareUnit, DriverTemplate])],
  controllers: [BrandsController],
  providers: [BrandsService],
  exports: [BrandsService],
})
export class BrandsModule {}
