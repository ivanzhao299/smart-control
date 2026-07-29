import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BaiduPanAuth } from '../../entities/baidu-pan-auth.entity';
import { MediaModule } from '../media/media.module';
import { BaiduPanController } from './baidu-pan.controller';
import { BaiduPanService } from './baidu-pan.service';

@Module({
  imports: [TypeOrmModule.forFeature([BaiduPanAuth]), MediaModule],
  controllers: [BaiduPanController],
  providers: [BaiduPanService],
})
export class BaiduPanModule {}
