import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../../entities/device.entity';
import { ServicesModule } from '../../services/services.module';
import { AdaptersModule } from '../../adapters/adapters.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device]), ServicesModule, AdaptersModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
