import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateNvrDto {
  @IsString() @Length(1, 128) name!: string;
  @IsString() @Length(1, 255) ip!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(65535) port!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(65535) rtspPort!: number;
  @IsString() @Length(1, 128) username!: string;
  @IsString() @Length(1, 256) password!: string;
  @IsString() @IsIn(['hikvision', 'dahua', 'other']) brand!: string;
  @IsBoolean() enabled!: boolean;
}

export class UpdateNvrDto {
  /** 旧版前端会回传只读字段；迁移期接收但服务层明确忽略。 */
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() createdAt?: string;
  @IsOptional() @IsBoolean() hasPassword?: boolean;
  @IsOptional() @IsString() @Length(1, 128) name?: string;
  @IsOptional() @IsString() @Length(1, 255) ip?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) rtspPort?: number;
  @IsOptional() @IsString() @Length(1, 128) username?: string;
  /** 空字符串表示保留已保存的密码。 */
  @IsOptional() @IsString() @MaxLength(256) password?: string;
  @IsOptional() @IsString() @IsIn(['hikvision', 'dahua', 'other']) brand?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class CreateCameraChannelDto {
  @IsString() @Length(1, 128) nvrId!: string;
  @IsString() @Length(1, 32) hikChannel!: string;
  @IsString() @Length(1, 128) name!: string;
  @IsString() @MaxLength(128) alias!: string;
  @IsBoolean() enabled!: boolean;
  @Type(() => Number) @IsInt() @Min(1) @Max(10_000) sortOrder!: number;
}

export class UpdateCameraChannelDto {
  /** 旧版前端会回传完整视图；只读/AI 字段由服务层忽略并走各自专用接口。 */
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() createdAt?: string;
  @IsOptional() @IsBoolean() aiEnabled?: boolean;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => NormPointDto) countLine?: NormPointDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(16) @ValidateNested({ each: true }) @Type(() => NormPointDto) roiPolygon?: NormPointDto[];
  @IsOptional() @IsString() @Length(1, 128) nvrId?: string;
  @IsOptional() @IsString() @Length(1, 32) hikChannel?: string;
  @IsOptional() @IsString() @Length(1, 128) name?: string;
  @IsOptional() @IsString() @MaxLength(128) alias?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10_000) sortOrder?: number;
}

export class UpdateDisplayLayoutDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(6) columns?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(64) @IsString({ each: true }) channelIds?: string[];
}

export class AiBoxDto {
  @IsBoolean() enabled!: boolean;
}

export class NormPointDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) x!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) y!: number;
}

export class ChannelAiConfigDto {
  @IsOptional() @IsBoolean() aiEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => NormPointDto)
  countLine?: NormPointDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(16)
  @ValidateNested({ each: true })
  @Type(() => NormPointDto)
  roiPolygon?: NormPointDto[];
}
