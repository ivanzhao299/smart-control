import { IsOptional, IsString, MaxLength } from 'class-validator';

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

export interface MediaListItem {
  id: number;
  originalName: string;
  kind: 'video' | 'image' | 'audio' | 'webpage';
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
}
