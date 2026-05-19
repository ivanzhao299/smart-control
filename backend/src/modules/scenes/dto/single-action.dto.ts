import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class CreateSingleActionDto {
  @IsString()
  @Length(1, 32)
  deviceType!: string;

  @IsString()
  @Length(1, 128)
  deviceId!: string;

  @IsString()
  @Length(1, 64)
  command!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  delayMs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateSingleActionDto extends PartialType(CreateSingleActionDto) {}
