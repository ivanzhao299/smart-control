import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LprDevice } from '../../entities/lpr-device.entity';
import { LprPassRecord } from '../../entities/lpr-pass-record.entity';
import { LprWhitelist } from '../../entities/lpr-whitelist.entity';
import { LprGateEvent } from '../../entities/lpr-gate-event.entity';
import { ServicesPrimitivesModule } from '../../services/services-primitives.module';
import { AuditModule } from '../audit/audit.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { LprService } from './lpr.service';
import { LprWebhookController } from './lpr-webhook.controller';
import { LprController } from './lpr.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([LprDevice, LprPassRecord, LprWhitelist, LprGateEvent]),
    ServicesPrimitivesModule,
    AuditModule,
    AdminAuthModule,
  ],
  controllers: [LprWebhookController, LprController],
  providers: [LprService],
  exports: [LprService],
})
export class LprModule {}
