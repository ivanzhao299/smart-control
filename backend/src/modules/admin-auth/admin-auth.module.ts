import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuth } from '../../entities/admin-auth.entity';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin-auth.guard';
import { BackendSessionGuard } from './backend-session.guard';
import { ClientAuthModule } from '../client-auth/client-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAuth]), ClientAuthModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminGuard, BackendSessionGuard],
  exports: [AdminAuthService, AdminGuard, BackendSessionGuard],
})
export class AdminAuthModule {}
