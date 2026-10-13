import { IsString, Length } from 'class-validator';

/**
 * 自助修改密码（任何已登录用户改自己的密码）。
 * - oldPassword 只要求非空, 对错交给 verifyPassword 判定（兼容历史口令长度）。
 * - newPassword 与建账户保持同一强度口径（长度 6–128）。
 */
export class ChangePasswordDto {
  @IsString()
  @Length(1, 128)
  oldPassword!: string;

  @IsString()
  @Length(6, 128, { message: '新密码长度需为 6–128 位' })
  newPassword!: string;
}
