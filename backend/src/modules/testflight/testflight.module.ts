import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TestFlightInvitation } from '../../entities/testflight-invitation.entity';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AppleAppStoreClient } from './apple-app-store.client';
import { GitHubActionsClient } from './github-actions.client';
import { TestFlightService } from './testflight.service';
import { TestFlightController } from './testflight.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TestFlightInvitation]), AdminAuthModule],
  controllers: [TestFlightController],
  providers: [AppleAppStoreClient, GitHubActionsClient, TestFlightService],
  exports: [TestFlightService],
})
export class TestFlightModule {}
