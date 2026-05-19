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
