import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DEVICE_CATEGORIES, DEVICE_STATUSES, DeviceCategory, DeviceStatus } from '../../../entities/device.entity';

const CATEGORY_MAP = Object.fromEntries(DEVICE_CATEGORIES.map((v) => [v, v]));
const STATUS_MAP = Object.fromEntries(DEVICE_STATUSES.map((v) => [v, v]));

export class QueryDeviceDto {
  @IsOptional()
  @IsEnum(CATEGORY_MAP)
  category?: DeviceCategory;

  @IsOptional()
  @IsEnum(STATUS_MAP)
  status?: DeviceStatus;

  @IsOptional()
  @IsString()
  floor?: string;

  @IsOptional()
  @IsString()
  zone?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  keyword?: string;

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
