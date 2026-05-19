import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import {
  UAT_CATEGORIES,
  UAT_STATUSES,
  UatCategory,
  UatStatus,
} from '../../../entities/uat-record.entity';

const STATUS_MAP = Object.fromEntries(UAT_STATUSES.map((v) => [v, v]));
const CATEGORY_MAP = Object.fromEntries(UAT_CATEGORIES.map((v) => [v, v]));

export class CreateUatDto {
  @IsString()
  @Length(1, 128)
  itemName!: string;

  @IsEnum(CATEGORY_MAP)
  category!: UatCategory;

  @IsOptional()
  @IsString()
  testStep?: string;

  @IsOptional()
  @IsString()
  expectedResult?: string;

  @IsOptional()
  @IsString()
  actualResult?: string;

  @IsOptional()
  @IsEnum(STATUS_MAP)
  status?: UatStatus;

  @IsOptional()
  @IsString()
  @Length(0, 64)
  tester?: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateUatDto extends PartialType(CreateUatDto) {}

export class TransitionUatDto {
  @IsOptional()
  @IsString()
  @Length(0, 64)
  tester?: string;

  @IsOptional()
  @IsString()
  actualResult?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class QueryUatDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(CATEGORY_MAP)
  category?: UatCategory;

  @IsOptional()
  @IsEnum(STATUS_MAP)
  status?: UatStatus;

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
  pageSize?: number = 500;
}
