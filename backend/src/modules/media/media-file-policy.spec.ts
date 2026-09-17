import { classifyMediaKind, mediaTypeFromExtension, safeMediaFilename } from './media-file-policy';

describe('media file policy', () => {
  it.each([
    ['video/mp4', 'audio.mp3', 'video'],
    ['image/jpeg', 'film.mp4', 'image'],
    ['audio/wav', 'slides.pptx', 'audio'],
    ['application/pdf', undefined, 'doc'],
    ['application/vnd.ms-powerpoint', undefined, 'doc'],
    ['application/msword', undefined, 'doc'],
    ['application/octet-stream', 'Video.M4V', 'video'],
    ['application/octet-stream', 'movie.MKV', 'video'],
    ['', 'recording.APE', 'audio'],
    ['', 'recording.DSF', 'audio'],
    ['', 'office.PPTX', 'doc'],
    ['', 'note.DOCX', 'doc'],
    ['', 'photo.PNG', 'image'],
    ['', 'media.mp4.exe', null],
    ['application/octet-stream', undefined, null],
    ['', 'page.html', null],
  ])('classifies %s / %s as %s without replacing explicit MIME priority', (mime, name, kind) => {
    expect(classifyMediaKind(mime!, name ?? undefined)).toBe(kind);
  });

  it('keeps orphan/ingest MIME fallback consistent and prevents callers mutating the registry', () => {
    expect(mediaTypeFromExtension('.M4V')).toEqual({ kind: 'video', mime: 'video/mp4' });
    expect(mediaTypeFromExtension('.pdf')).toEqual({ kind: 'doc', mime: 'application/pdf' });
    expect(mediaTypeFromExtension('.unknown')).toBeUndefined();
    const copy = mediaTypeFromExtension('.m4v') as { kind: string; mime: string };
    copy.kind = 'image';
    expect(mediaTypeFromExtension('.m4v')?.kind).toBe('video');
  });

  it('normalizes path/control characters, whitespace, empty names and maximum length', () => {
    expect(safeMediaFilename('园区 影片.MP4')).toBe('园区_影片.MP4');
    expect(safeMediaFilename('../a\\b: c\u0000.mp4')).toBe('.._a_b__c_.mp4');
    expect(safeMediaFilename('')).toBe('unnamed');
    expect(safeMediaFilename('x'.repeat(300))).toHaveLength(200);
  });
});
