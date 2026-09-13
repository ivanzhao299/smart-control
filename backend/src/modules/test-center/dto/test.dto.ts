import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const IP_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST_REGEX = /^[A-Za-z0-9_.\-]+$/;

export class DeviceTestDto {
  @IsString()
  @Length(1, 64)
  command!: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class SubsystemTestDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  command?: string;

  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class SceneTestDto {
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class PingTestDto {
  @IsString()
  @Matches(IP_REGEX, { message: 'IP 格式不合法 (例 192.168.50.20)' })
  ip!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(500)
  @Max(10000)
  timeoutMs?: number;
}

export class PortTestDto {
  @IsString()
  @Matches(HOST_REGEX, { message: 'host 格式不合法' })
  ip!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(500)
  @Max(10000)
  timeoutMs?: number;
}

export class QueryTestLogDto {
  @IsOptional()
  @IsIn(['device', 'subsystem', 'scene', 'network_ping', 'network_port'])
  testType?: string;

  @IsOptional()
  @IsString()
  targetType?: string;

  @IsOptional()
  @IsString()
  targetId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  success?: boolean;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 50;
}

export class TestReportDto {
  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  testType?: string;
}
