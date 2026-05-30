import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SystemBranding } from '../../entities/system-branding.entity';
import { SystemBrandingController } from './system-branding.controller';
import { SystemBrandingService } from './system-branding.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([SystemBranding]), AdminAuthModule],
  controllers: [SystemBrandingController],
  providers: [SystemBrandingService],
  exports: [SystemBrandingService],
})
export class SystemBrandingModule {}
