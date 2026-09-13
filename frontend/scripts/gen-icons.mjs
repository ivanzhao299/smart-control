// 生成 PWA 所需的 192/512 PNG 图标 (纯色 + 居中圆角图形)
// 用法: node scripts/gen-icons.mjs
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { deflateSync } from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  // 背景 #111827, 中心圆角方块 #2563EB, 内嵌白色折线 (LED 风格抽象)
  const bg = [0x11, 0x18, 0x27, 0xff];
  const fg = [0x25, 0x63, 0xeb, 0xff];
  const text = [0xf9, 0xfa, 0xfb, 0xff];

  const px = (x, y) => {
    // 居中圆角方块
    const inset = Math.floor(size * 0.18);
    const r = Math.floor(size * 0.16);
    const inMain =
      x >= inset && x < size - inset && y >= inset && y < size - inset;
    const corner = (cx, cy) =>
      Math.hypot(x - cx, y - cy) > r ? false : true;
    let inSquare = inMain;
    if (inMain) {
      // 圆角裁剪
      const cx1 = inset + r, cx2 = size - inset - r - 1;
      const cy1 = inset + r, cy2 = size - inset - r - 1;
      if (x < cx1 && y < cy1 && !corner(cx1, cy1)) inSquare = false;
      if (x > cx2 && y < cy1 && !corner(cx2, cy1)) inSquare = false;
      if (x < cx1 && y > cy2 && !corner(cx1, cy2)) inSquare = false;
      if (x > cx2 && y > cy2 && !corner(cx2, cy2)) inSquare = false;
    }
    if (!inSquare) return bg;

    // 内部抽象图形：S 形折线 (代表"场景")
    const mid = size / 2;
    const t = size * 0.05;
    const line1 = Math.abs(y - mid + size * 0.12) <= t && x > size * 0.3 && x < size * 0.7;
    const line2 = Math.abs(y - mid) <= t && x > size * 0.3 && x < size * 0.7;
    const line3 = Math.abs(y - mid - size * 0.12) <= t && x > size * 0.3 && x < size * 0.7;
    if (line1 || line2 || line3) return text;
    return fg;
  };

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // IDAT
  const rowLen = 1 + size * 4;
  const raw = Buffer.alloc(rowLen * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter = None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = px(x, y);
      const off = y * rowLen + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }
  const idat = deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const file = resolve(outDir, `pwa-${size}x${size}.png`);
  writeFileSync(file, makePng(size));
  console.log(`  wrote ${file} (${size}x${size})`);
}

// SVG fallback (favicon)
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192">
  <rect width="192" height="192" rx="20" fill="#111827"/>
  <rect x="35" y="35" width="122" height="122" rx="22" fill="#2563EB"/>
  <g fill="#F9FAFB">
    <rect x="55" y="73" width="82" height="10" rx="2"/>
    <rect x="55" y="91" width="82" height="10" rx="2"/>
    <rect x="55" y="109" width="82" height="10" rx="2"/>
  </g>
</svg>`;
writeFileSync(resolve(outDir, 'app.svg'), svg);
console.log('  wrote app.svg');
