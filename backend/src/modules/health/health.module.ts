import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../../entities/device.entity';
import { ServicesModule } from '../../services/services.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device]), ServicesModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
