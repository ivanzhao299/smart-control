import { Module } from '@nestjs/common';
import { ProjectorController } from './projector.controller';
import { ProjectorService } from './projector.service';
import { AdaptersModule } from '../../adapters/adapters.module';

/** 投影视频融合器控制模块 (JBT-SK-HD02, 播控 TCP 协议). */
@Module({
  imports: [AdaptersModule],
  controllers: [ProjectorController],
  providers: [ProjectorService],
  exports: [ProjectorService],
})
export class ProjectorModule {}
