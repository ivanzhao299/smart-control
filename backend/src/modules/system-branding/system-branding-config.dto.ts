import { BadRequestException } from '@nestjs/common';
import { IntersectionType, PartialType } from '@nestjs/mapped-types';
import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  validateSync,
} from 'class-validator';

/** Only bounded raster data is served inline. Never serve SVG/HTML from our origin. */
export function inlineLogo(value: string): { mime: string; bytes: Buffer } | null {
  if (value.length > 700_000) return null;
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 512 * 1024 || bytes.toString('base64') !== match[2])
    return null;
  const signature =
    match[1] === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : match[1] === 'image/jpeg'
        ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        : match[1] === 'image/gif'
          ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))
          : bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
            bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return signature ? { mime: match[1], bytes } : null;
}

export function safeLogoUrl(value: string): boolean {
  if (value.startsWith('data:')) return !!inlineLogo(value);
  if (
    value.length > 2048 ||
    /[\s\\\u0000-\u001f\u007f]/.test(value) ||
    !/^https?:\/\//i.test(value)
  )
    return false;
  try {
    const url = new URL(value);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
@ValidatorConstraint({ name: 'safeSystemLogo', async: false })
class LogoConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && (value === '' || safeLogoUrl(value));
  }
}

export class WelcomeFieldsDto {
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(64) welcomeGuest?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(32) welcomeTitle?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(64) welcomeTagline?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  welcomeBgMediaId?: number | null;
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  welcomePhotoMediaId?: number | null;
}
export class BrandingFieldsDto extends WelcomeFieldsDto {
  @ValidateIf((_, v) => v !== undefined)
  @IsString()
  @Matches(/\S/)
  @MaxLength(80)
  systemName?: string;
  @ValidateIf((_, v) => v !== undefined) @IsString() @Matches(/\S/) @MaxLength(4) logoText?: string;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(60) systemSubtitle?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(80) browserTitle?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(120) copyright?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(700_000)
  @Validate(LogoConstraint)
  logoUrl?: string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  welcomeMediaId?: number | null;
}
class RevisionDto {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedRevision!: number;
}
class OptionalRevisionDto extends PartialType(RevisionDto, { skipNullProperties: false }) {}
export class UpdateSystemBrandingDto extends IntersectionType(BrandingFieldsDto, RevisionDto) {}
export class UpdateWelcomeDto extends IntersectionType(WelcomeFieldsDto, RevisionDto) {}
export class LegacySystemBrandingDto extends IntersectionType(
  BrandingFieldsDto,
  OptionalRevisionDto,
) {}
export class LegacyWelcomeDto extends IntersectionType(WelcomeFieldsDto, OptionalRevisionDto) {}

/** Also validate internal callers; runtime DTO metadata alone protects only HTTP callers. */
export function brandingPatch(
  input: unknown,
  welcomeOnly: boolean,
  strict: boolean,
): LegacySystemBrandingDto {
  const type = welcomeOnly
    ? strict
      ? UpdateWelcomeDto
      : LegacyWelcomeDto
    : strict
      ? UpdateSystemBrandingDto
      : LegacySystemBrandingDto;
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException({ code: 'SYSTEM_BRANDING_INVALID', message: '配置必须为对象' });
  const dto = plainToInstance(type, input);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw new BadRequestException({
      code: 'SYSTEM_BRANDING_INVALID',
      message: '配置字段、图片或修订号无效',
    });
  return dto;
}
