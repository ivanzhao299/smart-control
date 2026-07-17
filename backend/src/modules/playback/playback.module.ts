import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlaybackChannel } from '../../entities/playback-channel.entity';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { PlaybackHistory } from '../../entities/playback-history.entity';
import { PlaybackController } from './playback.controller';
import { PlaybackService } from './playback.service';
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
  controllers: [PlaybackController],
  providers: [PlaybackService],
  exports: [PlaybackService],
})
export class PlaybackModule {}
