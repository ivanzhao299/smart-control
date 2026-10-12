import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 变更类操作携带的接管者标识；缺失或不是当前接管者时，后端不执行翻页 / 轮播。 */
export class ParkOpsOwnerIdDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ownerId?: string;
}

export class GotoParkOpsPageDto extends ParkOpsOwnerIdDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5) // 0-based；对应大屏 6 页，最后一页 idx=5（能源管理）。增删页时与 TOTAL_PAGES 同步。
  page!: number;
}

export class ToggleParkOpsAutoDto extends ParkOpsOwnerIdDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 接管大屏：ownerId 必填；ownerName 用于现场 / 其他终端识别是谁在控制。 */
export class ClaimParkOpsControlDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  ownerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  ownerName?: string;
}

/** next / prev / release 等无业务参数动作可选携带 ownerId。 */
export class ParkOpsActionDto extends ParkOpsOwnerIdDto {}

/** 运营大屏（人车管理页）受控远程开闸：复用接管锁，写操作必须可追溯。 */
export class GateOpenParkOpsDto extends ParkOpsOwnerIdDto {
  @IsOptional()
  @IsString()
  @MaxLength(24)
  ownerName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  deviceId?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  serialno?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reason?: string;
}
