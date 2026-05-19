import { Type } from 'class-transformer';
import { IsIn, IsNumber, Max, Min } from 'class-validator';

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
