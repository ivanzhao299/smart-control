import {
  IsBoolean,
  IsEnum,
  IsIP,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { DEVICE_CATEGORIES, DEVICE_STATUSES, DeviceCategory, DeviceStatus } from '../../../entities/device.entity';

const CATEGORY_MAP = Object.fromEntries(DEVICE_CATEGORIES.map((v) => [v, v]));
const STATUS_MAP = Object.fromEntries(DEVICE_STATUSES.map((v) => [v, v]));

export class CreateDeviceDto {
  @IsString()
  @Length(1, 128)
  name!: string;

  @IsEnum(CATEGORY_MAP)
  category!: DeviceCategory;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  protocol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  adapter?: string;

  @IsOptional()
  @IsIP()
  ip?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  floor?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  zone?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(STATUS_MAP)
  status?: DeviceStatus;
}
