import { Type } from 'class-transformer';
import { IsInt, IsNumber, Max, Min } from 'class-validator';

export class ZoneBrightnessDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  value!: number;
}

export class ZoneIdParam {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(64)
  id!: number;
}
