import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Scene } from '../../entities/scene.entity';
import { SceneAction } from '../../entities/scene-action.entity';
import { ScenesController } from './scenes.controller';
import { ScenesService } from './scenes.service';
import { SceneActionsController } from './scene-actions.controller';
import { SceneActionsService } from './scene-actions.service';
import { LogsModule } from '../logs/logs.module';
import { ServicesModule } from '../../services/services.module';

@Module({
  imports: [TypeOrmModule.forFeature([Scene, SceneAction]), LogsModule, ServicesModule],
  controllers: [ScenesController, SceneActionsController],
  providers: [ScenesService, SceneActionsService],
  exports: [ScenesService, SceneActionsService],
})
export class ScenesModule {}
