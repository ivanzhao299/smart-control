import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientAuth } from '../../entities/client-auth.entity';
import { ClientAuthService } from './client-auth.service';
import { ClientAuthController } from './client-auth.controller';
import { ClientAuthGuard } from './client-auth.guard';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([ClientAuth]), AdminAuthModule],
  controllers: [ClientAuthController],
  providers: [ClientAuthService, ClientAuthGuard],
  exports: [ClientAuthService, ClientAuthGuard],
})
export class ClientAuthModule {}
