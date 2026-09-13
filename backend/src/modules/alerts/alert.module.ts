import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from '../../entities/alert.entity';
import { ServicesPrimitivesModule } from '../../services/services-primitives.module';
import { AlertController } from './alert.controller';
import { AlertService } from './alert.service';
import { AlertNotifierService } from './alert-notifier.service';

@Module({
  imports: [TypeOrmModule.forFeature([Alert]), ServicesPrimitivesModule],
  controllers: [AlertController],
  providers: [AlertService, AlertNotifierService],
  exports: [AlertService, AlertNotifierService],
})
export class AlertModule {}
