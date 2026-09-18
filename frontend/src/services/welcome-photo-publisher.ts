export interface WelcomePhotoSnapshot {
  mediaId: number | null;
  revision: number | null | undefined;
}

export interface WelcomePhotoPublishDependencies {
  readCurrent: () => Promise<WelcomePhotoSnapshot>;
  /** 跨异步步骤核对原账号/服务器；失效即停止后续副作用。 */
  assertActive: () => void;
  uploadLedPhoto: (file: File) => Promise<{ id: number }>;
  bindWelcomePhoto: (mediaId: number | null, expectedRevision: number) => Promise<WelcomePhotoSnapshot>;
  showWelcomePage: () => Promise<void>;
  removeMedia: (mediaId: number) => Promise<void>;
}

export interface WelcomePhotoPublishResult {
  mediaId: number;
  previousMediaId: number | null;
  shown: boolean;
  revision: number;
}

export class WelcomePhotoBindingUnconfirmedError extends Error {
  constructor(public readonly mediaId: number) {
    super('照片已上传，但绑定结果未确认；请先刷新核对，勿重复上传');
    this.name = 'WelcomePhotoBindingUnconfirmedError';
  }
}

function requireRevision(snapshot: WelcomePhotoSnapshot): number {
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision ?? 0) < 1) {
    throw new Error('欢迎页配置版本不可用，请重新加载');
  }
  return snapshot.revision as number;
}

/**
 * 拍照上墙的可测试业务边界。
 *
 * 读取成功且版本有效才上传；以原始版本绑定一次。回执丢失时只读核实，
 * 不重试写入、不盲删新图。不确定的文件保留在媒体库，后续由用户核对处理。
 */
export async function publishWelcomePhoto(
  ledPhoto: File,
  dependencies: WelcomePhotoPublishDependencies,
): Promise<WelcomePhotoPublishResult> {
  dependencies.assertActive();
  const before = await dependencies.readCurrent();
  dependencies.assertActive();
  const expectedRevision = requireRevision(before);
  const previousMediaId = before.mediaId;
  const uploaded = await dependencies.uploadLedPhoto(ledPhoto);
  dependencies.assertActive();
  const confirmsBinding = (snapshot: WelcomePhotoSnapshot) =>
    snapshot.mediaId === uploaded.id && requireRevision(snapshot) > expectedRevision;
  let revision: number;
  try {
    const confirmed = await dependencies.bindWelcomePhoto(uploaded.id, expectedRevision);
    dependencies.assertActive();
    if (!confirmsBinding(confirmed)) throw new Error('绑定回执不匹配');
    revision = requireRevision(confirmed);
  } catch {
    dependencies.assertActive();
    let current: WelcomePhotoSnapshot;
    try {
      current = await dependencies.readCurrent();
      dependencies.assertActive();
      if (!confirmsBinding(current)) throw new Error('绑定未确认');
      revision = requireRevision(current);
    } catch {
      dependencies.assertActive();
      throw new WelcomePhotoBindingUnconfirmedError(uploaded.id);
    }
  }

  dependencies.assertActive();
  let shown = true;
  await dependencies.showWelcomePage().catch(() => { shown = false; });
  dependencies.assertActive();
  if (previousMediaId && previousMediaId !== uploaded.id) {
    // 后端仍须在删除事务中保护所有欢迎页引用，客户端预检不能消除并发绑定。
    await dependencies.removeMedia(previousMediaId).catch(() => undefined);
  }
  dependencies.assertActive();
  return { mediaId: uploaded.id, previousMediaId, shown, revision };
}

/** Withdraw only the photo/version the user actually saw; no automatic fresh-baseline overwrite. */
export async function takeDownWelcomePhoto(
  before: WelcomePhotoSnapshot,
  dependencies: Pick<WelcomePhotoPublishDependencies, 'assertActive' | 'readCurrent' | 'bindWelcomePhoto' | 'removeMedia'>,
): Promise<WelcomePhotoSnapshot> {
  dependencies.assertActive();
  const revision = requireRevision(before);
  if (!before.mediaId) return before;
  let confirmed: WelcomePhotoSnapshot;
  const confirmsRemoval = (value: WelcomePhotoSnapshot) => value.mediaId === null && requireRevision(value) > revision;
  try {
    confirmed = await dependencies.bindWelcomePhoto(null, revision);
    dependencies.assertActive();
    if (!confirmsRemoval(confirmed)) throw Error('撤下回执不匹配');
  } catch {
    dependencies.assertActive();
    confirmed = await dependencies.readCurrent();
    dependencies.assertActive();
    if (!confirmsRemoval(confirmed)) throw Error('撤下结果未确认，请刷新核对');
  }
  dependencies.assertActive();
  await dependencies.removeMedia(before.mediaId).catch(() => undefined);
  dependencies.assertActive();
  return confirmed;
}
