import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class GotoParkOpsPageDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  page!: number;
}

export class ToggleParkOpsAutoDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
