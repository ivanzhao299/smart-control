import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OperationLog } from '../../entities/operation-log.entity';
import { AlertModule } from '../alerts/alert.module';
import { LogsController } from './logs.controller';
import { OperationLogService } from './operation-log.service';

@Module({
  imports: [TypeOrmModule.forFeature([OperationLog]), AlertModule],
  controllers: [LogsController],
  providers: [OperationLogService],
  exports: [OperationLogService],
})
export class LogsModule {}
