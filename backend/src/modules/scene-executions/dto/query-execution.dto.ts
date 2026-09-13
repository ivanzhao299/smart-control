import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { EXECUTION_STATUSES, TRIGGER_TYPES } from '../../../entities/scene-execution.entity';

const STATUS_MAP = Object.fromEntries(EXECUTION_STATUSES.map((v) => [v, v]));
const TRIGGER_MAP = Object.fromEntries(TRIGGER_TYPES.map((v) => [v, v]));

export class QueryExecutionDto {
  @IsOptional()
  @IsString()
  sceneCode?: string;

  @IsOptional()
  @IsIn(Object.keys(STATUS_MAP))
  status?: keyof typeof STATUS_MAP;

  @IsOptional()
  @IsIn(Object.keys(TRIGGER_MAP))
  triggerType?: keyof typeof TRIGGER_MAP;

  @IsOptional()
  @IsDateString()
  startTime?: string;

  @IsOptional()
  @IsDateString()
  endTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 50;
}
