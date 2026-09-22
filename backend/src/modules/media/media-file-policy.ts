import { extname } from 'path';
import type { MediaKind } from '../../entities/media-asset.entity';

const VIDEO_MIME_PREFIXES = ['video/'];
const IMAGE_MIME_PREFIXES = ['image/'];
const AUDIO_MIME_PREFIXES = ['audio/'];
const DOCUMENT_EXTENSIONS = new Set(['.ppt', '.pptx', '.doc', '.docx', '.pdf']);
const DOCUMENT_MIME_TYPES = new Set([
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
]);
const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.wav',
  '.aac',
  '.m4a',
  '.ogg',
  '.flac',
  '.wma',
  '.opus',
  '.aiff',
  '.aif',
  '.ape',
  '.mp2',
  '.mka',
  '.wv',
  '.mid',
  '.midi',
  '.spx',
  '.dsf',
  '.dff',
  '.au',
  '.ra',
]);

export interface MediaFileType {
  kind: Exclude<MediaKind, 'webpage'>;
  mimeType: string;
}

/**
 * File-system imports have no browser MIME metadata. Keep their extension policy
 * in the same module used by upload fallback so scan, import and playback agree.
 */
const FILE_TYPES_BY_EXTENSION: Readonly<Record<string, MediaFileType>> = {
  '.mp4': { kind: 'video', mimeType: 'video/mp4' },
  '.mov': { kind: 'video', mimeType: 'video/quicktime' },
  '.mkv': { kind: 'video', mimeType: 'video/x-matroska' },
  '.avi': { kind: 'video', mimeType: 'video/x-msvideo' },
  '.webm': { kind: 'video', mimeType: 'video/webm' },
  '.flv': { kind: 'video', mimeType: 'video/x-flv' },
  '.wmv': { kind: 'video', mimeType: 'video/x-ms-wmv' },
  '.m4v': { kind: 'video', mimeType: 'video/mp4' },
  '.mpg': { kind: 'video', mimeType: 'video/mpeg' },
  '.mpeg': { kind: 'video', mimeType: 'video/mpeg' },
  '.3gp': { kind: 'video', mimeType: 'video/3gpp' },
  '.ts': { kind: 'video', mimeType: 'video/mp2t' },
  '.vob': { kind: 'video', mimeType: 'video/mpeg' },
  '.rmvb': { kind: 'video', mimeType: 'application/vnd.rn-realmedia-vbr' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg' },
  '.png': { kind: 'image', mimeType: 'image/png' },
  '.gif': { kind: 'image', mimeType: 'image/gif' },
  '.webp': { kind: 'image', mimeType: 'image/webp' },
  '.bmp': { kind: 'image', mimeType: 'image/bmp' },
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav' },
  '.aac': { kind: 'audio', mimeType: 'audio/aac' },
  '.m4a': { kind: 'audio', mimeType: 'audio/mp4' },
  '.ogg': { kind: 'audio', mimeType: 'audio/ogg' },
  '.flac': { kind: 'audio', mimeType: 'audio/flac' },
  '.wma': { kind: 'audio', mimeType: 'audio/x-ms-wma' },
  '.ppt': { kind: 'doc', mimeType: 'application/vnd.ms-powerpoint' },
  '.pptx': {
    kind: 'doc',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  '.doc': { kind: 'doc', mimeType: 'application/msword' },
  '.docx': {
    kind: 'doc',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.pdf': { kind: 'doc', mimeType: 'application/pdf' },
};

export function mediaFileTypeFromName(filename: string): MediaFileType | null {
  const fileType = FILE_TYPES_BY_EXTENSION[extname(filename.toLowerCase())];
  return fileType ? { ...fileType } : null;
}

export function classifyMediaKind(mimeType: string, filename?: string): MediaKind | null {
  if (VIDEO_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return 'video';
  if (IMAGE_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return 'image';
  if (AUDIO_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) return 'audio';
  if (DOCUMENT_MIME_TYPES.has(mimeType)) return 'doc';
  if (!filename) return null;
  const extension = extname(filename.toLowerCase());
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'doc';
  return mediaFileTypeFromName(filename)?.kind ?? null;
}

export function normalizeUploadedMimeType(mimeType: string, filename: string): string {
  if (mimeType && mimeType !== 'application/octet-stream') return mimeType;
  return mediaFileTypeFromName(filename)?.mimeType ?? mimeType;
}

export function safeMediaFilename(name: string): string {
  return (
    name
      .replace(/[\x00-\x1f\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 200) || 'unnamed'
  );
}
