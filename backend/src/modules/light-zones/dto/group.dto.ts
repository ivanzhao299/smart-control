import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

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
