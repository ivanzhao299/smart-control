import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

/** Runtime-validated metadata for a light zone. This DTO never reaches a lighting adapter. */
export class CreateLightZoneDto {
  @IsString()
  @Length(1, 64)
  code!: string;

  @IsString()
  @Length(1, 128)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  floor?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  icon?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateLightZoneDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  code?: string;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  floor?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  sortOrder?: number;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  icon?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class LightZoneRevisionQueryDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision!: number;
}
