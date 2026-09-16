import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuth } from '../../entities/admin-auth.entity';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin-auth.guard';
import { ClientAuthModule } from '../client-auth/client-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([AdminAuth]), ClientAuthModule],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminGuard],
  exports: [AdminAuthService, AdminGuard],
})
export class AdminAuthModule {}
