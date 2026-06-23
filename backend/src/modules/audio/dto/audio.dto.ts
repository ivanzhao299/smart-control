import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AudioVolumeDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  value!: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  zone?: string;
}

export class AudioMuteDto {
  @IsOptional()
  @IsBoolean()
  muted?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  zone?: string;
}

export class AudioBgmDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  track?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  zone?: string;
}

export class AudioMicDto {
  @IsOptional()
  @IsBoolean()
  enable?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  zone?: string;
}

/** 矩阵单点路由: 输出 out ← 输入 input, on=接通/off=断开 (EKX-808 8x8, 通道 0-7) */
export class AudioMatrixDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(7)
  out!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(7)
  input!: number;

  @IsBoolean()
  on!: boolean;
}
