import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

/** No scheme-relative, credential-bearing, active-content or control-character URLs. */
export function safeBrandUrl(value: string, mediaPath = false): boolean {
  if (!value || /[\s\\\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const relative = mediaPath && /^\/(?:api\/)?media\//.test(value);
    if (!relative && !/^https?:\/\//i.test(value)) return false;
    const url = new URL(value, relative ? 'https://brand.invalid' : undefined);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !!url.hostname &&
      !url.username &&
      !url.password &&
      (!relative ||
        (url.origin === 'https://brand.invalid' && /^\/(?:api\/)?media\//.test(url.pathname)))
    );
  } catch {
    return false;
  }
}
@ValidatorConstraint({ name: 'brandUrl', async: false })
class BrandUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return (
      typeof value === 'string' &&
      (value === '' || safeBrandUrl(value, args.constraints[0] === true))
    );
  }
}
export class CreateBrandConfigDto {
  @IsString() @Matches(/\S/) @MaxLength(128) name!: string;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(128) displayName?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(512)
  @Validate(BrandUrlConstraint, [true])
  logoUrl?: string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(64) country?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null)
  @IsString()
  @MaxLength(256)
  @Validate(BrandUrlConstraint, [false])
  website?: string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(256) salesContact?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(256) techContact?:
    string | null;
  @ValidateIf((_, v) => v !== undefined && v !== null) @IsString() @MaxLength(4000) remark?:
    string | null;
  @ValidateIf((_, v) => v !== undefined) @IsBoolean() enabled?: boolean;
}
export class UpdateBrandConfigDto extends PartialType(CreateBrandConfigDto, {
  skipNullProperties: false,
}) {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedRevision!: number;
}
/** Rolling-upgrade bridge only. Modern editors always send a revision. */
export class LegacyUpdateBrandConfigDto extends PartialType(CreateBrandConfigDto, {
  skipNullProperties: false,
}) {
  @ValidateIf((_, v) => v !== undefined)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedRevision?: number;
}
export class BrandRevisionQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) expectedRevision!: number;
}
export class LegacyBrandRevisionQueryDto extends PartialType(BrandRevisionQueryDto, {
  skipNullProperties: false,
}) {}
