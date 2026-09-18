import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class RenameDaliLightDto {
  @IsString()
  @Length(0, 128)
  name!: string;
}

export class AssignDaliLightZoneDto {
  @IsOptional()
  @IsString()
  @Length(0, 64)
  zoneCode?: string | null;
}

export class AssignDaliLightBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(256)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids!: number[];

  @IsOptional()
  @IsString()
  @Length(0, 64)
  zoneCode?: string | null;
}

export class DaliSceneItemDto {
  @IsIn(['light', 'zone'])
  targetType!: 'light' | 'zone';

  @IsString()
  @Length(1, 96)
  targetRef!: string;

  @IsOptional()
  @IsBoolean()
  on?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  brightness?: number | null;

  @IsOptional()
  @IsInt()
  @Min(2500)
  @Max(6500)
  kelvin?: number | null;
}

export class CreateDaliSceneDto {
  @IsString()
  @Length(1, 128)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  floor?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  icon?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => DaliSceneItemDto)
  items?: DaliSceneItemDto[];
}

export class UpdateDaliSceneDto {
  @IsOptional()
  @IsString()
  @Length(1, 128)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  floor?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  icon?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(256)
  @ValidateNested({ each: true })
  @Type(() => DaliSceneItemDto)
  items?: DaliSceneItemDto[];
}
