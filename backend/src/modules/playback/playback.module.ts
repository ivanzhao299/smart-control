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
import { MediaModule } from '../media/media.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { ServicesModule } from '../../services/services.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([PlaybackChannel, PlaylistItem, PlaybackHistory]),
    MediaModule,        // 复用 MediaService 查 media
    AdminAuthModule,    // 给 controller 用 AdminGuard
    ServicesModule,     // 拿 ControlBus 推 WS 事件
  ],
  controllers: [PlaybackController, PlayerDeviceController],
  providers: [PlaybackService, PersonalPlaylistService, PlayerDeviceAuthService, PlayerDeviceGuard],
  exports: [PlaybackService],
})
export class PlaybackModule {}
