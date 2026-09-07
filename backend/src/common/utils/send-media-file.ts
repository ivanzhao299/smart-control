import { Readable, pipeline } from 'stream';
import type { Response } from 'express';

export interface MediaFileResponse {
  stream: Readable | null;
  mimeType: string;
  size: number;
  filename: string;
  status: number;
  contentRange?: string;
}

/** User and device responses share descriptor cleanup, including early disconnects. */
export function sendMediaFile(res: Response, file: MediaFileResponse): void {
  if (res.destroyed || res.writableEnded) {
    file.stream?.destroy();
    return;
  }
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size);
    res.setHeader('Accept-Ranges', 'bytes');
    if (file.contentRange) res.setHeader('Content-Range', file.contentRange);
    res.status(file.status);
    if (!file.stream) { res.end(); return; }
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    // pipeline destroys both sides on read/write errors or premature close.
    // After headers are sent, terminate the response rather than send JSON errors.
    pipeline(file.stream, res, () => {});
  } catch (error) {
    file.stream?.destroy();
    throw error;
  }
}
