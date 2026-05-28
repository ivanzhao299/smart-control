import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import {
  HARDWARE_CATEGORIES,
  HardwareCategory,
  HardwareStatus,
} from '../../../entities/hardware-unit.entity';

export class CreateHardwareDto {
  @IsString() @Length(1, 64) code!: string;
  @IsString() @Length(1, 128) name!: string;
  @IsString() category!: HardwareCategory;
  @IsString() @Length(1, 64) vendor!: string;
  @IsString() @Length(1, 64) model!: string;
  @IsOptional() @IsString() @Length(1, 64) driverKind?: string;
  @IsOptional() @IsString() serialNo?: string;
  @IsOptional() @IsString() firmwareVersion?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @IsString() ip?: string;
  @IsOptional() @IsString() macAddress?: string;
  @IsOptional() @IsString() addressing?: string;
  @IsOptional() @IsString() channels?: string;
  @IsOptional() @IsString() status?: HardwareStatus;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsString() installedAt?: string;
}

export class UpdateHardwareDto {
  @IsOptional() @IsString() @Length(1, 64) code?: string;
  @IsOptional() @IsString() @Length(1, 128) name?: string;
  @IsOptional() @IsString() category?: HardwareCategory;
  @IsOptional() @IsString() @Length(1, 64) vendor?: string;
  @IsOptional() @IsString() @Length(1, 64) model?: string;
  @IsOptional() @IsString() @Length(1, 64) driverKind?: string;
  @IsOptional() @IsString() serialNo?: string;
  @IsOptional() @IsString() firmwareVersion?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @IsString() ip?: string;
  @IsOptional() @IsString() macAddress?: string;
  @IsOptional() @IsString() addressing?: string;
  @IsOptional() @IsString() channels?: string;
  @IsOptional() @IsString() status?: HardwareStatus;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsString() installedAt?: string;
}

export class QueryHardwareDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @IsOptional() @IsString() category?: HardwareCategory;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @IsString() status?: HardwareStatus;
  @IsOptional() @IsString() keyword?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  enabled?: boolean;
}

export const HARDWARE_CATEGORY_LIST = HARDWARE_CATEGORIES;
