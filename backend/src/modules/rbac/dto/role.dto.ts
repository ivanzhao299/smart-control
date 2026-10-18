import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  canFront?: boolean;

  @IsOptional()
  @IsBoolean()
  canBack?: boolean;

  /** 自定义角色默认停用；管理员显式开启。 */
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  canFront?: boolean;

  @IsOptional()
  @IsBoolean()
  canBack?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class GrantPermissionsDto {
  @IsArray()
  @IsString({ each: true })
  permissions!: string[];
}

/** 复制角色：新角色 code/名称（其余登录方向、权限默认取源角色）。 */
export class CopyRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  canFront?: boolean;

  @IsOptional()
  @IsBoolean()
  canBack?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}
