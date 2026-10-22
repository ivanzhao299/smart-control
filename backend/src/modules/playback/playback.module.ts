import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaybackChannel } from '../../entities/playback-channel.entity';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { PlaybackHistory } from '../../entities/playback-history.entity';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';
import { PersonalPlaylistService } from './personal-playlist.service';
import { PlayerDeviceAuthService } from './player-device-auth.service';
import { PlayerDeviceGuard } from './player-device.guard';
import { PlayerDeviceController } from './player-device.controller';
import { PlayerDeviceAccessService } from './player-device-access.service';
import { User } from '../../entities/user.entity';
import { MediaModule } from '../media/media.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { ServicesModule } from '../../services/services.module';
import { SystemBrandingModule } from '../system-branding/system-branding.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlaybackChannel, PlaylistItem, PlaybackHistory, User]),
    MediaModule,        // 复用 MediaService 查 media
    AdminAuthModule,    // 给 controller 用 AdminGuard
    ServicesModule,     // 拿 ControlBus 推 WS 事件
    SystemBrandingModule, // 默认欢迎页发布时复用可编辑欢迎方案
  ],
  controllers: [PlaybackController, PlayerDeviceController],
  providers: [PlaybackService, PersonalPlaylistService, PlayerDeviceAuthService, PlayerDeviceGuard, PlayerDeviceAccessService],
  exports: [PlaybackService],
})
export class PlaybackModule {}
