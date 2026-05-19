import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SchedulerTask } from '../../entities/scheduler-task.entity';
import { ServicesModule } from '../../services/services.module';
import { LogsModule } from '../logs/logs.module';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SchedulerTask]),
    ServicesModule,
    LogsModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
