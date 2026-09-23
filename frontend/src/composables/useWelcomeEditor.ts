import { computed, onScopeDispose, reactive, ref, watch, type Directive } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  DEFAULT_WELCOME_PRESENTATION,
  fetchWelcomeSchemes,
  publishWelcomeScheme,
  removeWelcomeAsset,
  saveWelcomeSchemes,
  type WelcomePresentation,
  type WelcomeScheme,
  type WelcomeSchemesSnapshot,
} from '@/services/system-branding.service';
import { absUrl } from '@/services/http';
import { mediaService } from '@/services/media.service';
import {
  addWelcomeImageAsset,
  classifyWelcomeImageAssets,
  type WelcomeImageAsset,
} from '@/features/welcome-image-assets';
import { normalizeWelcomeBackground } from '@/features/welcome-background-image';
import {
  changeWelcomePresentation,
  chooseWelcomeBackground,
  chooseWelcomeLogo,
} from '@/features/welcome-scheme-draft';

export interface WelcomeEditorOptions {
  ensureAdmin(action: string): Promise<boolean>;
  captureAction(): () => boolean;
  isEditableSourceActive(): boolean;
  republishEditable(): Promise<void>;
}

/**
 * 欢迎方案编辑用例。
 *
 * PlayerConsole 只负责播放器与输入源编排；方案草稿、图片库、原生分辨率转换、
 * 并发修订、保存回读和正式发布都由这个边界维护。这样播放器控制改动不会再误伤
 * 欢迎页保存，欢迎页编辑也不会扩大播放器组件的职责。
 */
