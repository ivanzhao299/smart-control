export interface WelcomePhotoPublishDependencies {
  readCurrentMediaId: () => Promise<number | null>;
  uploadLedPhoto: (file: File) => Promise<{ id: number }>;
  bindWelcomePhoto: (mediaId: number) => Promise<void>;
  showWelcomePage: () => Promise<void>;
  removeMedia: (mediaId: number) => Promise<void>;
}

export interface WelcomePhotoPublishResult {
  mediaId: number;
  previousMediaId: number | null;
}

/**
 * 拍照上墙的可测试业务边界。
 *
 * 新文件先进入媒体库，绑定成功后才切换大屏和回收旧文件。绑定失败时尽力回收
 * 本次新上传，绝不删除仍在欢迎页使用的旧文件。
 */
export async function publishWelcomePhoto(
  ledPhoto: File,
  dependencies: WelcomePhotoPublishDependencies,
): Promise<WelcomePhotoPublishResult> {
  const previousMediaId = await dependencies.readCurrentMediaId().catch(() => null);
  const uploaded = await dependencies.uploadLedPhoto(ledPhoto);
  try {
    await dependencies.bindWelcomePhoto(uploaded.id);
  } catch (error) {
    await dependencies.removeMedia(uploaded.id).catch(() => undefined);
    throw error;
  }

  await dependencies.showWelcomePage().catch(() => undefined);
  if (previousMediaId && previousMediaId !== uploaded.id) {
    await dependencies.removeMedia(previousMediaId).catch(() => undefined);
  }
  return { mediaId: uploaded.id, previousMediaId };
}
