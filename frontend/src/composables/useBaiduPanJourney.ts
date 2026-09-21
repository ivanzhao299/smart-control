import { onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  baiduPanService,
  type PanAuthStart,
  type PanFile,
  type PanStatus,
} from '@/services/baidu-pan.service';
import { HttpError } from '@/services/http';
import { useAdminAuthStore } from '@/stores/admin-auth';

export interface BaiduPanJourneyOptions {
  isAdmin: Readonly<Ref<boolean>>;
  refreshMedia(): Promise<unknown> | unknown;
  isDisposed?: () => boolean;
}

/**
 * 百度网盘完整交互旅程：管理员验证、配置、设备码授权、受限目录浏览、
 * 服务端下载进度和生命周期清理。页面只负责渲染这些状态。
 */
export function useBaiduPanJourney(options: BaiduPanJourneyOptions) {
  const adminAuthStore = useAdminAuthStore();
  const panDialog = ref(false);
  const panStatus = ref<PanStatus | null>(null);
  const panCfg = ref({ appKey: '', secretKey: '' });
  const panAuth = ref<PanAuthStart | null>(null);
  const panAuthHint = ref('');
  const panDir = ref('/');
  const panEntries = ref<PanFile[]>([]);
  const panLoading = ref(false);
  const panErr = ref('');
  const panNeedAdmin = ref(false);
  const panAdminUsername = ref('');
  const panAdminPwd = ref('');
  const panAdminBusy = ref(false);

  let scopeDisposed = false;
  let dialogRevision = 0;
  let listRevision = 0;
  let panPollTimer: number | undefined;

  function isCurrent(revision = dialogRevision): boolean {
    return !scopeDisposed
      && !options.isDisposed?.()
      && panDialog.value
      && revision === dialogRevision;
  }

  function canAdminister(revision = dialogRevision): boolean {
    return isCurrent(revision) && options.isAdmin.value;
  }

  function stopPanPoll(): void {
    if (panPollTimer !== undefined) {
      window.clearTimeout(panPollTimer);
      panPollTimer = undefined;
    }
  }

  async function refreshPanStatus(revision = dialogRevision): Promise<boolean> {
    try {
      const status = await baiduPanService.status();
      if (!isCurrent(revision)) return false;
      panStatus.value = status;
      panNeedAdmin.value = false;
      return true;
    } catch (error) {
      if (!isCurrent(revision)) return false;
      if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
        panNeedAdmin.value = true;
        panErr.value = '';
      } else {
        panErr.value = (error as Error).message;
      }
      return false;
    }
  }

  async function panList(dir: string, revision = dialogRevision): Promise<void> {
    if (!isCurrent(revision)) return;
    const requestRevision = ++listRevision;
    panLoading.value = true;
    panErr.value = '';
    try {
      const result = await baiduPanService.list(dir);
      if (!isCurrent(revision) || requestRevision !== listRevision) return;
      panDir.value = result.dir;
      panEntries.value = result.entries;
    } catch (error) {
      if (isCurrent(revision) && requestRevision === listRevision) {
        panErr.value = (error as Error).message;
      }
    } finally {
      if (isCurrent(revision) && requestRevision === listRevision) panLoading.value = false;
    }
  }

  async function openPanDialog(): Promise<void> {
    const revision = ++dialogRevision;
    panDialog.value = true;
    panErr.value = '';
    const loaded = await refreshPanStatus(revision);
    if (!isCurrent(revision)) return;
    if (loaded && panStatus.value?.authorized) await panList(panDir.value, revision);
    if (isCurrent(revision)) schedulePanPoll();
  }

  function closePanDialog(): void {
    dialogRevision += 1;
    listRevision += 1;
    panDialog.value = false;
    panAuth.value = null;
    panAdminBusy.value = false;
    panLoading.value = false;
    stopPanPoll();
  }

  async function panVerifyAdmin(): Promise<void> {
    if (!isCurrent()) return;
    const username = panAdminUsername.value.trim();
    const password = panAdminPwd.value;
    if (!username || !password) {
      ElMessage.warning('请输入管理员用户名和密码');
      return;
    }
    const revision = dialogRevision;
    panAdminBusy.value = true;
    try {
      await adminAuthStore.login(username, password);
      if (!isCurrent(revision)) return;
      panAdminUsername.value = '';
      panAdminPwd.value = '';
      panNeedAdmin.value = false;
      const loaded = await refreshPanStatus(revision);
      if (loaded && panStatus.value?.authorized) await panList(panDir.value, revision);
    } catch (error) {
      if (isCurrent(revision)) ElMessage.error(`验证失败: ${(error as Error).message}`);
    } finally {
      if (isCurrent(revision)) panAdminBusy.value = false;
    }
  }

  async function panSetRoot(): Promise<void> {
    if (!canAdminister()) return;
    const revision = dialogRevision;
    try {
      const { value } = await ElMessageBox.prompt(
        '设置后, 系统只能看到并下载该文件夹内的内容, 网盘其余内容完全不可见 (留空 = 全盘可见, 不推荐)。例: /展厅素材',
        '设置可见根目录',
        {
          inputValue: panStatus.value?.rootPath ?? '',
          confirmButtonText: '保存',
          cancelButtonText: '取消',
        },
      );
      if (!canAdminister(revision)) return;
      await baiduPanService.setRoot((value ?? '').trim() || null);
      if (!canAdminister(revision)) return;
      ElMessage.success('可见根目录已更新');
      const loaded = await refreshPanStatus(revision);
      if (loaded) await panList(panStatus.value?.rootPath ?? '/', revision);
    } catch (error) {
      if (isCurrent(revision) && error !== 'cancel' && (error as Error)?.message) {
        ElMessage.error((error as Error).message);
      }
    }
  }

  async function pollPanState(revision = dialogRevision): Promise<void> {
    if (!isCurrent(revision)) return;
    if (!panStatus.value) {
      if (!panNeedAdmin.value) {
        const loaded = await refreshPanStatus(revision);
        if (loaded && isCurrent(revision)) {
          panErr.value = '';
          if ((panStatus.value as PanStatus | null)?.authorized) await panList(panDir.value, revision);
        }
      }
      return;
    }
    if (panAuth.value && !panStatus.value.authorized) {
      try {
        const result = await baiduPanService.authPoll();
        if (!isCurrent(revision)) return;
        if (result.authorized) {
          panAuth.value = null;
          ElMessage.success('百度网盘授权成功');
          const loaded = await refreshPanStatus(revision);
          if (loaded) await panList('/', revision);
        } else {
          panAuthHint.value = result.pending ?? '等待手机确认…';
        }
      } catch (error) {
        if (isCurrent(revision)) panAuthHint.value = (error as Error).message;
      }
      return;
    }
    if (panStatus.value.download.active) {
      const previousAt = panStatus.value.download.last?.at;
      const loaded = await refreshPanStatus(revision);
      if (!loaded || !isCurrent(revision)) return;
      const last = panStatus.value?.download.last;
      if (last && last.at !== previousAt && !panStatus.value?.download.active) {
        (last.ok ? ElMessage.success : ElMessage.error)(`「${last.name}」${last.message}`);
        if (last.ok) {
          void options.refreshMedia();
          await panList(panDir.value, revision);
        }
      }
    }
  }

  function schedulePanPoll(): void {
    stopPanPoll();
    if (!isCurrent()) return;
    const revision = dialogRevision;
    panPollTimer = window.setTimeout(async () => {
      panPollTimer = undefined;
      await pollPanState(revision);
      if (isCurrent(revision)) schedulePanPoll();
    }, 2000);
  }

  async function panSaveConfig(): Promise<void> {
    if (!canAdminister()) return;
    const appKey = panCfg.value.appKey.trim();
    const secretKey = panCfg.value.secretKey.trim();
    if (!appKey || !secretKey) {
      ElMessage.warning('AppKey 和 SecretKey 都要填');
      return;
    }
    const revision = dialogRevision;
    try {
      await baiduPanService.saveConfig(appKey, secretKey);
      if (!canAdminister(revision)) return;
      panCfg.value = { appKey: '', secretKey: '' };
      ElMessage.success('已保存, 点「开始授权」用手机完成授权');
      await refreshPanStatus(revision);
    } catch (error) {
      if (isCurrent(revision)) ElMessage.error((error as Error).message);
    }
  }

  async function panStartAuth(): Promise<void> {
    if (!canAdminister()) return;
    const revision = dialogRevision;
    try {
      const auth = await baiduPanService.authStart();
      if (!canAdminister(revision)) return;
      panAuth.value = auth;
      panAuthHint.value = '等待手机确认…';
    } catch (error) {
      if (isCurrent(revision)) ElMessage.error((error as Error).message);
    }
  }

  function panUp(): void {
    if (!isCurrent()) return;
    const root = panStatus.value?.rootPath;
    if (panDir.value === '/' || (root && panDir.value === root)) return;
    const parts = panDir.value.split('/').filter(Boolean);
    parts.pop();
    void panList(`/${parts.join('/')}`);
  }

  async function panDownload(file: PanFile): Promise<void> {
    if (!canAdminister()) return;
    const revision = dialogRevision;
    try {
      await baiduPanService.download(file.fsId, file.name);
      if (!canAdminister(revision)) return;
      ElMessage.success(`「${file.name}」开始下载, 完成后自动入媒体库`);
      await refreshPanStatus(revision);
    } catch (error) {
      if (isCurrent(revision)) ElMessage.error((error as Error).message);
    }
  }

  onScopeDispose(() => {
    scopeDisposed = true;
    dialogRevision += 1;
    listRevision += 1;
    panDialog.value = false;
    stopPanPoll();
  });

  return {
    panDialog,
    panStatus,
    panCfg,
    panAuth,
    panAuthHint,
    panDir,
    panEntries,
    panLoading,
    panErr,
    panNeedAdmin,
    panAdminUsername,
    panAdminPwd,
    panAdminBusy,
    openPanDialog,
    closePanDialog,
    refreshPanStatus,
    panVerifyAdmin,
    panSetRoot,
    pollPanState,
    panSaveConfig,
    panStartAuth,
    panList,
    panUp,
    panDownload,
  };
}
