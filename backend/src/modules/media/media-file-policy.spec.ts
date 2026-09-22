import { readFileSync } from 'fs';
import { join } from 'path';
import {
  classifyMediaKind,
  mediaFileTypeFromName,
  normalizeUploadedMimeType,
  safeMediaFilename,
} from './media-file-policy';

describe('media file policy', () => {
  it('classifies browser MIME types before using a filename fallback', () => {
    expect(classifyMediaKind('video/custom', 'wrong.pdf')).toBe('video');
    expect(classifyMediaKind('image/custom', 'wrong.mp3')).toBe('image');
    expect(classifyMediaKind('audio/custom', 'wrong.docx')).toBe('audio');
    expect(classifyMediaKind('application/pdf', 'wrong.mp4')).toBe('doc');
  });

  it('recognizes extension fallbacks used by uploads and document projection', () => {
    expect(classifyMediaKind('application/octet-stream', 'clip.M4V')).toBe('video');
    expect(classifyMediaKind('', 'photo.JPEG')).toBe('image');
    expect(classifyMediaKind('application/octet-stream', 'archive.APE')).toBe('audio');
    expect(classifyMediaKind('application/octet-stream', 'brief.PPTX')).toBe('doc');
    expect(classifyMediaKind('application/octet-stream', 'unknown.bin')).toBeNull();
  });

  it('keeps disk scan and orphan import on the same kind and MIME table', () => {
    expect(mediaFileTypeFromName('/drop/SCREEN.m4v')).toEqual({
      kind: 'video',
      mimeType: 'video/mp4',
    });
    expect(mediaFileTypeFromName('/drop/song.m4a')).toEqual({
      kind: 'audio',
      mimeType: 'audio/mp4',
    });
    expect(mediaFileTypeFromName('/drop/handbook.docx')).toEqual({
      kind: 'doc',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    expect(mediaFileTypeFromName('/drop/unknown.bin')).toBeNull();
  });

  it('corrects only absent or generic upload MIME values', () => {
    expect(normalizeUploadedMimeType('application/octet-stream', 'movie.m4v')).toBe('video/mp4');
    expect(normalizeUploadedMimeType('', 'image.png')).toBe('image/png');
    expect(normalizeUploadedMimeType('application/vendor-specific', 'movie.mp4')).toBe(
      'application/vendor-specific',
    );
    expect(normalizeUploadedMimeType('application/octet-stream', 'track.ape')).toBe(
      'application/octet-stream',
    );
  });

  it('sanitizes path syntax, controls and whitespace without removing extensions', () => {
    expect(safeMediaFilename('  展厅 / 宣传\n片?.mp4  ')).toBe('_展厅___宣传_片_.mp4_');
    expect(safeMediaFilename('\u0000\u0001')).toBe('_');
    expect(safeMediaFilename('')).toBe('unnamed');
    expect(safeMediaFilename(`${'a'.repeat(220)}.mp4`)).toHaveLength(200);
  });

  it('keeps upload, scan and orphan import policy out of MediaService', () => {
    const service = readFileSync(join(__dirname, 'media.service.ts'), 'utf8');
    expect(service).toContain("from './media-file-policy'");
    expect(service).toContain('classifyMediaKind(mimeType, filename)');
    expect(service).toContain('normalizeUploadedMimeType(file.mimetype, originalName)');
    expect(service.match(/mediaFileTypeFromName\(/g)).toHaveLength(2);
    expect(service.match(/safeMediaFilename\(/g)).toHaveLength(4);
    expect(service).not.toContain('EXT_KIND_MIME');
    expect(service).not.toContain('AUDIO_EXT');
  });
});
