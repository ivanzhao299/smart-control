import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { StatusGateway } from './status.gateway';
import { ClientAuthModule } from '../client-auth/client-auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [ServicesModule, ClientAuthModule, AdminAuthModule],
  providers: [StatusGateway],
  exports: [StatusGateway],
})
export class WebsocketModule {}
