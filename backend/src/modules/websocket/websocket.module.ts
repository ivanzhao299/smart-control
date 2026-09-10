import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { StatusGateway } from './status.gateway';
import { ClientAuthModule } from '../client-auth/client-auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { PlayerDeviceAuthService } from '../playback/player-device-auth.service';

@Module({
  imports: [ServicesModule, ClientAuthModule, AdminAuthModule],
  providers: [StatusGateway, PlayerDeviceAuthService],
  exports: [StatusGateway],
})
export class WebsocketModule {}
