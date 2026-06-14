import { IsOptional, IsString, MaxLength } from 'class-validator';

export class MediaUploadMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export interface MediaListItem {
  id: number;
  originalName: string;
  kind: 'video' | 'image' | 'audio';
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
