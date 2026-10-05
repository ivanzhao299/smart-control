import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientAuth } from '../../entities/client-auth.entity';
import { ClientAuthService } from './client-auth.service';
import { ClientAuthController } from './client-auth.controller';
import { ClientAuthGuard } from './client-auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { User } from '../../entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ClientAuth, User])],
  controllers: [ClientAuthController],
  providers: [ClientAuthService, ClientAuthGuard, RateLimitGuard],
  exports: [ClientAuthService, ClientAuthGuard],
})
export class ClientAuthModule {}
