import { Module } from '@nestjs/common';
import { PvController } from './pv.controller';
import { PvService } from './pv.service';

/**
 * 光伏 (锦浪云) 模块: 后端定时拉取 + 内存缓存 + 大屏只读接口。
 * 纯只读外部数据, 不建表、不做迁移。
 */
@Module({
  controllers: [PvController],
  providers: [PvService],
  exports: [PvService],
})
export class PvModule {}
