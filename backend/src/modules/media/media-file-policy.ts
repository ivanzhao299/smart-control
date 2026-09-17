import { extname } from 'path';
import type { MediaKind } from '../../entities/media-asset.entity';

const VIDEO_MIME_PREFIXES = ['video/'];
const IMAGE_MIME_PREFIXES = ['image/'];
const AUDIO_MIME_PREFIXES = ['audio/'];
// 有些浏览器/系统对音频给的 mime 不带 audio/ 前缀 (如 Windows 对 .ape/.flac 报 application/octet-stream), 用扩展名兜底
// 文档投屏 (2026-07-25): PPT 原生放映保动画, Word 转 PDF 逐页
const DOC_EXT = ['.ppt', '.pptx', '.doc', '.docx', '.pdf'];
const DOC_MIME = [
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
];
const AUDIO_EXT = [
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
];

/**
 * 扫描磁盘用 —— 上传走的是浏览器给的 mimetype, 但业主直接在服务器上 (RDP/U盘)
 * 把文件拷进 media 目录时, 文件系统只有扩展名, 没有 mimetype。这份表按扩展名兜底猜
 * kind + mimeType, 只覆盖常见格式 (够用即可, 猜不出来的交给业主自己改文件名重传)。
 */
const EXT_KIND_MIME: Record<string, { kind: Exclude<MediaKind, 'webpage'>; mime: string }> = {
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.mkv': { kind: 'video', mime: 'video/x-matroska' },
  '.avi': { kind: 'video', mime: 'video/x-msvideo' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.flv': { kind: 'video', mime: 'video/x-flv' },
  '.wmv': { kind: 'video', mime: 'video/x-ms-wmv' },
  // .m4v 本质就是 MP4 容器 (H.264), 用标准 video/mp4 —— x-m4v 这种冷门 mime
  // 会让个别播放端拒识 (2026-07-31 业主: 所有播放器要支持 m4v)
  '.m4v': { kind: 'video', mime: 'video/mp4' },
  '.mpg': { kind: 'video', mime: 'video/mpeg' },
  '.mpeg': { kind: 'video', mime: 'video/mpeg' },
  '.3gp': { kind: 'video', mime: 'video/3gpp' },
  '.ts': { kind: 'video', mime: 'video/mp2t' },
  '.vob': { kind: 'video', mime: 'video/mpeg' },
  '.rmvb': { kind: 'video', mime: 'application/vnd.rn-realmedia-vbr' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.bmp': { kind: 'image', mime: 'image/bmp' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.aac': { kind: 'audio', mime: 'audio/aac' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.flac': { kind: 'audio', mime: 'audio/flac' },
  '.wma': { kind: 'audio', mime: 'audio/x-ms-wma' },
  '.ppt': { kind: 'doc', mime: 'application/vnd.ms-powerpoint' },
  '.pptx': {
    kind: 'doc',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  '.doc': { kind: 'doc', mime: 'application/msword' },
  '.docx': {
    kind: 'doc',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.pdf': { kind: 'doc', mime: 'application/pdf' },
};

export function classifyMediaKind(mimeType: string, filename?: string): MediaKind | null {
  if (VIDEO_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return 'video';
  if (IMAGE_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return 'image';
  if (AUDIO_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return 'audio';
  // 扩展名兜底: m4a/aac 等有时 mime 给成 application/octet-stream
  if (DOC_MIME.includes(mimeType)) return 'doc';
  if (filename) {
    const lower = filename.toLowerCase();
    if (AUDIO_EXT.some((ext) => lower.endsWith(ext))) return 'audio';
    if (DOC_EXT.some((ext) => lower.endsWith(ext))) return 'doc';
    // 视频/图片扩展名兜底: .m4v/.mkv 等浏览器常报 application/octet-stream (2026-07-31)
    const byExt = EXT_KIND_MIME[extname(lower)];
    if (byExt) return byExt.kind;
  }
  return null;
}

/** Filename normalization is independent of storage paths or ownership. */
export function safeMediaFilename(name: string): string {
  // 保留扩展名, 去掉路径符号 / 控制字符 / 引号
  return (
    name
      .replace(/[\x00-\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 200) || 'unnamed'
  );
}

export function mediaTypeFromExtension(
  extension: string,
): Readonly<{ kind: Exclude<MediaKind, 'webpage'>; mime: string }> | undefined {
  const entry = EXT_KIND_MIME[extension.toLowerCase()];
  return entry ? { ...entry } : undefined;
}
