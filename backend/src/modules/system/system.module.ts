import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { AdaptersModule } from '../../adapters/adapters.module';
import { SystemController } from './system.controller';

@Module({
  imports: [ServicesModule, AdaptersModule],
  controllers: [SystemController],
})
export class SystemModule {}
