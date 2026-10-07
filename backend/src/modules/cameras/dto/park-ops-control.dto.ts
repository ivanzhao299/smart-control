import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class GotoParkOpsPageDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6) // 0-based；对应大屏 7 页，最后一页 idx=6（能源管理）。增删页时与 TOTAL_PAGES 同步。
  page!: number;
}

export class ToggleParkOpsAutoDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
