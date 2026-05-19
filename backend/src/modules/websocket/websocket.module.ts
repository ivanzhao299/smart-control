import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { StatusGateway } from './status.gateway';

@Module({
  imports: [ServicesModule],
  providers: [StatusGateway],
  exports: [StatusGateway],
})
export class WebsocketModule {}
