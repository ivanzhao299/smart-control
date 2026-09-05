import { IsOptional, IsString, MaxLength, IsIn, IsInt, Min } from 'class-validator';

export class UpdateMediaDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  originalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @IsOptional()
  @IsIn(['private', 'shared'])
  visibility?: 'private' | 'shared';

  @IsOptional()
  @IsInt()
  @Min(1)
  ownerUserId?: number;
}

export class MediaUploadMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class WebpageCreateDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(1000)
  url!: string;
}

export class ImportOrphanDto {
  /** scanOrphans() 返回的 relPath, 原样传回来指定收编哪一个 */
  @IsString()
  @MaxLength(500)
  relPath!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export interface OrphanMediaItem {
  /** 相对 mediaRoot 的路径, import 时原样传回 */
  relPath: string;
  name: string;
  sizeBytes: number;
  /** 扩展名猜不出类型时为 null —— 前端标"不支持", 不给点导入 */
  kind: 'video' | 'image' | 'audio' | 'doc' | null;
}

export interface MediaListItem {
  ownerUserId: number | null;
  visibility: 'private' | 'shared';
  id: number;
  originalName: string;
  kind: 'video' | 'image' | 'audio' | 'webpage' | 'doc';
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  resolution: string | null;
  remark: string | null;
  uploader: string;
  thumbUrl: string | null;
  fileUrl: string;
  lastPlayedAt: string | null;
  createdAt: string;
  processingStatus: 'ready' | 'pending' | 'processing' | 'failed';
  processingError: string | null;
}
