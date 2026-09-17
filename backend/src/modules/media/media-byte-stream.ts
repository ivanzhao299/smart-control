import { NotFoundException } from '@nestjs/common';
import { promises as fs, ReadStream } from 'fs';
import { resolve, relative, sep, isAbsolute } from 'path';
import type { MediaAsset } from '../../entities/media-asset.entity';
import { byteRange } from './byte-range';

export interface MediaByteStream {
  stream: ReadStream | null;
  mimeType: string;
  size: number;
  filename: string;
  status: number;
  contentRange?: string;
}

/** File delivery only. Caller must select an authorized asset before entering this boundary. */
export async function openMediaByteStream(
  mediaRoot: string,
  m: Pick<MediaAsset, 'path' | 'originalName' | 'mimeType' | 'docPdfPath'>,
  asPdf = false,
  rangeHeader?: string,
): Promise<MediaByteStream> {
  let file = m.path;
  let filename = m.originalName;
  let mimeType = m.mimeType;
  if (asPdf) {
    if (!m.docPdfPath)
      throw new NotFoundException('该文档还没有转换出 PDF (放映守护转换中或未启动)');
    file = resolve(mediaRoot, m.docPdfPath);
    const rel = relative(mediaRoot, file);
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(file) === resolve(mediaRoot)) {
      throw new NotFoundException('文件不存在');
    }
    filename = m.originalName.replace(/\.[^.]+$/, '') + '.pdf';
    mimeType = 'application/pdf';
  }
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    const root = await fs.realpath(mediaRoot);
    file = await fs.realpath(file);
    const rel = relative(root, file);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error('outside media root');
    const expected = await fs.stat(file, { bigint: true });
    if (!expected.isFile() || expected.ino === 0n) throw new Error('unverifiable file');
    handle = await fs.open(file, 'r');
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino)
      throw new Error('file replaced');
    const size = Number(opened.size);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid file size');
    const range = byteRange(rangeHeader, size);
    if (!range)
      return {
        stream: null,
        mimeType,
        filename,
        size: 0,
        status: 416,
        contentRange: `bytes */${size}`,
      };
    if (size === 0) return { stream: null, mimeType, filename, size: 0, status: 200 };
    // Read through the verified descriptor, not a second asynchronous path open.
    const stream = handle.createReadStream({ start: range.start, end: range.end });
    handle = undefined; // Stream now owns and automatically closes the handle.
    return {
      stream,
      mimeType,
      filename,
      size: range.partial ? range.end - range.start + 1 : size,
      status: range.partial ? 206 : 200,
      contentRange: range.partial ? `bytes ${range.start}-${range.end}/${size}` : undefined,
    };
  } catch {
    throw new NotFoundException('文件不存在');
  } finally {
    await handle?.close();
  }
}
