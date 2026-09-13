import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppRelease } from '../../entities/app-release.entity';
import { AppReleaseController } from './app-release.controller';
import { AppReleaseService } from './app-release.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([AppRelease]), AdminAuthModule],
  controllers: [AppReleaseController],
  providers: [AppReleaseService],
  exports: [AppReleaseService],
})
export class AppReleaseModule {}
