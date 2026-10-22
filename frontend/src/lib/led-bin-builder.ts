/**
 * 勇电 LED 大屏 bin 文件真生成器（Canvas 文字 + 视频帧渲染版）
 *
 * 结构：头 1536B + N×33792B 帧区 + 尾 1620B
 * 灯位：列优先蛇形，8190 有效灯，GRB 顺序
 */
import LED_DATA from '../assets/led/led-bin-data.json';

const {
  ledCols, ledRows,
  headTemplateB64, tailTemplateB64, blockTemplateB64,
  frameSize, blockSize, blocksPerFrame, pixelsPerBlock, pixelOffsetInBlock,
} = LED_DATA;

const W = 290;
const H = 30;
const FPS = 25;

function b64ToBytes(b64: string): Uint8Array {
  let s = b64.replace(/\s/g, '');
  while (s.length % 4 !== 0) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface BinLine {
  text: string; size: number; tpl: string; color: string; bold?: boolean;
}

/** 一个节目段：文字段或预解码视频帧段 */
export interface ProgramSeg {
  type: 'text' | 'video';
  /** 文字段的行 */
  lines?: BinLine[];
  /** 滚动速度 */
  scrollSpeed?: number;
  /** 视频段：预解码的每帧 RGBA 数据（W×H×4） */
  videoFrames?: Uint8ClampedArray[];
  /** 重复次数 */
  rep?: number;
}

export interface GenerateBinOptions {
  segments: ProgramSeg[];
}

export interface GeneratedBin {
  bytes: Uint8Array; totalFrames: number; sizeBytes: number; fileName: string;
}

/** 估算文字宽度 */
function measureTextWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) > 127 ? size : Math.ceil(size * 0.6);
  return w;
}

/** 计算文字段需要多少帧 */
function textSegFrames(lines: BinLine[], scrollSpeed: number): number {
  let maxF = FPS * 3;
  for (const ln of lines) {
    const tw = measureTextWidth(ln.text, ln.size);
    if (ln.tpl === 'scrollL' || ln.tpl === 'scrollR') {
      maxF = Math.max(maxF, Math.ceil((W + tw) / scrollSpeed * FPS));
    } else if (ln.tpl === 'blink') {
      maxF = Math.max(maxF, FPS * 4);
    }
  }
  return maxF;
}

/** 渲染文字段某一帧 */
function renderTextFrame(lines: BinLine[], frameIdx: number, totalFrames: number, scrollSpeed: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);

  const totalH = lines.reduce((s, l) => s + l.size, 0) + (lines.length - 1);
  let y = Math.max(0, Math.floor((H - totalH) / 2));

  for (const ln of lines) {
    ctx.font = `${ln.bold ? 'bold ' : ''}${ln.size}px sans-serif`;
    ctx.fillStyle = ln.color;
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(ln.text).width;
    let x: number;
    if (ln.tpl === 'scrollL') {
      const dur = (W + tw) / scrollSpeed;
      x = W - (frameIdx / totalFrames) * dur * scrollSpeed;
    } else if (ln.tpl === 'scrollR') {
      const dur = (W + tw) / scrollSpeed;
      x = -tw + (frameIdx / totalFrames) * dur * scrollSpeed;
    } else if (ln.tpl === 'blink') {
      if (Math.floor(frameIdx / 30) % 2 === 0) {
        ctx.fillText(ln.text, Math.floor((W - tw) / 2), y);
      }
      y += ln.size + 1;
      continue;
    } else {
      x = Math.floor((W - tw) / 2);
    }
    ctx.fillText(ln.text, x, y);
    y += ln.size + 1;
  }
  return ctx.getImageData(0, 0, W, H).data;
}

/** 异步解码视频文件为帧序列（加固版） */
export async function decodeVideoFrames(file: File, maxFrames = 200): Promise<Uint8ClampedArray[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = url;
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.style.display = 'none';
  video.style.position = 'fixed';
  video.style.top = '-9999px';
  document.body.appendChild(video);

  const cleanup = () => {
    if (video.parentNode) document.body.removeChild(video);
    URL.revokeObjectURL(url);
  };

  // 等待 metadata，带 10s 超时
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('视频加载超时（10s），可能是 HEVC 编码不被浏览器支持，请转 H.264'));
    }, 10000);
    video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
    video.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`视频解码失败（codec=${video.error?.code ?? 'unknown'}），请确认是 H.264/MP4 格式`));
    };
  });

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const frames: Uint8ClampedArray[] = [];
  const duration = video.duration || 3;
  const frameInterval = 1 / FPS;
  const total = Math.min(maxFrames, Math.ceil(duration * FPS));

  try {
    for (let i = 0; i < total; i++) {
      video.currentTime = Math.min(i * frameInterval, duration - 0.05);
      // seek 带 5s 超时
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`视频 seek 超时（帧 ${i}）`)), 5000);
        video.onseeked = () => { clearTimeout(timer); resolve(); };
      });
      ctx.drawImage(video, 0, 0, W, H);
      frames.push(ctx.getImageData(0, 0, W, H).data);
    }
  } finally {
    cleanup();
  }
  return frames;
}

