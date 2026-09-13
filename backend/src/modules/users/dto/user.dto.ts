import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { USER_ROLES, UserRole } from '../../../entities/user.entity';

const ROLE_MAP = Object.fromEntries(USER_ROLES.map((v) => [v, v]));

export class CreateUserDto {
  @IsString()
  @Length(2, 64)
  username!: string;

  @IsString()
  @Length(6, 128)
  password!: string;

  @IsEnum(ROLE_MAP)
  role!: UserRole;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}

export class QueryUserDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsEnum(ROLE_MAP)
  role?: UserRole;

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
