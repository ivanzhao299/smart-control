import { join } from 'path';
import {
  WELCOME_PHOTO_FOLDER,
  isManagedMediaRelativePath,
  mediaAssetContainerForStoredPath,
  mediaAssetDirectory,
} from './media-storage-layout';

describe('media storage layout', () => {
  const root = join(process.cwd(), 'fixture-media');

  it('stores welcome-photo images in their own managed directory', () => {
    const directory = mediaAssetDirectory(root, { id: 42, kind: 'image', remark: 'welcome-photo' });
    expect(directory).toBe(join(root, WELCOME_PHOTO_FOLDER, '42'));
    expect(mediaAssetContainerForStoredPath(root, 42, join(directory, 'welcome-led.jpg')))
      .toBe(join(root, WELCOME_PHOTO_FOLDER));
  });

  it('keeps other media in the existing numeric layout', () => {
    const directory = mediaAssetDirectory(root, { id: 8, kind: 'video', remark: 'welcome-photo' });
    expect(directory).toBe(join(root, '8'));
    expect(mediaAssetContainerForStoredPath(root, 8, join(directory, 'clip.mp4'))).toBe(root);
    expect(mediaAssetContainerForStoredPath(root, 9, '')).toBe(root);
  });

  it('treats welcome-photo asset trees as managed and rejects unrelated paths for deletion', () => {
    expect(isManagedMediaRelativePath(join('welcome-photos', '42', 'welcome-led.jpg'))).toBe(true);
    expect(isManagedMediaRelativePath(join('welcome-photos', 'manual.jpg'))).toBe(false);
    expect(() => mediaAssetContainerForStoredPath(root, 42, join(root, 'manual', 'welcome-led.jpg')))
      .toThrow('Invalid managed media path');
  });
});
