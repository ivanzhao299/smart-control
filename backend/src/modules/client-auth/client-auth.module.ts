import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientAuth } from '../../entities/client-auth.entity';
import { ClientAuthService } from './client-auth.service';
import { ClientAuthController } from './client-auth.controller';
import { ClientAuthGuard } from './client-auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { User } from '../../entities/user.entity';
import { RbacModule } from '../rbac/rbac.module';

@Module({
  imports: [TypeOrmModule.forFeature([ClientAuth, User]), RbacModule],
  controllers: [ClientAuthController],
  providers: [ClientAuthService, ClientAuthGuard, RateLimitGuard],
  exports: [ClientAuthService, ClientAuthGuard],
})
export class ClientAuthModule {}
