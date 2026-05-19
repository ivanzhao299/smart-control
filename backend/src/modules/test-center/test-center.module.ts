import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device } from '../../entities/device.entity';
import { Scene } from '../../entities/scene.entity';
import { TestLog } from '../../entities/test-log.entity';
import { ServicesModule } from '../../services/services.module';
import { TestCenterController } from './test-center.controller';
import { TestCenterService } from './test-center.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TestLog, Device, Scene]),
    ServicesModule,
  ],
  controllers: [TestCenterController],
  providers: [TestCenterService],
  exports: [TestCenterService],
})
export class TestCenterModule {}