export function useWelcomeEditor(options: WelcomeEditorOptions) {
  const welcomeEditOpen = ref(false);
  const welcomeSaving = ref(false);
  const welcomePublishing = ref(false);
  const welcomeLoading = ref(false);
  const welcomeForm = ref({
    welcomeTitle: '', welcomeGuest: '', welcomeTagline: '',
    welcomeVenue: '', welcomeVenueEn: '', welcomeOrg1: '', welcomeOrg2: '',
    welcomeBgMediaId: null as number | null,
    welcomeLogoMediaId: null as number | null,
    presentation: { ...DEFAULT_WELCOME_PRESENTATION } as WelcomePresentation,
  });
  // 场馆名/英文/两行落款的“隐藏该行”勾选, 与输入框共同表达三态 (null=默认 / ''=隐藏 / 文本=自定义)
  const welcomeHidden = reactive({ venue: false, venueEn: false, org1: false, org2: false });
  type WelcomeDisplayFormKey = 'welcomeVenue' | 'welcomeVenueEn' | 'welcomeOrg1' | 'welcomeOrg2';
  type WelcomeDisplayHideKey = keyof typeof welcomeHidden;
  function welcomeDisplayValue(formKey: WelcomeDisplayFormKey, hideKey: WelcomeDisplayHideKey): string | null {
    if (welcomeHidden[hideKey]) return '';
    const text = welcomeForm.value[formKey].trim();
    return text === '' ? null : text;
  }
  function applyWelcomeDisplay(value: string | null, formKey: WelcomeDisplayFormKey, hideKey: WelcomeDisplayHideKey): void {
    if (value === '') { welcomeForm.value[formKey] = ''; welcomeHidden[hideKey] = true; }
    else { welcomeForm.value[formKey] = value ?? ''; welcomeHidden[hideKey] = false; }
  }
  const welcomeSchemeName = ref('');
  const welcomeSchemes = ref<WelcomeScheme[]>([]);
  const welcomeSchemesRevision = ref(0);
  const selectedWelcomeSchemeId = ref('');
  const publishedWelcomeSchemeId = ref<string | null>(null);
  const LED_CANVAS_RESOLUTION = '3612x1462';
  const welcomePreviewUrl = `${import.meta.env.DEV ? '/' : import.meta.env.BASE_URL}welcome/index.html?preview=1`;
  const welcomePreviewFrame = ref<HTMLIFrameElement | null>(null);
  const logoAssets = ref<WelcomeImageAsset[]>([]);
  const bgAssets = ref<WelcomeImageAsset[]>([]);
  const compatibleBgAssets = computed(() =>
    bgAssets.value.filter((item) => item.resolution?.toLowerCase() === LED_CANVAS_RESOLUTION),
  );
  const rejectedBgAssetCount = computed(() => bgAssets.value.length - compatibleBgAssets.value.length);
  const incompatibleSelectedBackground = ref(false);
  const incompatibleSelectedLogo = ref(false);
  const welcomeBgUploadInput = ref<HTMLInputElement | null>(null);
  const welcomeLogoUploadInput = ref<HTMLInputElement | null>(null);
  const welcomeAssetUploading = ref<'background' | 'logo' | null>(null);
  const welcomeAssetUploadPct = ref(0);
  const welcomeAssetDeletingId = ref<number | null>(null);
  const lastWelcomeSaveRevision = ref<number | null>(null);
  const LAST_WELCOME_SCHEME_KEY = 'sc.welcome.lastSelectedSchemeId';
  const welcomeLayoutOptions = [
    { value: 'ceremony', name: '居中典礼', hint: '正式接待、深色或建筑底图' },
    { value: 'editorial', name: '左文右景', hint: '画面中心较杂，左侧需要稳定文字区' },
    { value: 'minimal', name: '极简留白', hint: '浅色品牌底图、简洁活动画面' },
  ] as const;
  const welcomeToneOptions = [
    { value: 'light', name: '浅色文字' },
    { value: 'dark', name: '深色文字' },
  ] as const;
  const welcomeOverlayOptions = [
    { value: 'none', name: '无遮罩' },
    { value: 'soft', name: '柔和' },
    { value: 'strong', name: '较强' },
  ] as const;
  const welcomePositionOptions = [
    { value: 'upper', name: '偏上' },
    { value: 'center', name: '居中' },
    { value: 'lower', name: '偏下' },
  ] as const;
  const welcomeLogoSizeOptions = [
    { value: 'small', name: '小' },
    { value: 'medium', name: '中' },
    { value: 'large', name: '大' },
  ] as const;
  const welcomeTitleEffectOptions = [
    { value: 'blue', name: '科技蓝', hint: '深色底 · 默认' },
    { value: 'gold', name: '鎏金', hint: '政务接待 / 喜庆深底' },
    { value: 'white', name: '纯白描边', hint: '明暗混杂 / 复杂照片底' },
    { value: 'ink', name: '墨蓝', hint: '浅色留白底' },
    { value: 'neon', name: '霓虹青', hint: '深色科技底' },
  ] as const;
  // 场馆中文/英文/两行落款: 四条同构的“可编辑 + 可隐藏”输入行, 供模板 v-for 渲染
  const welcomeDisplayRows = [
    { formKey: 'welcomeVenue', hideKey: 'venue', label: '场馆中文名（空 = 默认，勾选 = 隐藏该行）', maxlength: 40, placeholder: '金湖展贸中心' },
    { formKey: 'welcomeVenueEn', hideKey: 'venueEn', label: '场馆英文名（空 = 默认，勾选 = 隐藏该行）', maxlength: 96, placeholder: 'JINHU EXPOSITION & TRADE CENTER' },
    { formKey: 'welcomeOrg1', hideKey: 'org1', label: '落款单位一（空 = 默认，勾选 = 隐藏该行）', maxlength: 40, placeholder: '山东金湖集团' },
    { formKey: 'welcomeOrg2', hideKey: 'org2', label: '落款单位二（空 = 默认，勾选 = 隐藏该行）', maxlength: 40, placeholder: '金湖科创产业园' },
  ] as const;

  function cloneWelcomePresentation(value?: WelcomePresentation): WelcomePresentation {
    return { ...(value ?? DEFAULT_WELCOME_PRESENTATION) };
  }

  function markWelcomeDraftChanged(): void {
    lastWelcomeSaveRevision.value = null;
  }

  function rememberedWelcomeSchemeId(): string {
    try { return window.localStorage.getItem(LAST_WELCOME_SCHEME_KEY) ?? ''; }
    catch { return ''; }
  }

  function rememberWelcomeSchemeId(id: string): void {
    if (!id) return;
    try { window.localStorage.setItem(LAST_WELCOME_SCHEME_KEY, id); }
    catch { /* private mode or disabled storage */ }
  }

  // 缩略图策略（性能修复 2026-09-23）：
  //  - 列表 list：优先用后端已生成的 thumbUrl，零原图下载；后端缺失才在本地把背景缩到
  //    480 宽 / logo 缩到 128 高。
  //  - 预览 preview：iframe 预览需要更清晰，背景 1600 宽 / logo 256 高，且只处理选中项。
  //  - fetch 由 no-store 改为 default，允许 HTTP/磁盘缓存命中，重复进入编辑器不重复下载；
  //    签名地址过期（401/403/410）仍会重新换取地址再试。
  type WelcomeThumbPurpose = 'list' | 'preview';
  const welcomeThumbUrlMap = reactive(new Map<string, string>());
  const welcomeThumbInflight = new Map<string, Promise<string>>();
  const WELCOME_BG_LIST_WIDTH = 480;
  const WELCOME_BG_PREVIEW_WIDTH = 1600;
  const WELCOME_LOGO_LIST_HEIGHT = 128;
  const WELCOME_LOGO_PREVIEW_HEIGHT = 256;

  async function ensureWelcomeThumb(
    asset: WelcomeImageAsset,
    kind: 'background' | 'logo',
    purpose: WelcomeThumbPurpose = 'list',
  ): Promise<string> {
    // 列表优先使用后端缩略图，免去下载/解码 3612x1462 原图。
    if (purpose === 'list' && asset.thumbUrl) return absUrl(asset.thumbUrl);
    const key = `${purpose}:${asset.id}`;
    const cached = welcomeThumbUrlMap.get(key);
    if (cached) return cached;
    const inflight = welcomeThumbInflight.get(key);
    if (inflight) return inflight;
    const task = (async (): Promise<string> => {
      const loadBlob = async (url: string): Promise<Blob> => {
        const res = await fetch(absUrl(url), { cache: 'default' });
        if (res.status === 401 || res.status === 403 || res.status === 410) {
          throw Object.assign(new Error(`ticket-expired-${res.status}`), { expired: true });
        }
        if (!res.ok) throw new Error(`读取图片失败 (${res.status})`);
        return res.blob();
      };
      let blob: Blob;
      try {
        blob = await loadBlob(asset.fileUrl);
      } catch (error) {
        if (!(error as { expired?: boolean }).expired) throw error;
        const access = await mediaService.access(asset.id);
        asset.fileUrl = access.url;
        blob = await loadBlob(access.url);
      }
      const bitmap = await createImageBitmap(blob);
      let targetW: number;
      let targetH: number;
      if (kind === 'background') {
        const refW = purpose === 'preview' ? WELCOME_BG_PREVIEW_WIDTH : WELCOME_BG_LIST_WIDTH;
        targetW = Math.min(bitmap.width, refW);
        targetH = Math.max(1, Math.round(targetW * (bitmap.height / bitmap.width)));
      } else {
        const refH = purpose === 'preview' ? WELCOME_LOGO_PREVIEW_HEIGHT : WELCOME_LOGO_LIST_HEIGHT;
        targetH = Math.min(bitmap.height, refH);
        targetW = Math.max(1, Math.round(targetH * (bitmap.width / bitmap.height)));
      }
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas 不可用');
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      bitmap.close?.();
      const encode = (mime: string) => new Promise<Blob | null>((resolve) =>
        canvas.toBlob((result) => resolve(result), mime, 0.85));
      const out = (await encode('image/webp'))
        || (await encode(kind === 'logo' ? 'image/png' : 'image/jpeg'));
      if (!out) throw new Error('缩略图编码失败');
      return URL.createObjectURL(out);
    })();
    welcomeThumbInflight.set(key, task);
    try {
      const url = await task;
      welcomeThumbUrlMap.set(key, url);
      return url;
    } finally {
      welcomeThumbInflight.delete(key);
    }
  }

  const vWelcomeThumb: Directive<HTMLImageElement, { id: number; kind: 'background' | 'logo' }> = {
    mounted(el, binding) {
      const { id, kind } = binding.value;
      const assetOf = (): WelcomeImageAsset | undefined =>
        (kind === 'background' ? bgAssets.value : logoAssets.value).find((asset) => asset.id === id);
      const run = (): void => {
        const asset = assetOf();
        if (!asset) return;
        ensureWelcomeThumb(asset, kind, 'list')
          .then((url) => { if (el.isConnected) el.src = url; })
          .catch(() => { if (asset.fileUrl && el.isConnected) el.src = absUrl(asset.fileUrl); });
      };
      if (typeof IntersectionObserver === 'undefined') { run(); return; }
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        run();
      }, { root: null, rootMargin: '240px' });
      observer.observe(el);
    },
  };

  onScopeDispose(() => {
    welcomeThumbUrlMap.forEach((url) => URL.revokeObjectURL(url));
    welcomeThumbUrlMap.clear();
    welcomeThumbInflight.clear();
  });

  const welcomeSaveDirty = computed(() => !welcomeLoading.value && lastWelcomeSaveRevision.value === null);

  async function requestCloseWelcomeEditor(): Promise<void> {
    if (welcomeSaving.value || welcomePublishing.value
      || welcomeAssetUploading.value !== null || welcomeAssetDeletingId.value !== null) {
      ElMessage.warning('正在保存、发布或处理图片，请稍候再关闭');
      return;
    }
    if (welcomeSaveDirty.value) {
      try {
        await ElMessageBox.confirm('当前方案有尚未保存的修改，关闭后将丢失。确定关闭吗？', '有未保存的修改', {
          confirmButtonText: '放弃修改并关闭', cancelButtonText: '继续编辑', type: 'warning',
        });
      } catch { return; }
    }
    welcomeEditOpen.value = false;
  }

  let welcomePreviewSeq = 0;
  async function pushWelcomePreview(): Promise<void> {
    const frame = welcomePreviewFrame.value;
    if (!frame) return;
    const seq = ++welcomePreviewSeq;
    const selected = compatibleBgAssets.value.find((item) => item.id === welcomeForm.value.welcomeBgMediaId);
    const selectedLogo = logoAssets.value.find((item) => item.id === welcomeForm.value.welcomeLogoMediaId);
    const [bgUrl, logoUrl] = await Promise.all([
      selected
        ? ensureWelcomeThumb(selected, 'background', 'preview').catch(() => absUrl(selected.fileUrl))
        : Promise.resolve(null),
      selectedLogo
        ? ensureWelcomeThumb(selectedLogo, 'logo', 'preview').catch(() => absUrl(selectedLogo.fileUrl))
        : Promise.resolve(null),
    ]);
    if (seq !== welcomePreviewSeq || !frame.contentWindow) return;
    frame.contentWindow.postMessage({
      type: 'smart-control:welcome-preview',
      payload: {
        welcomeTitle: welcomeForm.value.welcomeTitle,
        welcomeGuest: welcomeForm.value.welcomeGuest,
        welcomeTagline: welcomeForm.value.welcomeTagline,
        welcomeVenue: welcomeDisplayValue('welcomeVenue', 'venue'),
        welcomeVenueEn: welcomeDisplayValue('welcomeVenueEn', 'venueEn'),
        welcomeOrg1: welcomeDisplayValue('welcomeOrg1', 'org1'),
        welcomeOrg2: welcomeDisplayValue('welcomeOrg2', 'org2'),
        welcomeBgUrl: bgUrl,
        welcomeLogoUrl: logoUrl,
        welcomePresentation: cloneWelcomePresentation(welcomeForm.value.presentation),
      },
    }, window.location.origin);
  }

  // Preview-push timer with a safe fallback for sandboxed runtimes that expose
  // no setTimeout (the node:test vm context). Browsers get a 200ms debounce so
  // typing does not re-push the whole iframe on every character; a runtime
  // without a timer pushes synchronously, exactly like the old direct watch.
  const scheduleTimer: (fn: () => void, ms: number) => (() => void) =
    typeof setTimeout === 'function'
      ? (fn, ms) => {
          const id = setTimeout(fn, ms);
          return () => clearTimeout(id);
        }
      : (fn) => { fn(); return () => {}; };
  let cancelWelcomePreview: (() => void) | undefined;
  function scheduleWelcomePreview(): void {
    cancelWelcomePreview?.();
    cancelWelcomePreview = scheduleTimer(() => { void pushWelcomePreview(); }, 200);
  }
  watch(welcomeForm, scheduleWelcomePreview, { deep: true });
  watch(welcomeHidden, scheduleWelcomePreview, { deep: true });
  onScopeDispose(() => { cancelWelcomePreview?.(); });

  function applyWelcomeScheme(id: string): void {
    const scheme = welcomeSchemes.value.find((item) => item.id === id);
    if (!scheme) return;
    selectedWelcomeSchemeId.value = id;
    rememberWelcomeSchemeId(id);
    welcomeSchemeName.value = scheme.name;
    incompatibleSelectedBackground.value = scheme.welcomeBgMediaId !== null
      && !compatibleBgAssets.value.some((item) => item.id === scheme.welcomeBgMediaId);
    incompatibleSelectedLogo.value = scheme.welcomeLogoMediaId !== null
      && !logoAssets.value.some((item) => item.id === scheme.welcomeLogoMediaId);
    welcomeForm.value = {
      welcomeTitle: scheme.welcomeTitle ?? '',
      welcomeGuest: scheme.welcomeGuest ?? '',
      welcomeTagline: scheme.welcomeTagline ?? '',
      welcomeVenue: '', welcomeVenueEn: '', welcomeOrg1: '', welcomeOrg2: '',
      welcomeBgMediaId: incompatibleSelectedBackground.value ? null : scheme.welcomeBgMediaId,
      welcomeLogoMediaId: incompatibleSelectedLogo.value ? null : scheme.welcomeLogoMediaId,
      presentation: cloneWelcomePresentation(scheme.presentation),
    };
    applyWelcomeDisplay(scheme.welcomeVenue ?? null, 'welcomeVenue', 'venue');
    applyWelcomeDisplay(scheme.welcomeVenueEn ?? null, 'welcomeVenueEn', 'venueEn');
    applyWelcomeDisplay(scheme.welcomeOrg1 ?? null, 'welcomeOrg1', 'org1');
    applyWelcomeDisplay(scheme.welcomeOrg2 ?? null, 'welcomeOrg2', 'org2');
  }

  function syncSelectedWelcomeDraft(): boolean {
    const index = welcomeSchemes.value.findIndex((item) => item.id === selectedWelcomeSchemeId.value);
    if (index < 0) return false;
    const name = welcomeSchemeName.value.trim();
    if (!name) {
      ElMessage.error('方案名称不能为空');
      return false;
    }
    if (welcomeForm.value.welcomeBgMediaId !== null
      && !compatibleBgAssets.value.some((item) => item.id === welcomeForm.value.welcomeBgMediaId)) {
      ElMessage.error(`欢迎页底图必须是 LED 原生分辨率 ${LED_CANVAS_RESOLUTION}`);
      return false;
    }
    if (welcomeForm.value.welcomeLogoMediaId !== null
      && !logoAssets.value.some((item) => item.id === welcomeForm.value.welcomeLogoMediaId)) {
      ElMessage.error('欢迎页 Logo 必须是已上传的图片');
      return false;
    }
    welcomeSchemes.value[index] = {
      id: selectedWelcomeSchemeId.value,
      name,
      welcomeTitle: welcomeForm.value.welcomeTitle.trim() || null,
      welcomeGuest: welcomeForm.value.welcomeGuest.trim() || null,
      welcomeTagline: welcomeForm.value.welcomeTagline.trim() || null,
      welcomeVenue: welcomeDisplayValue('welcomeVenue', 'venue'),
      welcomeVenueEn: welcomeDisplayValue('welcomeVenueEn', 'venueEn'),
      welcomeOrg1: welcomeDisplayValue('welcomeOrg1', 'org1'),
      welcomeOrg2: welcomeDisplayValue('welcomeOrg2', 'org2'),
      welcomeBgMediaId: welcomeForm.value.welcomeBgMediaId,
      welcomeLogoMediaId: welcomeForm.value.welcomeLogoMediaId,
      presentation: cloneWelcomePresentation(welcomeForm.value.presentation),
    };
    return true;
  }

  function selectWelcomeScheme(id: string): void {
    if (id === selectedWelcomeSchemeId.value) return;
    if (!syncSelectedWelcomeDraft()) return;
    applyWelcomeScheme(id);
  }

  async function openWelcomeEditor(): Promise<void> {
    if (!(await options.ensureAdmin('编辑欢迎页'))) return;
    welcomeEditOpen.value = true;
    welcomeLoading.value = true;
    lastWelcomeSaveRevision.value = null;
    try {
      const [snapshot, images] = await Promise.all([
        fetchWelcomeSchemes(),
        mediaService.list({ kind: 'image' }),
      ]);
      const assets: WelcomeImageAsset[] = images.items.map((media) => ({
        id: media.id,
        originalName: media.originalName,
        thumbUrl: media.thumbUrl,
        fileUrl: media.fileUrl,
        resolution: media.resolution,
        remark: media.remark,
        source: media.source,
      }));
      const libraries = classifyWelcomeImageAssets(assets, snapshot.config.schemes);
      bgAssets.value = libraries.backgrounds;
      logoAssets.value = libraries.logos;
      welcomeSchemes.value = snapshot.config.schemes.map((item) => ({ ...item }));
      welcomeSchemesRevision.value = snapshot.revision;
      publishedWelcomeSchemeId.value = snapshot.publishedSchemeId;
      const publishedFallback = snapshot.publishedSchemeId
        && snapshot.config.schemes.some((item) => item.id === snapshot.publishedSchemeId)
        ? snapshot.publishedSchemeId
        : snapshot.config.schemes[0].id;
      const preferredId = selectedWelcomeSchemeId.value || rememberedWelcomeSchemeId();
      const initialId = snapshot.config.schemes.some((item) => item.id === preferredId)
        ? preferredId
        : publishedFallback;
      applyWelcomeScheme(initialId);
      lastWelcomeSaveRevision.value = snapshot.revision;
    } catch (error) {
      ElMessage.error(`读取欢迎页配置失败: ${(error as Error).message}`);
    } finally { welcomeLoading.value = false; }
  }

  function pickWelcomeAsset(kind: 'background' | 'logo'): void {
    if (welcomeAssetUploading.value) return;
    (kind === 'background' ? welcomeBgUploadInput.value : welcomeLogoUploadInput.value)?.click();
  }

  async function onWelcomeAssetPicked(kind: 'background' | 'logo', event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      ElMessage.error('请选择 PNG、JPG 或 WebP 图片');
      return;
    }
    if (!(await options.ensureAdmin(kind === 'background' ? '上传欢迎页底图' : '上传欢迎页 Logo'))) return;
    const targetSchemeId = selectedWelcomeSchemeId.value;
    const isCurrent = options.captureAction();
    welcomeAssetUploading.value = kind;
    welcomeAssetUploadPct.value = 0;
    try {
      const uploadFile = kind === 'background' ? await normalizeWelcomeBackground(file) : file;
      const uploaded = await mediaService.upload(uploadFile, {
        remark: kind === 'background' ? '欢迎页底图' : '欢迎页 Logo',
        onProgress: (pct: number) => { welcomeAssetUploadPct.value = pct; },
      });
      if (!isCurrent()) return;
      if (uploaded.kind !== 'image') throw new Error('上传文件不是可用图片');
      const access = await mediaService.access(uploaded.id);
      if (!isCurrent()) return;
      const asset: WelcomeImageAsset = {
        id: uploaded.id,
        originalName: uploaded.originalName,
        thumbUrl: null,
        fileUrl: access.url,
        resolution: uploaded.resolution,
        remark: uploaded.remark,
        source: uploaded.source,
      };
      const libraries = addWelcomeImageAsset(
        { backgrounds: bgAssets.value, logos: logoAssets.value },
        kind,
        asset,
      );
      bgAssets.value = libraries.backgrounds;
      logoAssets.value = libraries.logos;
      if (selectedWelcomeSchemeId.value !== targetSchemeId) {
        ElMessage.info('图片已上传到媒体库；当前已切换方案，因此没有自动绑定');
        return;
      }
      if (kind === 'background') {
        if (asset.resolution?.toLowerCase() !== LED_CANVAS_RESOLUTION) {
          ElMessage.warning(`底图必须是 ${LED_CANVAS_RESOLUTION}，当前为 ${asset.resolution || '未知尺寸'}；图片已保存在媒体库，但没有绑定`);
          return;
        }
        welcomeForm.value = chooseWelcomeBackground(welcomeForm.value, asset.id);
        incompatibleSelectedBackground.value = false;
        ElMessage.success('底图已转换为 LED 原生尺寸并选中，保存方案后保留');
      } else {
        welcomeForm.value = chooseWelcomeLogo(welcomeForm.value, asset.id);
        incompatibleSelectedLogo.value = false;
        ElMessage.success('Logo 已上传并选中，保存方案后保留');
      }
      markWelcomeDraftChanged();
    } catch (error) {
      ElMessage.error(`上传失败: ${(error as Error).message}`);
    } finally {
      welcomeAssetUploading.value = null;
      welcomeAssetUploadPct.value = 0;
    }
  }

  async function selectWelcomeBackground(asset: WelcomeImageAsset): Promise<void> {
    if (welcomeAssetUploading.value || welcomeAssetDeletingId.value !== null) return;
    if (asset.resolution?.toLowerCase() === LED_CANVAS_RESOLUTION) {
      welcomeForm.value = chooseWelcomeBackground(welcomeForm.value, asset.id);
      incompatibleSelectedBackground.value = false;
      markWelcomeDraftChanged();
      return;
    }
    if (!(await options.ensureAdmin('转换欢迎页底图'))) return;
    const targetSchemeId = selectedWelcomeSchemeId.value;
    const isCurrent = options.captureAction();
    welcomeAssetUploading.value = 'background';
    welcomeAssetUploadPct.value = 0;
    try {
      const access = await mediaService.access(asset.id);
      const response = await fetch(absUrl(access.url), { cache: 'no-store' });
      if (!response.ok) throw new Error(`读取原底图失败 (${response.status})`);
      const blob = await response.blob();
      const source = new File([blob], asset.originalName, {
        type: blob.type || 'image/jpeg',
        lastModified: Date.now(),
      });
      const normalized = await normalizeWelcomeBackground(source);
      const uploaded = await mediaService.upload(normalized, {
        remark: '欢迎页底图',
        onProgress: (pct: number) => { welcomeAssetUploadPct.value = pct; },
      });
      if (!isCurrent()) return;
      if (uploaded.kind !== 'image' || uploaded.resolution?.toLowerCase() !== LED_CANVAS_RESOLUTION) {
        throw new Error(`服务器未确认 ${LED_CANVAS_RESOLUTION} 底图`);
      }
      const uploadedAccess = await mediaService.access(uploaded.id);
      if (!isCurrent()) return;
      const converted: WelcomeImageAsset = {
        id: uploaded.id,
        originalName: uploaded.originalName,
        thumbUrl: null,
        fileUrl: uploadedAccess.url,
        resolution: uploaded.resolution,
        remark: uploaded.remark,
        source: uploaded.source,
      };
      const libraries = addWelcomeImageAsset(
        { backgrounds: bgAssets.value, logos: logoAssets.value },
        'background',
        converted,
      );
      bgAssets.value = libraries.backgrounds;
      logoAssets.value = libraries.logos;
      if (selectedWelcomeSchemeId.value !== targetSchemeId) {
        ElMessage.info('底图已转换保存；当前已切换方案，因此没有自动绑定');
        return;
      }
      welcomeForm.value = chooseWelcomeBackground(welcomeForm.value, converted.id);
      markWelcomeDraftChanged();
      incompatibleSelectedBackground.value = false;
      ElMessage.success('旧底图已转换为 LED 原生尺寸并选中，保存方案后生效');
    } catch (error) {
      ElMessage.error(`底图转换失败: ${(error as Error).message}`);
    } finally {
      welcomeAssetUploading.value = null;
      welcomeAssetUploadPct.value = 0;
    }
  }

  async function deleteWelcomeImage(kind: 'background' | 'logo', asset: WelcomeImageAsset): Promise<void> {
    if (asset.source === 'system' || welcomeAssetDeletingId.value !== null) return;
    if (!(await options.ensureAdmin(kind === 'background' ? '删除欢迎页底图' : '删除欢迎页 Logo'))) return;
    const referencedCount = welcomeSchemes.value.filter((scheme) =>
      kind === 'background'
        ? scheme.welcomeBgMediaId === asset.id
        : scheme.welcomeLogoMediaId === asset.id,
    ).length;
    const referenceHint = referencedCount
      ? `\n该图片已被 ${referencedCount} 套方案使用，删除后这些方案会自动改用默认${kind === 'background' ? '底图' : '场馆 Logo'}。`
      : '';
    try {
      await ElMessageBox.confirm(
        `确定永久删除“${asset.originalName}”吗？${referenceHint}`,
        kind === 'background' ? '删除欢迎页底图' : '删除欢迎页 Logo',
        {
          confirmButtonText: '删除图片',
          cancelButtonText: '取消',
          type: 'warning',
          modalClass: 'welcome-image-delete-confirm',
        },
      );
    } catch { return; }

    const selectedId = selectedWelcomeSchemeId.value;
    const isCurrent = options.captureAction();
    welcomeAssetDeletingId.value = asset.id;
    lastWelcomeSaveRevision.value = null;
    try {
      const result = await removeWelcomeAsset(asset.id, welcomeSchemesRevision.value);
      if (!isCurrent()) return;
      welcomeSchemes.value = result.schemes.config.schemes.map((item) => ({ ...item }));
      welcomeSchemesRevision.value = result.schemes.revision;
      publishedWelcomeSchemeId.value = result.schemes.publishedSchemeId;
      bgAssets.value = bgAssets.value.filter((item) => item.id !== asset.id);
      logoAssets.value = logoAssets.value.filter((item) => item.id !== asset.id);
      applyWelcomeScheme(
        welcomeSchemes.value.some((item) => item.id === selectedId)
          ? selectedId
          : welcomeSchemes.value[0].id,
      );
      lastWelcomeSaveRevision.value = result.schemes.revision;
      ElMessage.success(result.cleanupPending ? '图片记录已删除，服务器正在清理文件' : '图片已删除');
    } catch (error) {
      ElMessage.error(`删除失败: ${(error as Error).message}`);
    } finally {
      welcomeAssetDeletingId.value = null;
    }
  }

  async function persistWelcomeSchemes(checkAdmin = true): Promise<WelcomeSchemesSnapshot | null> {
    if (!syncSelectedWelcomeDraft()) return null;
    if (checkAdmin && !(await options.ensureAdmin('保存欢迎方案'))) return null;
    welcomeSaving.value = true;
    try {
      const selectedId = selectedWelcomeSchemeId.value;
      const saved = await saveWelcomeSchemes(
        {
          version: 2,
          schemes: welcomeSchemes.value.map((scheme) => ({
            ...scheme,
            presentation: cloneWelcomePresentation(scheme.presentation),
          })),
        },
        welcomeSchemesRevision.value,
      );
      const confirmed = await fetchWelcomeSchemes();
      if (confirmed.revision !== saved.revision
        || confirmed.checksum !== saved.checksum
        || JSON.stringify(confirmed.config) !== JSON.stringify(saved.config)) {
        throw new Error('服务器回读结果与本次保存不一致，请重新打开后再保存');
      }
      welcomeSchemes.value = confirmed.config.schemes.map((item) => ({ ...item }));
      welcomeSchemesRevision.value = confirmed.revision;
      publishedWelcomeSchemeId.value = confirmed.publishedSchemeId;
      lastWelcomeSaveRevision.value = confirmed.revision;
      applyWelcomeScheme(selectedId);
      return confirmed;
    } catch (error) {
      ElMessage.error(`保存失败: ${(error as Error).message}`);
      return null;
    } finally { welcomeSaving.value = false; }
  }

  async function saveWelcomeScheme(): Promise<void> {
    const schemeName = welcomeSchemeName.value.trim();
    const saved = await persistWelcomeSchemes();
    if (saved) {
      ElMessage.success(`“${schemeName}”已保存到服务器方案库（版本 ${saved.revision}），当前 LED 画面未切换`);
    }
  }

  async function publishSelectedWelcomeScheme(): Promise<void> {
    if (!(await options.ensureAdmin('发布欢迎页'))) return;
    if (!(await persistWelcomeSchemes(false))) return;
    welcomePublishing.value = true;
    try {
      const selectedId = selectedWelcomeSchemeId.value;
      const selected = welcomeSchemes.value.find((item) => item.id === selectedId);
      if (!selected) throw new Error('当前方案不存在，请重新打开编辑器');
      const published = await publishWelcomeScheme(selectedId, welcomeSchemesRevision.value);
      const confirmed = published.branding.welcomeTitle === selected.welcomeTitle
        && published.branding.welcomeGuest === selected.welcomeGuest
        && published.branding.welcomeTagline === selected.welcomeTagline
        && (published.branding.welcomeVenue ?? null) === (selected.welcomeVenue ?? null)
        && (published.branding.welcomeVenueEn ?? null) === (selected.welcomeVenueEn ?? null)
        && (published.branding.welcomeOrg1 ?? null) === (selected.welcomeOrg1 ?? null)
        && (published.branding.welcomeOrg2 ?? null) === (selected.welcomeOrg2 ?? null)
        && published.branding.welcomeBgMediaId === selected.welcomeBgMediaId
        && published.branding.welcomeLogoMediaId === selected.welcomeLogoMediaId
        && JSON.stringify(published.branding.welcomePresentation) === JSON.stringify(selected.presentation);
      if (!confirmed) throw new Error('服务器未确认发布结果，原大屏画面保持不变，请重试');
      publishedWelcomeSchemeId.value = selectedId;
      let refreshFailed = false;
      if (options.isEditableSourceActive()) {
        try { await options.republishEditable(); }
        catch { refreshFailed = true; }
      }
      if (refreshFailed) ElMessage.warning('方案已发布；大屏重推失败，将在轮询后自动更新');
      else ElMessage.success('方案已发布到 LED 大屏');
    } catch (error) {
      ElMessage.error(`发布失败: ${(error as Error).message}`);
    } finally { welcomePublishing.value = false; }
  }

  function selectWelcomeLogo(mediaId: number | null): void {
    if (welcomeAssetUploading.value || welcomeAssetDeletingId.value !== null) return;
    welcomeForm.value = chooseWelcomeLogo(welcomeForm.value, mediaId);
    incompatibleSelectedLogo.value = false;
    markWelcomeDraftChanged();
  }

  function selectDefaultWelcomeBackground(): void {
    if (welcomeAssetUploading.value || welcomeAssetDeletingId.value !== null) return;
    welcomeForm.value = chooseWelcomeBackground(welcomeForm.value, null);
    incompatibleSelectedBackground.value = false;
    markWelcomeDraftChanged();
  }

  function updateWelcomePresentation<K extends keyof WelcomePresentation>(
    key: K,
    value: WelcomePresentation[K],
  ): void {
    welcomeForm.value = changeWelcomePresentation(welcomeForm.value, key, value);
    markWelcomeDraftChanged();
  }

  function duplicateWelcomeScheme(): void {
    if (!syncSelectedWelcomeDraft()) return;
    if (welcomeSchemes.value.length >= 20) {
      ElMessage.warning('最多保存 20 套欢迎方案');
      return;
    }
    const source = welcomeSchemes.value.find((item) => item.id === selectedWelcomeSchemeId.value);
    if (!source) return;
    const copy: WelcomeScheme = {
      ...source,
      id: `scheme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${source.name} 副本`.slice(0, 40),
    };
    welcomeSchemes.value.push(copy);
    applyWelcomeScheme(copy.id);
    markWelcomeDraftChanged();
  }

  async function deleteWelcomeScheme(): Promise<void> {
    if (welcomeSchemes.value.length <= 1) {
      ElMessage.warning('至少保留一套欢迎方案');
      return;
    }
    if (selectedWelcomeSchemeId.value === publishedWelcomeSchemeId.value) {
      ElMessage.warning('当前正在使用这套方案，请先发布另一套方案');
      return;
    }
    try {
      await ElMessageBox.confirm(`确定删除“${welcomeSchemeName.value}”吗？`, '删除欢迎方案', {
        confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning',
      });
    } catch { return; }
    const index = welcomeSchemes.value.findIndex((item) => item.id === selectedWelcomeSchemeId.value);
    welcomeSchemes.value.splice(index, 1);
    applyWelcomeScheme(welcomeSchemes.value[Math.max(0, index - 1)].id);
    markWelcomeDraftChanged();
  }

  return {
    welcomeEditOpen,
    welcomeSaving,
    welcomePublishing,
    welcomeLoading,
    welcomeForm,
    welcomeHidden,
    welcomeTitleEffectOptions,
    welcomeDisplayRows,
    welcomeSchemeName,
    welcomeSchemes,
    welcomeSchemesRevision,
    selectedWelcomeSchemeId,
    publishedWelcomeSchemeId,
    LED_CANVAS_RESOLUTION,
    welcomePreviewUrl,
    welcomePreviewFrame,
    logoAssets,
    bgAssets,
    rejectedBgAssetCount,
    incompatibleSelectedBackground,
    incompatibleSelectedLogo,
    welcomeBgUploadInput,
    welcomeLogoUploadInput,
    welcomeAssetUploading,
    welcomeAssetUploadPct,
    welcomeAssetDeletingId,
    lastWelcomeSaveRevision,
    welcomeLayoutOptions,
    welcomeToneOptions,
    welcomeOverlayOptions,
    welcomePositionOptions,
    welcomeLogoSizeOptions,
    markWelcomeDraftChanged,
    vWelcomeThumb,
    requestCloseWelcomeEditor,
    pushWelcomePreview,
    selectWelcomeScheme,
    openWelcomeEditor,
    pickWelcomeAsset,
    onWelcomeAssetPicked,
    selectWelcomeBackground,
    deleteWelcomeImage,
    saveWelcomeScheme,
    publishSelectedWelcomeScheme,
    selectWelcomeLogo,
    selectDefaultWelcomeBackground,
    updateWelcomePresentation,
    duplicateWelcomeScheme,
    deleteWelcomeScheme,
  };
}
