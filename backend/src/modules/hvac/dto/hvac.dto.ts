import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

const MODES = ['cool', 'heat', 'fan', 'auto', 'dry'] as const;
const FANS = ['auto', 'low', 'mid', 'high'] as const;
type Mode = (typeof MODES)[number];
type FanSpeed = (typeof FANS)[number];

export class HvacTempDto {
  @Type(() => Number)
  @IsNumber()
  @Min(16)
  @Max(30)
  value!: number;
}

export class HvacModeDto {
  @IsIn([...MODES])
  mode!: Mode;
}

export class HvacFanDto {
  @IsIn([...FANS])
  speed!: FanSpeed;
}

/** 业主在 PWA 空调页改功能区名字 */
export class HvacZoneRenameDto {
  @IsString()
  @Length(1, 32, { message: '名称长度需在 1-32 字之间' })
  name!: string;
}

/** 新建功能区 — 业主在 PWA 直接建, code 由后端从时间戳生成 */
export class HvacZoneCreateDto {
  @IsString()
  @Length(1, 32, { message: '名称长度需在 1-32 字之间' })
  name!: string;

  @IsIn(['1F', '2F'])
  floor!: '1F' | '2F';
}

/** 改内机: 名字 / 归属组. 两个都可选, 只传哪个改哪个 */
export class HvacIndoorUpdateDto {
  @IsOptional()
  @IsString()
  @Length(1, 32, { message: '名称长度需在 1-32 字之间' })
  name?: string;

  /**
   * 归属功能区 code; 传 null 或空串 = 移出分组 (变成"未分组").
   * 用 IsOptional 而不是必填 —— 只改名字时不该被迫带上 zoneCode.
   */
  @IsOptional()
  @IsString()
  @Length(0, 64)
  zoneCode?: string | null;
}

/**
 * 批量控制的目标内机序号集合.
 *
 * 前端是"先选中若干台, 再用同一条控制条下发"的交互, 选中的可能是 1 台 (单机)、
 * 一个组、一整层、或全部 22 台 —— 都是同一个接口, 不需要为每种粒度各做一套。
 * 上限 64 = 单台网关最大内机数, 挡住误传超长数组.
 */
export class HvacBatchTargetDto {
  @IsArray()
  @ArrayMinSize(1, { message: '至少选中 1 台内机' })
  @ArrayMaxSize(64)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  indoors!: number[];
}

export class HvacBatchTempDto extends HvacBatchTargetDto {
  @Type(() => Number)
  @IsNumber()
  @Min(16)
  @Max(30)
  value!: number;
}

export class HvacBatchModeDto extends HvacBatchTargetDto {
  @IsIn([...MODES])
  mode!: Mode;
}

export class HvacBatchFanDto extends HvacBatchTargetDto {
  @IsIn([...FANS])
  speed!: FanSpeed;
}

/** 批量改归属: 把选中的几台一次性划进某个组 (前端"归到此组"按钮) */
export class HvacAssignDto extends HvacBatchTargetDto {
  @IsOptional()
  @IsString()
  @Length(0, 64)
  zoneCode?: string | null;
}
