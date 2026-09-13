import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min, Matches } from 'class-validator';

// 5 段 (sec optional 6 段) cron 表达式: 'm h dom mon dow' 或 's m h dom mon dow'
const CRON_REGEX = /^([*\/0-9,\-?LW#A-Z]+\s+){4,5}[*\/0-9,\-?LW#A-Z]+$/i;

export class CreateSchedulerTaskDto {
  @IsString()
  @Length(1, 128)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @Length(1, 64)
  @Matches(CRON_REGEX, { message: 'cron 表达式格式不合法' })
  cron!: string;

  @IsString()
  @Length(1, 64)
  sceneCode!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateSchedulerTaskDto extends PartialType(CreateSchedulerTaskDto) {}

export class QuerySchedulerTaskDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;

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

