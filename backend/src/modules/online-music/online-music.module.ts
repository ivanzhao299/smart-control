import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { OnlineMusicController } from './online-music.controller';
import { OnlineMusicService } from './online-music.service';

@Module({
  imports: [MediaModule],
  controllers: [OnlineMusicController],
  providers: [OnlineMusicService],
})
export class OnlineMusicModule {}
