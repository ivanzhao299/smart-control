import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreatePowerConfigDto {
  @IsString() @Matches(/\S/) @MaxLength(64) code!: string;
  @IsString() @Matches(/\S/) @MaxLength(128) name!: string;
  @IsString() @Matches(/\S/) @MaxLength(16) floor!: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(32)
  category?: string;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(64)
  gatewayCode?: string | null;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(32)
  relayChannel?: number | null;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt()
  @Min(1)
  @Max(247)
  meterAddress?: number | null;
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(600)
  ratedVoltage?: number;
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(200)
  ratedCurrent?: number;
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(100000)
  ratedPower?: number;
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(32)
  icon?: string | null;
  @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsString()
  @MaxLength(4000)
  description?: string | null;
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  enabled?: boolean;
}

export class UpdatePowerConfigDto extends PartialType(CreatePowerConfigDto, {
  skipNullProperties: false,
}) {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedRevision!: number;
}

/** Explicit rolling-upgrade bridge, never used by the new editor. */
export class LegacyUpdatePowerConfigDto extends PartialType(CreatePowerConfigDto, {
  skipNullProperties: false,
}) {
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision?: number;
}

export class RenamePowerConfigDto {
  @IsString() @Matches(/\S/) @MaxLength(32) name!: string;
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision?: number;
}

export class PowerConfigRevisionQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
}
export class LegacyPowerConfigRevisionQueryDto extends PartialType(PowerConfigRevisionQueryDto, {
  skipNullProperties: false,
}) {}
