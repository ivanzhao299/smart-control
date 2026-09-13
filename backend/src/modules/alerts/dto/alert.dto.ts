import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ALERT_LEVELS, ALERT_STATUSES } from '../../../entities/alert.entity';

const LEVEL_MAP = Object.fromEntries(ALERT_LEVELS.map((v) => [v, v]));
const STATUS_MAP = Object.fromEntries(ALERT_STATUSES.map((v) => [v, v]));

export class QueryAlertDto {
  @IsOptional()
  @IsIn(Object.keys(LEVEL_MAP))
  level?: keyof typeof LEVEL_MAP;

  @IsOptional()
  @IsIn(Object.keys(STATUS_MAP))
  status?: keyof typeof STATUS_MAP;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  type?: string;

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

export class ResolveAlertDto {
  @IsOptional()
  @IsString()
  @Length(0, 64)
  resolvedBy?: string;
}
