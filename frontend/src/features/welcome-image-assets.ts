export type WelcomeImageKind = 'background' | 'logo';

export interface WelcomeImageAsset {
  id: number;
  originalName: string;
  thumbUrl: string | null;
  fileUrl: string;
  resolution: string | null;
  remark: string | null;
  source: 'upload' | 'legacy' | 'system' | 'webpage' | 'import';
}

interface WelcomeImageReference {
  welcomeBgMediaId: number | null;
  welcomeLogoMediaId: number | null;
}

export interface WelcomeImageLibraries {
  backgrounds: WelcomeImageAsset[];
  logos: WelcomeImageAsset[];
}

/**
 * 欢迎页图片按上传用途分库。旧数据只在被对应字段引用时归类，避免底图再次出现在
 * Logo 选择区，也避免整个媒体库的普通图片混入欢迎页编辑器。
 */
export function classifyWelcomeImageAssets(
  assets: WelcomeImageAsset[],
  schemes: WelcomeImageReference[],
): WelcomeImageLibraries {
  const backgroundIds = new Set(
    schemes.flatMap((item) => item.welcomeBgMediaId === null ? [] : [item.welcomeBgMediaId]),
  );
  const logoIds = new Set(
    schemes.flatMap((item) => item.welcomeLogoMediaId === null ? [] : [item.welcomeLogoMediaId]),
  );
  return {
    backgrounds: assets.filter((item) =>
      item.remark === '欢迎页底图' || backgroundIds.has(item.id),
    ),
    logos: assets.filter((item) =>
      item.remark === '欢迎页 Logo' || logoIds.has(item.id),
    ),
  };
}

export function addWelcomeImageAsset(
  libraries: WelcomeImageLibraries,
  kind: WelcomeImageKind,
  asset: WelcomeImageAsset,
): WelcomeImageLibraries {
  const key = kind === 'background' ? 'backgrounds' : 'logos';
  return {
    backgrounds: libraries.backgrounds.filter((item) => item.id !== asset.id),
    logos: libraries.logos.filter((item) => item.id !== asset.id),
    [key]: [asset, ...libraries[key].filter((item) => item.id !== asset.id)],
  };
}
