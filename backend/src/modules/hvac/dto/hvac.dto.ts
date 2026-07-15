import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsString, Length, Max, Min } from 'class-validator';

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
