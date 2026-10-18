import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @Length(2, 64)
  username!: string;

  @IsString()
  @Length(6, 128)
  password!: string;

  /**
   * 动态角色 code（RBAC 后不再锁死内置枚举）。
   * 仅做格式校验；是否存在、是否启用由 UsersService 调 PermissionService 校验。
   */
  @IsString()
  @Length(2, 32)
  role!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}

export class QueryUserDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  /** 按角色过滤：任意角色 code（含自定义角色），不在 DTO 层枚举限制。 */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  role?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  enabled?: boolean;

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
