import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SceneExecution } from '../../entities/scene-execution.entity';
import { SceneExecutionsController } from './scene-executions.controller';
import { SceneExecutionsService } from './scene-executions.service';

@Module({
  imports: [TypeOrmModule.forFeature([SceneExecution])],
  controllers: [SceneExecutionsController],
  providers: [SceneExecutionsService],
  exports: [SceneExecutionsService],
})
export class SceneExecutionsModule {}
