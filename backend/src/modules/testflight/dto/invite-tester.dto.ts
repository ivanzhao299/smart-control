import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

/**
 * 邀请内部 TestFlight 测试员入参。
 * 姓名允许中文/拉丁字母及常见间隔/连字符; 邮箱即受邀人的 Apple ID。
 */
export class InviteTesterDto {
  @IsEmail({}, { message: '邮箱格式不正确 (该邮箱需为受邀人的 Apple ID)' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty({ message: '名必填' })
  @MaxLength(80)
  @Matches(/^[\p{L}\p{M}·.\-'\s]+$/u, { message: '名只能包含中英文、空格与常见标点' })
  firstName!: string;

  @IsString()
  @IsNotEmpty({ message: '姓必填' })
  @MaxLength(80)
  @Matches(/^[\p{L}\p{M}·.\-'\s]+$/u, { message: '姓只能包含中英文、空格与常见标点' })
  lastName!: string;
}
