import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DaliLight } from '../../entities/dali-light.entity';
import { LightScene } from '../../entities/light-scene.entity';
import { LightSceneItem } from '../../entities/light-scene-item.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { AdaptersModule } from '../../adapters/adapters.module';
import { DaliLightsController } from './dali-lights.controller';
import { DaliLightsService } from './dali-lights.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DaliLight, LightScene, LightSceneItem, HardwareUnit]),
    AdaptersModule,
  ],
  controllers: [DaliLightsController],
  providers: [DaliLightsService],
  exports: [DaliLightsService],
})
export class DaliLightsModule {}
