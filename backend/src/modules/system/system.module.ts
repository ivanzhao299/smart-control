import { Module } from '@nestjs/common';
import { ServicesModule } from '../../services/services.module';
import { AdaptersModule } from '../../adapters/adapters.module';
import { SystemController } from './system.controller';
import { SystemService } from './system.service';

@Module({
  imports: [ServicesModule, AdaptersModule],
  controllers: [SystemController],
  providers: [SystemService],
  exports: [SystemService],
})
export class SystemModule {}
