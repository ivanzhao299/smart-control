import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Undefined means keep the field. Null is allowed only for nullable fields. */
const supplied = (_object: unknown, value: unknown) => value !== undefined;
const nonNull = (_object: unknown, value: unknown) => value !== undefined && value !== null;

export class AudioRevisionDto {
  /** Rolling compatibility only; current editors always provide this on updates/deletes. */
  @ValidateIf(supplied)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision?: number;
}

export class AudioDeleteQueryDto extends AudioRevisionDto {
  @Type(() => Number)
  declare expectedRevision?: number;
}

class AudioCatalogPatchDto extends AudioRevisionDto {
  @ValidateIf(supplied)
  @IsString()
  @MaxLength(64)
  @Matches(/\S/u)
  name?: string;

  @ValidateIf(supplied)
  @IsInt()
  @Min(-1_000_000)
  @Max(1_000_000)
  sortOrder?: number;

  @ValidateIf(supplied)
  @IsBoolean()
  enabled?: boolean;
}

export class AudioInputUpsertDto extends AudioCatalogPatchDto {
  @ValidateIf(supplied)
  @IsInt()
  @Min(0)
  @Max(7)
  channel?: number;

  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(16)
  color?: string | null;
}

export class AudioZoneUpsertDto extends AudioInputUpsertDto {
  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(16)
  floor?: string | null;
}

export class AudioSceneOutputDto {
  @IsInt()
  @Min(0)
  @Max(7)
  ch!: number;

  @ValidateIf(supplied)
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(7, { each: true })
  inputs?: number[];

  @ValidateIf(supplied)
  @IsInt()
  @Min(0)
  @Max(100)
  volume?: number;

  @ValidateIf(supplied)
  @IsBoolean()
  muted?: boolean;
}

export class AudioSceneContentDto {
  @IsArray()
  @ArrayMaxSize(8)
  @ArrayUnique((output: AudioSceneOutputDto) => output?.ch)
  @ValidateNested({ each: true })
  @Type(() => AudioSceneOutputDto)
  outputs!: AudioSceneOutputDto[];
}

export class AudioSceneUpsertDto extends AudioCatalogPatchDto {
  @ValidateIf(supplied)
  @IsInt()
  @Min(1)
  @Max(12)
  presetNum?: number;

  @ValidateIf(nonNull)
  @IsString()
  @MaxLength(128)
  hint?: string | null;

  @ValidateIf(nonNull)
  @ValidateNested()
  @Type(() => AudioSceneContentDto)
  content?: AudioSceneContentDto | null;
}
