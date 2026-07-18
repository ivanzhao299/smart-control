import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, Min, MaxLength, ValidateIf } from 'class-validator';

export class AssignGroupsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @IsInt({ each: true })
  groupIds!: number[];

  /**
   * 目标分区 code; null / 省略 = 从分区移出, 变回"未分配".
   * ValidateIf 放行显式 null (IsOptional 只放行 undefined).
   */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @IsOptional()
  zoneCode?: string | null;
}

export class GroupShortsDto {
  /** DALI 短地址合法范围 0..63 */
  @IsArray()
  @ArrayMaxSize(64)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(63, { each: true })
  shorts!: number[];
}

/** 拖拽排序: 传全量有序 id 列表, 后端按下标重写 sortOrder */
export class ReorderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsInt({ each: true })
  ids!: number[];
}

/**
 * 新建一个物理 DALI 组 —— 之前只能编排"数据库里已经有的组", 现场新接一条 DALI 总线 /
 * 新分了一个组号, 没有入口能让系统认识它, 只能改代码重部署。业主原话:
 * "灯光编组没有新建编组, 要加上"。
 */
export class CreateGroupDto {
  /** 对应 hardware_unit.code, e.g. 'GW-DALI-1' */
  @IsString()
  @MaxLength(64)
  gatewayCode!: string;

  /** 该网关上的 DALI 组号, 1-16 */
  @IsInt()
  @Min(1)
  @Max(16)
  daliGroup!: number;

  /** 建好直接归入某分区; 不传 = 先放进"未分配"池, 现场再手动编组 */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @IsOptional()
  zoneCode?: string | null;
}
