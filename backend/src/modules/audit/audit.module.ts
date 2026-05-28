import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { AdaptersModule } from '../../adapters/adapters.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([AuditLog, HardwareUnit]),
    // 回滚 hardware 时也要清 adapter 的 DB cache
    AdaptersModule,
  ],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
