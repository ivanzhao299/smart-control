import { dirname, join, resolve } from 'path';

export const WELCOME_PHOTO_REMARK = 'welcome-photo';
export const WELCOME_PHOTO_FOLDER = 'welcome-photos';

type LayoutAsset = { id: number; kind: string; remark?: string | null };

export function mediaAssetParent(root: string, asset: LayoutAsset): string {
  return asset.kind === 'image' && asset.remark === WELCOME_PHOTO_REMARK
    ? join(root, WELCOME_PHOTO_FOLDER)
    : root;
}

export function mediaAssetDirectory(root: string, asset: LayoutAsset): string {
  return join(mediaAssetParent(root, asset), String(asset.id));
}

export function mediaAssetContainerForStoredPath(root: string, id: number, storedPath: string): string {
  const rootResolved = resolve(root);
  // Webpage records have no physical path. Keep the legacy numeric container
  // for recovery of any residual directory associated with that database ID.
  if (!storedPath) return rootResolved;
  const actualDirectory = resolve(dirname(storedPath));
  if (actualDirectory === join(rootResolved, String(id))) return rootResolved;
  const welcomeRoot = join(rootResolved, WELCOME_PHOTO_FOLDER);
  if (actualDirectory === join(welcomeRoot, String(id))) return welcomeRoot;
  throw new Error('Invalid managed media path');
}

export function isManagedMediaRelativePath(relativePath: string): boolean {
  const parts = relativePath.split(/[\\/]+/);
  return /^\d+$/.test(parts[0])
    || (parts[0] === WELCOME_PHOTO_FOLDER && /^\d+$/.test(parts[1] ?? ''))
    || parts.some(part => part === '_tmp' || part.startsWith('.delete-'));
}
