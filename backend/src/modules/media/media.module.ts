import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';
import { LogsModule } from '../logs/logs.module';
import { ClientAuthModule } from '../client-auth/client-auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { MediaAccessService } from './media-access.service';
import { MediaQuotaService } from './media-quota.service';
import { QuotaUploadInterceptor } from './quota-upload.interceptor';

@Module({
  imports: [TypeOrmModule.forFeature([MediaAsset]), LogsModule, ClientAuthModule, AdminAuthModule],
  controllers: [MediaController],
  providers: [MediaService, MediaAccessService, MediaQuotaService, QuotaUploadInterceptor],
  exports: [MediaService],
})
export class MediaModule {}
