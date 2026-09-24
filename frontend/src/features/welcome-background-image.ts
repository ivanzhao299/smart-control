export const WELCOME_BACKGROUND_WIDTH = 3612;
export const WELCOME_BACKGROUND_HEIGHT = 1462;
export const WELCOME_BACKGROUND_RESOLUTION = `${WELCOME_BACKGROUND_WIDTH}x${WELCOME_BACKGROUND_HEIGHT}`;

export interface CoverCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Return the centered source rectangle that fills the LED canvas without stretching. */
export function centeredCoverCrop(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth = WELCOME_BACKGROUND_WIDTH,
  targetHeight = WELCOME_BACKGROUND_HEIGHT,
): CoverCrop {
  if (sourceWidth <= 0 || sourceHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    throw new Error('图片尺寸无效');
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  if (sourceRatio > targetRatio) {
    const sw = sourceHeight * targetRatio;
    return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight };
  }
  const sh = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

function decodeImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('底图解码失败，请换一张 PNG、JPG 或 WebP 图片'));
    };
    image.src = url;
  });
}

/** Convert an uploaded background to the LED's native canvas before upload. */
export async function normalizeWelcomeBackground(file: File): Promise<File> {
  const image = await decodeImage(file);
  const crop = centeredCoverCrop(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = WELCOME_BACKGROUND_WIDTH;
  canvas.height = WELCOME_BACKGROUND_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建底图画布');
  context.drawImage(
    image,
    crop.sx, crop.sy, crop.sw, crop.sh,
    0, 0, WELCOME_BACKGROUND_WIDTH, WELCOME_BACKGROUND_HEIGHT,
  );
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => result ? resolve(result) : reject(new Error('底图转换失败')),
      'image/webp',
      0.94,
    );
  });
  const base = file.name.replace(/\.[^.]+$/, '') || 'welcome-background';
  const outputType = blob.type || 'image/webp';
  const extension = outputType === 'image/webp' ? 'webp' : outputType === 'image/png' ? 'png' : 'jpg';
  return new File([blob], `${base}-${WELCOME_BACKGROUND_RESOLUTION}.${extension}`, {
    type: outputType,
    lastModified: Date.now(),
  });
}
