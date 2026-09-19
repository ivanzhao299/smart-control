import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsJSON,
  IsOptional,
  IsString,
  Length,
  MaxLength,
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
  @IsIn(HARDWARE_CATEGORIES) category!: HardwareCategory;
  @IsString() @Length(1, 64) vendor!: string;
  @IsString() @Length(1, 64) model!: string;
  @IsOptional() @IsString() @Length(1, 64) driverKind?: string;
  @IsOptional() @IsString() @MaxLength(128) serialNo?: string;
  @IsOptional() @IsString() @MaxLength(64) firmwareVersion?: string;
  @IsOptional() @IsString() @MaxLength(128) location?: string;
  @IsOptional() @IsString() @MaxLength(16) floor?: string;
  @IsOptional() @IsString() @MaxLength(64) ip?: string;
  @IsOptional() @IsString() @MaxLength(32) macAddress?: string;
  @IsOptional() @IsJSON() @MaxLength(16384) addressing?: string;
  @IsOptional() @IsJSON() @MaxLength(16384) channels?: string;
  @IsOptional() @IsIn(['normal', 'fault', 'offline', 'maintenance', 'retired']) status?: HardwareStatus;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(8192) remark?: string;
  @IsOptional() @IsString() @MaxLength(32) installedAt?: string;
}

export class UpdateHardwareDto {
  @Type(() => Number)
  @IsInt() @Min(1) expectedRevision!: number;
  @IsOptional() @IsString() @Length(1, 64) code?: string;
  @IsOptional() @IsString() @Length(1, 128) name?: string;
  @IsOptional() @IsIn(HARDWARE_CATEGORIES) category?: HardwareCategory;
  @IsOptional() @IsString() @Length(1, 64) vendor?: string;
  @IsOptional() @IsString() @Length(1, 64) model?: string;
  @IsOptional() @IsString() @Length(1, 64) driverKind?: string;
  @IsOptional() @IsString() @MaxLength(128) serialNo?: string;
  @IsOptional() @IsString() @MaxLength(64) firmwareVersion?: string;
  @IsOptional() @IsString() @MaxLength(128) location?: string;
  @IsOptional() @IsString() @MaxLength(16) floor?: string;
  @IsOptional() @IsString() @MaxLength(64) ip?: string;
  @IsOptional() @IsString() @MaxLength(32) macAddress?: string;
  @IsOptional() @IsJSON() @MaxLength(16384) addressing?: string;
  @IsOptional() @IsJSON() @MaxLength(16384) channels?: string;
  @IsOptional() @IsIn(['normal', 'fault', 'offline', 'maintenance', 'retired']) status?: HardwareStatus;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() @MaxLength(8192) remark?: string;
  @IsOptional() @IsString() @MaxLength(32) installedAt?: string;
}

export class DeleteHardwareDto {
  @IsInt() @Min(1) expectedRevision!: number;
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

  @IsOptional() @IsIn(HARDWARE_CATEGORIES) category?: HardwareCategory;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @IsIn(['normal', 'fault', 'offline', 'maintenance', 'retired']) status?: HardwareStatus;
  @IsOptional() @IsString() keyword?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  enabled?: boolean;
}

export class ChangeBreakerAddressDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(255)
  slaveId!: number;
}

export const HARDWARE_CATEGORY_LIST = HARDWARE_CATEGORIES;
