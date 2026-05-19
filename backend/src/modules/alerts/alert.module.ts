import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from '../../entities/alert.entity';
import { ServicesPrimitivesModule } from '../../services/services-primitives.module';
import { AlertController } from './alert.controller';
import { AlertService } from './alert.service';

@Module({
  imports: [TypeOrmModule.forFeature([Alert]), ServicesPrimitivesModule],
  controllers: [AlertController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
