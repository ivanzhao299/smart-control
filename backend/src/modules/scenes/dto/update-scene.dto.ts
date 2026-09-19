import { PartialType } from '@nestjs/mapped-types';
import { IsInt, Min } from 'class-validator';
import { CreateSceneDto } from './create-scene.dto';

export class UpdateSceneDto extends PartialType(CreateSceneDto) {
  @IsInt() @Min(1) expectedRevision!: number;
}
