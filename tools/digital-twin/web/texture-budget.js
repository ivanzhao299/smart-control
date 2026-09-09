// Read dimensions from embedded image headers before allocating GPU textures.
export function imageSize(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
  if (bytes.length >= 24 && view.getUint32(0) === 0x89504e47) return [view.getUint32(16), view.getUint32(20)];
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) continue;
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 7) return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
      offset += length;
    }
  }
  if (bytes.length >= 30 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') {
    const type = text(12, 16);
    const u24 = pos => bytes[pos] + bytes[pos + 1] * 256 + bytes[pos + 2] * 65536;
    if (type === 'VP8X') return [u24(24) + 1, u24(27) + 1];
    if (type === 'VP8 ') return [view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff];
    if (type === 'VP8L' && bytes[20] === 0x2f) return [1 + (bytes[21] | (bytes[22] & 0x3f) << 8), 1 + ((bytes[22] >> 6) | bytes[23] << 2 | (bytes[24] & 15) << 10)];
  }
  throw Error('无法识别纹理尺寸，请先通过本地转换工作流处理');
}

export function textureBudget(buffer, json) {
  const view = new DataView(buffer);
  let offset = 12, bin;
  while (offset + 8 <= buffer.byteLength) {
    const length = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    if (offset + 8 + length > buffer.byteLength) throw Error('GLB 数据块不完整');
    if (type === 0x004e4942) bin = new Uint8Array(buffer, offset + 8, length);
    offset += 8 + length;
  }
  let rgbaBytes = 0;
  for (const image of json.images ?? []) {
    if (image.bufferView === undefined || !bin) throw Error('纹理必须嵌入 GLB 的二进制数据块');
    const part = json.bufferViews?.[image.bufferView];
    if (!part || (part.buffer ?? 0) !== 0 || (part.byteOffset ?? 0) + part.byteLength > bin.byteLength) throw Error('纹理数据范围无效');
    const bytes = bin.subarray(part.byteOffset ?? 0, (part.byteOffset ?? 0) + part.byteLength);
    const [width, height] = imageSize(bytes);
    if (!width || !height || Math.max(width, height) > 2048) throw Error('纹理最长边超过 2048，请先优化后再预览');
    rgbaBytes += width * height * 4 * 4 / 3; // RGBA8 plus mipmaps; estimate, not measured total GPU memory.
  }
  if (rgbaBytes > 256 * 1048576) throw Error('纹理解码占用估算超过 256 MiB，请减少贴图或降低分辨率');
  return { images: (json.images ?? []).length, estimatedTextureMiB: rgbaBytes / 1048576 };
}