/** 把一帧 RGBA 像素写入块数据 */
function writeFramePixels(frameArea: Uint8Array, frameOffset: number, imgData: Uint8ClampedArray) {
  for (let pix = 0; pix < ledCols.length; pix++) {
    const x = ledCols[pix];
    const y = ledRows[pix];
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const di = (y * W + x) * 4;
    const r = imgData[di], g = imgData[di + 1], b = imgData[di + 2], a = imgData[di + 3];
    if (a < 128) continue;
    const blkIdx = Math.floor(pix / pixelsPerBlock);
    if (blkIdx >= blocksPerFrame) continue;
    const inBlk = pix % pixelsPerBlock;
    const off = frameOffset + blkIdx * blockSize + pixelOffsetInBlock + inBlk * 3;
    frameArea[off] = g;
    frameArea[off + 1] = r;
    frameArea[off + 2] = b;
  }
}

/** 生成完整 bin */
export function generateYongdianBin(opts: GenerateBinOptions): GeneratedBin {
  const head = b64ToBytes(headTemplateB64);
  const tail = b64ToBytes(tailTemplateB64);
  const blockTemplate = b64ToBytes(blockTemplateB64);

  // 展开段序列：计算每段帧数
  interface FrameSource { kind: 'text'; lines: BinLine[]; scrollSpeed: number; segFrames: number; }
  interface VideoSource { kind: 'video'; videoFrames: Uint8ClampedArray[]; }
  type Source = FrameSource | VideoSource;

  const sources: Source[] = [];
  for (const seg of opts.segments) {
    const rep = seg.rep ?? 1;
    for (let r = 0; r < rep; r++) {
      if (seg.type === 'video' && seg.videoFrames) {
        sources.push({ kind: 'video', videoFrames: seg.videoFrames });
      } else {
        const speed = seg.scrollSpeed ?? 30;
        const lines = seg.lines ?? [];
        sources.push({ kind: 'text', lines, scrollSpeed: speed, segFrames: textSegFrames(lines, speed) });
      }
    }
  }

  const totalFrames = sources.reduce((s, src) => s + (src.kind === 'text' ? src.segFrames : src.videoFrames.length), 0);

  // 修改头
  const newHead = new Uint8Array(head);
  newHead[0x20] = totalFrames & 0xff;
  newHead[0x21] = (totalFrames >> 8) & 0xff;
  newHead[0x38] = totalFrames & 0xff;
  newHead[0x39] = (totalFrames >> 8) & 0xff;
  const layOff = head.length + totalFrames * frameSize;
  newHead[0x30] = layOff & 0xff;
  newHead[0x31] = (layOff >> 8) & 0xff;
  newHead[0x32] = (layOff >> 16) & 0xff;
  newHead[0x33] = (layOff >> 24) & 0xff;

  const frameArea = new Uint8Array(totalFrames * frameSize);
  let f = 0;
  for (const src of sources) {
    const segLen = src.kind === 'text' ? src.segFrames : src.videoFrames.length;
    for (let i = 0; i < segLen; i++) {
      const frameOffset = f * frameSize;
      for (let blk = 0; blk < blocksPerFrame; blk++) {
        frameArea.set(blockTemplate, frameOffset + blk * blockSize);
      }
      const imgData = src.kind === 'text'
        ? renderTextFrame(src.lines, i, segLen, src.scrollSpeed)
        : src.videoFrames[i];
      writeFramePixels(frameArea, frameOffset, imgData);
      f++;
    }
  }

  const full = new Uint8Array(newHead.length + frameArea.length + tail.length);
  full.set(newHead, 0);
  full.set(frameArea, newHead.length);
  full.set(tail, newHead.length + frameArea.length);

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const fileName = `G_P01_01_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.bin`;

  return { bytes: full, totalFrames, sizeBytes: full.length, fileName };
}

export function downloadBin(bin: GeneratedBin): void {
  const blob = new Blob([bin.bytes as BlobPart], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = bin.fileName;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const LED_PIXEL_COUNT = ledCols.length;
export { ledCols, ledRows };
