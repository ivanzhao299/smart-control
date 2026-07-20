<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter, useRoute } from 'vue-router';
import {
  Upload,
  Trash2,
  Film,
  Image as ImageIcon,
  Music,
  X,
  FolderOpen,
  RefreshCcw,
  Send,
  ArrowLeft,
  Home,
  Globe,
  LayoutList,
  LayoutGrid,
  AlignJustify,
} from 'lucide-vue-next';
import { mediaService, type MediaItem, type OrphanMediaItem } from '@/services/media.service';
import { usePlaybackStore } from '@/stores/playback';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { absUrl } from '@/services/http';

const brandingStore = useSystemBrandingStore();

const playbackStore = usePlaybackStore();

const router = useRouter();
const route = useRoute();

/**
 * 挑选模式 — 从 LedPage 跳过来时 URL 带 ?pick_for_slot=1 / 2.
 * 此时:
 *   - 顶部 banner 提示"为 XX 选媒体"
 *   - 点卡片就直接推到那个 slot, 不弹 "推到哪" 菜单
 *   - 推完自动返回 LedPage
 *   - 顶部 "返回" 按钮也回 LedPage 而不是 dashboard
 */
const pickForSlot = computed<1 | 2 | 3 | null>(() => {
  const v = Array.isArray(route.query.pick_for_slot) ? route.query.pick_for_slot[0] : route.query.pick_for_slot;
  const n = Number(v);
  return n === 1 || n === 2 || n === 3 ? n : null;
});
const pickModeLabel = computed<string>(() => {
  if (pickForSlot.value === 1) return 'LED 大屏 (HDMI1)';
  if (pickForSlot.value === 2) return '投影仪 (HDMI2)';
  if (pickForSlot.value === 3) return '背景音乐 (音响)';
  return '';
});

/** 挑选模式回哪个页: slot3(音频)回音响页, 其余回 LED 页 */
function pickReturnRoute(): string {
  return pickForSlot.value === 3 ? 'audio' : 'led';
}
function goBack(): void {
  if (pickForSlot.value) router.push({ name: pickReturnRoute() });
  else router.push({ name: 'dashboard' });
}

/** 挑选模式下点卡片: slot3 (背景音乐) 跳到播放器并加入播放列表; 其他 slot 直接推 */
async function pickAndPush(m: MediaItem): Promise<void> {
  const slot = pickForSlot.value;
  if (!slot) return;
  if (slot === 3) {
    // 背景音乐: 跳到音响页 BGM tab, 把歌加进播放列表
    router.push({
      name: 'audio',
      query: {
        tab: 'bgm',
        pick_id: String(m.id),
        pick_name: m.originalName,
        pick_dur: m.durationSec != null ? String(m.durationSec) : '',
      },
    });
    return;
  }
  try {
    await playbackStore.publish(slot, m.id, 'loop');
    ElMessage.success(`已推「${m.originalName}」到 ${pickModeLabel.value}`);
    router.push({ name: pickReturnRoute() });
  } catch (e) {
    ElMessage.error(`推送失败: ${(e as Error).message}`);
  }
}

const items = ref<MediaItem[]>([]);
const loading = ref(false);
const uploading = ref(false);
const uploadPct = ref(0);
const uploadName = ref('');
const uploadStartAt = ref(0);
const filter = ref<'all' | 'video' | 'image' | 'audio' | 'webpage'>('all');
const viewMode = ref<'list' | 'grid' | 'detail'>('list');
const previewItem = ref<MediaItem | null>(null);
const isDragging = ref(false);

// 批量上传队列
const uploadQueue = ref<File[]>([]);
const uploadBatchTotal = ref(0);
const uploadBatchDone = ref(0);
let processingQueue = false;

const filtered = computed(() => {
  if (filter.value === 'all') return items.value;
  return items.value.filter((m) => m.kind === filter.value);
});

const uploadEta = computed(() => {
  if (!uploading.value || uploadPct.value === 0 || !uploadStartAt.value) return '';
  const elapsedMs = Date.now() - uploadStartAt.value;
  const remainPct = 100 - uploadPct.value;
  if (remainPct <= 0) return '收尾...';
  const totalMs = elapsedMs / uploadPct.value * 100;
  const remainMs = totalMs - elapsedMs;
  if (remainMs < 60_000) return `剩约 ${Math.ceil(remainMs / 1000)}秒`;
  return `剩约 ${Math.ceil(remainMs / 60_000)}分钟`;
});

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDuration(sec: number | null): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const r = await mediaService.list();
    items.value = r.items;
  } catch (e) {
    ElMessage.error(`加载失败: ${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}

const UPLOAD_MAX_GB = 10;

// 扩展名兜底：Windows 对 .ape/.flac 等有时报 application/octet-stream
const AUDIO_EXTS = new Set([
  '.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac', '.wma',
  '.opus', '.aiff', '.aif', '.ape', '.mp2', '.mka', '.wv',
  '.mid', '.midi', '.spx', '.dsf', '.dff', '.au', '.ra',
]);
function isAllowedFile(f: File): boolean {
  if (f.type.startsWith('video/') || f.type.startsWith('image/') || f.type.startsWith('audio/')) return true;
  const dot = f.name.lastIndexOf('.');
  return dot >= 0 && AUDIO_EXTS.has(f.name.slice(dot).toLowerCase());
}

// 递归读取 FileSystemDirectoryReader (每次 readEntries 最多 100 条, 需循环)
async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const all: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])));
    all.push(...batch);
  } while (batch.length > 0);
  return all;
}

// 从单个 FileSystemEntry 递归收集所有 File 对象
async function collectFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise<File[]>((res) =>
      (entry as FileSystemFileEntry).file((f) => res([f]), () => res([])),
    );
  }
  if (entry.isDirectory) {
    const entries = await readAllEntries((entry as FileSystemDirectoryEntry).createReader());
    const nested = await Promise.all(entries.map(collectFromEntry));
    return nested.flat();
  }
  return [];
}

// 校验 + 入队 + 启动串行上传
async function queueFiles(rawFiles: File[]): Promise<void> {
  const valid: File[] = [];
  for (const f of rawFiles) {
    if (!isAllowedFile(f)) {
      if (f.size > 0) ElMessage.warning(`已跳过: ${f.name} (类型不支持)`);
      continue;
    }
    if (f.size > UPLOAD_MAX_GB * 1024 * 1024 * 1024) {
      ElMessage.error(`已跳过: ${f.name} (超过 ${UPLOAD_MAX_GB}GB 上限)`);
      continue;
    }
    valid.push(f);
  }
  if (valid.length === 0) return;

  // 单个大文件才弹确认
  if (valid.length === 1 && valid[0].size > 500 * 1024 * 1024) {
    const file = valid[0];
    const estMin = Math.ceil(file.size / (10 * 1024 * 1024) / 60);
    try {
      await ElMessageBox.confirm(
        `文件 ${file.name} (${fmtSize(file.size)}) 较大, 预估 ${estMin} 分钟. 上传期间请保持页面打开. 继续?`,
        '大文件上传',
        { type: 'info', confirmButtonText: '开始上传', cancelButtonText: '取消' },
      );
    } catch { return; }
  }

  const wasIdle = !processingQueue;
  uploadQueue.value.push(...valid);
  if (wasIdle) { uploadBatchTotal.value = valid.length; uploadBatchDone.value = 0; }
  else uploadBatchTotal.value += valid.length;

  if (wasIdle) void startQueue();
}

async function startQueue(): Promise<void> {
  processingQueue = true;
  while (uploadQueue.value.length > 0) {
    const file = uploadQueue.value[0];
    await doUploadOne(file);
    uploadQueue.value.shift();
    uploadBatchDone.value++;
  }
  processingQueue = false;
  uploadBatchTotal.value = 0;
  uploadBatchDone.value = 0;
}

async function doUploadOne(file: File): Promise<void> {
  uploading.value = true;
  uploadPct.value = 0;
  uploadName.value = file.name;
  uploadStartAt.value = Date.now();
  try {
    await mediaService.upload(file, { onProgress: (p) => { uploadPct.value = p; } });
    ElMessage.success(`上传成功: ${file.name}`);
    await refresh();
  } catch (e) {
    ElMessage.error(`上传失败 ${file.name}: ${(e as Error).message}`);
  } finally {
    uploading.value = false;
    uploadPct.value = 0;
    uploadName.value = '';
    uploadStartAt.value = 0;
  }
}

function onFileInput(e: Event): void {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    void queueFiles(Array.from(target.files));
    target.value = '';
  }
}

function onDragEnter(e: DragEvent): void {
  e.preventDefault();
  isDragging.value = true;
}
function onDragLeave(e: DragEvent): void {
  e.preventDefault();
  isDragging.value = false;
}
function onDragOver(e: DragEvent): void {
  e.preventDefault();
}
async function onDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  isDragging.value = false;

  // 优先用 DataTransferItem API — 支持文件夹递归
  const dtItems = e.dataTransfer?.items;
  if (dtItems && dtItems.length > 0) {
    const entries: FileSystemEntry[] = [];
    for (let i = 0; i < dtItems.length; i++) {
      const entry = dtItems[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      const files = (await Promise.all(entries.map(collectFromEntry))).flat();
      if (files.length > 0) { void queueFiles(files); return; }
    }
  }

  // 降级: 直接读 files (文件夹内容可能不完整)
  const files = Array.from(e.dataTransfer?.files ?? []);
  if (files.length > 0) void queueFiles(files);
}

async function confirmDelete(m: MediaItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除「${m.originalName}」?`, '删除媒体', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch { return; }
  try {
    await mediaService.remove(m.id);
    ElMessage.success(`已删除 ${m.originalName}`);
    items.value = items.value.filter((x) => x.id !== m.id);
    if (previewItem.value?.id === m.id) previewItem.value = null;
  } catch (e) {
    ElMessage.error(`删除失败: ${(e as Error).message}`);
  }
}

function openPreview(m: MediaItem): void {
  previewItem.value = m;
}
function closePreview(): void {
  previewItem.value = null;
}

/**
 * 推送到指定播控通道.
 * slot=1: HDMI1 → V2460 → LED 大屏
 * slot=2: HDMI2 → 投影仪
 * 同时推 both: 两个 slot 一起切到同一素材
 */
async function pushTo(m: MediaItem, slot: 1 | 2 | 'both', loopMode: 'once' | 'loop' = 'loop'): Promise<void> {
  try {
    if (slot === 'both') {
      await Promise.all([playbackStore.publish(1, m.id, loopMode), playbackStore.publish(2, m.id, loopMode)]);
      ElMessage.success(`已推「${m.originalName}」到 LED + 投影 (loop=${loopMode})`);
    } else {
      await playbackStore.publish(slot, m.id, loopMode);
      const slotName = slot === 1 ? 'LED 大屏' : '投影仪';
      ElMessage.success(`已推「${m.originalName}」到 ${slotName} (loop=${loopMode})`);
    }
  } catch (e) {
    ElMessage.error(`推送失败: ${(e as Error).message}`);
  }
}

/** 推送音频到背景音乐通道 (slot 3 → GK9000 声卡 → EKX), 默认循环 */
async function pushAudio(m: MediaItem): Promise<void> {
  try {
    await playbackStore.publish(3, m.id, 'loop');
    ElMessage.success(`已播放背景音乐「${m.originalName}」(循环)`);
  } catch (e) {
    ElMessage.error(`播放失败: ${(e as Error).message}`);
  }
}

// ── 添加网页 (作为可推送的"媒体") ──
const webpageDialog = ref(false);
const webpageForm = ref<{ name: string; url: string }>({ name: '', url: '' });
function openWebpageDialog(): void {
  webpageForm.value = { name: '', url: '' };
  webpageDialog.value = true;
}
async function submitWebpage(): Promise<void> {
  const url = webpageForm.value.url.trim();
  if (!/^https?:\/\//i.test(url)) { ElMessage.warning('网址要以 http:// 或 https:// 开头'); return; }
  try {
    const m = await mediaService.createWebpage(webpageForm.value.name.trim() || url, url);
    items.value.unshift(m);
    webpageDialog.value = false;
    ElMessage.success(`已添加网页「${m.originalName}」`);
  } catch (e) {
    ElMessage.error(`添加失败: ${(e as Error).message}`);
  }
}

// ── 收编服务器上手动拷进来的文件 (业主 RDP 进服务器直接把视频丢进 media 文件夹,
// 没走上传接口, 数据库不认识, PWA 自然看不到它 —— 媒体库从来只认数据库记录,
// 不扫盘。给一个"扫描"入口手动认领, 跟"从媒体库选"同一个原则: 不自动收编。) ──
const orphanDialog = ref(false);
const orphanScanning = ref(false);
const orphanImporting = ref<string | null>(null); // 正在导入哪个 relPath
const orphans = ref<OrphanMediaItem[]>([]);

async function openOrphanDialog(): Promise<void> {
  orphanDialog.value = true;
  await scanOrphans();
}
async function scanOrphans(): Promise<void> {
  orphanScanning.value = true;
  try {
    orphans.value = await mediaService.scanOrphans();
  } catch (e) {
    ElMessage.error(`扫描失败: ${(e as Error).message}`);
  } finally {
    orphanScanning.value = false;
  }
}
async function importOrphan(o: OrphanMediaItem): Promise<void> {
  orphanImporting.value = o.relPath;
  try {
    const m = await mediaService.importOrphan(o.relPath);
    items.value.unshift(m);
    orphans.value = orphans.value.filter((x) => x.relPath !== o.relPath);
    ElMessage.success(`「${o.name}」已收编到媒体库`);
  } catch (e) {
    ElMessage.error(`收编失败: ${(e as Error).message}`);
  } finally {
    orphanImporting.value = null;
  }
}

/** 查媒体当前是不是在某个 slot 上播 — 给卡片加角标用 */
function currentSlotFor(mediaId: number): string {
  const slots: string[] = [];
  if (playbackStore.slot1?.currentMediaId === mediaId) slots.push('LED');
  if (playbackStore.slot2?.currentMediaId === mediaId) slots.push('投影');
  return slots.join(' + ');
}

/** 是不是当前欢迎页 — 用来给卡片加"欢迎页"标记 */
const welcomeMediaId = computed<number | null>(() => brandingStore.branding.welcomeMediaId);
function isWelcome(m: MediaItem): boolean {
  return welcomeMediaId.value === m.id;
}

/** 设为欢迎页 — 写到 system-branding.welcomeMediaId, LED 欢迎页按钮后续就播这个 */
async function setAsWelcome(m: MediaItem): Promise<void> {
  try {
    await brandingStore.save({ welcomeMediaId: m.id });
    ElMessage.success(`已把「${m.originalName}」设为欢迎页, LED 点欢迎页就播这个`);
  } catch (e) {
    ElMessage.error(`设置失败: ${(e as Error).message}`);
  }
}

/** 取消欢迎页绑定 → LED 欢迎页按钮回落到 V2460 内置 preset (老逻辑) */
async function clearWelcome(): Promise<void> {
  try {
    await brandingStore.save({ welcomeMediaId: null });
    ElMessage.success('已取消欢迎页绑定, 后续 LED 欢迎页走控制器内置预设');
  } catch (e) {
    ElMessage.error(`取消失败: ${(e as Error).message}`);
  }
}

onMounted(async () => {
  await brandingStore.load();   // 拉 welcomeMediaId 用来标记当前欢迎页卡片
  void refresh();
});
</script>

<template>
  <section class="media-page">
    <!-- v2 page-head -->
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="goBack" title="返回首页">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title-block">
          <div class="title"><FolderOpen :size="18" :stroke-width="1.8" /> 媒体库</div>
        </div>
        <div class="v2-tabs">
          <button class="v2-tab" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
          <button class="v2-tab" :class="{ active: filter === 'video' }" @click="filter = 'video'">视频</button>
          <button class="v2-tab" :class="{ active: filter === 'image' }" @click="filter = 'image'">图片</button>
          <button class="v2-tab" :class="{ active: filter === 'audio' }" @click="filter = 'audio'">音频</button>
          <button class="v2-tab" :class="{ active: filter === 'webpage' }" @click="filter = 'webpage'">网页</button>
        </div>
      </div>
      <div class="quick-actions">
        <div class="view-toggle">
          <button class="vt-btn" :class="{ active: viewMode === 'list' }" title="列表" @click="viewMode = 'list'">
            <LayoutList :size="15" :stroke-width="2" />
          </button>
          <button class="vt-btn" :class="{ active: viewMode === 'grid' }" title="图标" @click="viewMode = 'grid'">
            <LayoutGrid :size="15" :stroke-width="2" />
          </button>
          <button class="vt-btn" :class="{ active: viewMode === 'detail' }" title="详情" @click="viewMode = 'detail'">
            <AlignJustify :size="15" :stroke-width="2" />
          </button>
        </div>
        <button class="v2-quick" :disabled="loading" @click="refresh">
          <RefreshCcw :size="14" :stroke-width="2" /> 刷新
        </button>
        <label class="v2-quick primary" :class="{ disabled: uploading }">
          <Upload :size="14" :stroke-width="2" />
          <span v-if="uploading">
            上传中 {{ uploadPct }}%<span v-if="uploadBatchTotal > 1" class="upload-count-inline"> ({{ uploadBatchDone + 1 }}/{{ uploadBatchTotal }})</span>
          </span>
          <span v-else>上传文件</span>
          <input type="file" accept="video/*,image/*,audio/*,.mp3,.wav,.aac,.m4a,.ogg,.flac,.wma,.opus,.aiff,.aif,.ape,.mp2,.mka,.wv,.mid,.midi,.spx,.dsf,.dff,.au,.ra" multiple :disabled="uploading" @change="onFileInput" hidden />
        </label>
        <label class="v2-quick" :class="{ disabled: uploading }">
          <FolderOpen :size="14" :stroke-width="2" /> 上传文件夹
          <input type="file" :webkitdirectory="true" multiple accept="video/*,image/*,audio/*,.mp3,.wav,.aac,.m4a,.ogg,.flac,.wma,.opus,.aiff,.aif,.ape,.mp2,.mka,.wv,.mid,.midi,.spx,.dsf,.dff,.au,.ra" :disabled="uploading" @change="onFileInput" hidden />
        </label>
        <button class="v2-quick" @click="openWebpageDialog">
          <Globe :size="14" :stroke-width="2" /> 添加网页
        </button>
        <button class="v2-quick" title="服务器上手动拷进 media 文件夹、还没进媒体库的文件" @click="openOrphanDialog">
          <RefreshCcw :size="14" :stroke-width="2" /> 扫描服务器新文件
        </button>
      </div>
    </header>

    <!-- pick 模式 banner: 提示当前是"为 XX 选媒体", 点取消回 LED 页 -->
    <div v-if="pickForSlot" class="pick-banner">
      <Send :size="16" :stroke-width="1.8" />
      <span class="pb-text">为 <b>{{ pickModeLabel }}</b> 挑选一个媒体, 点击就推送</span>
      <button class="pb-cancel" @click="router.push({ name: pickReturnRoute() })">取消</button>
    </div>

    <!-- 上传进度 (大文件含速率 + ETA) -->
    <div v-if="uploading" class="upload-bar">
      <div class="upload-name" :title="uploadName">{{ uploadName }}</div>
      <div class="upload-track">
        <div class="upload-fill" :style="{ width: uploadPct + '%' }"></div>
      </div>
      <div class="upload-meta">
        <span class="upload-pct">{{ uploadPct }}%</span>
        <span v-if="uploadEta" class="upload-eta">{{ uploadEta }}</span>
        <span v-if="uploadBatchTotal > 1" class="upload-batch">({{ uploadBatchDone + 1 }}/{{ uploadBatchTotal }})</span>
      </div>
    </div>

    <!-- 拖放区 + 网格 -->
    <div
      class="grid-wrap"
      :class="{ 'is-drag': isDragging }"
      @dragenter="onDragEnter"
      @dragleave="onDragLeave"
      @dragover="onDragOver"
      @drop="onDrop"
    >
      <div v-if="isDragging" class="drop-overlay">
        <Upload :size="48" :stroke-width="1.5" />
        <div class="drop-text">释放即上传（支持多文件 / 文件夹）</div>
      </div>

      <div v-if="!loading && filtered.length === 0" class="empty">
        <FolderOpen :size="42" :stroke-width="1.5" class="empty-icon" />
        <div class="empty-title">{{ items.length === 0 ? '媒体库为空' : '当前过滤无结果' }}</div>
        <div class="empty-sub">{{ items.length === 0 ? '把视频或图片拖进来, 或点右上 "上传文件"' : '换个过滤标签看看' }}</div>
      </div>

      <!-- ── 图标视图 ── -->
      <div v-if="viewMode === 'grid'" class="grid">
        <div
          v-for="m in filtered"
          :key="m.id"
          class="card"
          :class="{ 'pick-mode': pickForSlot }"
          @click="pickForSlot ? pickAndPush(m) : openPreview(m)"
        >
          <div class="thumb">
            <video v-if="m.kind === 'video'" :src="absUrl(m.fileUrl)" preload="metadata" muted playsinline />
            <div v-else-if="m.kind === 'audio'" class="audio-thumb"><Music :size="40" :stroke-width="1.5" /></div>
            <div v-else-if="m.kind === 'webpage'" class="web-thumb"><Globe :size="40" :stroke-width="1.5" /></div>
            <img v-else :src="absUrl(m.fileUrl)" :alt="m.originalName" />
            <span class="kind-tag" :class="m.kind">
              <Film v-if="m.kind === 'video'" :size="11" :stroke-width="2" />
              <Music v-else-if="m.kind === 'audio'" :size="11" :stroke-width="2" />
              <Globe v-else-if="m.kind === 'webpage'" :size="11" :stroke-width="2" />
              <ImageIcon v-else :size="11" :stroke-width="2" />
              {{ m.kind === 'video' ? '视频' : m.kind === 'audio' ? '音频' : m.kind === 'webpage' ? '网页' : '图片' }}
            </span>
            <span v-if="m.kind === 'video'" class="duration">{{ fmtDuration(m.durationSec) || '—' }}</span>
          </div>
          <div class="meta">
            <div class="name" :title="m.originalName">{{ m.originalName }}</div>
            <div class="info"><span>{{ fmtSize(m.sizeBytes) }}</span><span v-if="m.resolution">· {{ m.resolution }}</span></div>
          </div>
          <div v-if="isWelcome(m)" class="welcome-tag" title="当前欢迎页"><Home :size="11" :stroke-width="2" /> 欢迎页</div>
          <div v-if="currentSlotFor(m.id)" class="playing-tag" :style="isWelcome(m) ? 'top: 36px;' : ''">
            <Send :size="11" :stroke-width="2" /> 播放中: {{ currentSlotFor(m.id) }}
          </div>
          <div class="card-actions" @click.stop>
            <button v-if="m.kind === 'audio'" class="card-btn" title="播放背景音乐" @click="pushAudio(m)"><Music :size="14" :stroke-width="2" /></button>
            <el-dropdown v-else trigger="click" @command="(c: number | string) => { if (c === 'welcome') setAsWelcome(m); else pushTo(m, c as 1 | 2 | 'both'); }">
              <button class="card-btn" title="推送到"><Send :size="14" :stroke-width="2" /></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :command="1">推到 LED 大屏 (HDMI1)</el-dropdown-item>
                  <el-dropdown-item :command="2">推到投影仪 (HDMI2)</el-dropdown-item>
                  <el-dropdown-item :command="'both'" divided>同时推两路</el-dropdown-item>
                  <el-dropdown-item v-if="m.kind !== 'webpage'" :command="'welcome'" divided :disabled="isWelcome(m)">{{ isWelcome(m) ? '✓ 已是欢迎页' : '设为欢迎页' }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <button class="card-btn danger" title="删除" @click="confirmDelete(m)"><Trash2 :size="14" :stroke-width="2" /></button>
          </div>
        </div>
      </div>

      <!-- ── 列表视图 ── -->
      <div v-else-if="viewMode === 'list'" class="list-view">
        <div
          v-for="m in filtered"
          :key="m.id"
          class="list-row"
          :class="{ 'pick-mode': pickForSlot }"
          @click="pickForSlot ? pickAndPush(m) : openPreview(m)"
        >
          <div class="lr-thumb">
            <video v-if="m.kind === 'video'" :src="absUrl(m.fileUrl)" preload="metadata" muted playsinline />
            <div v-else-if="m.kind === 'audio'" class="lr-icon"><Music :size="18" :stroke-width="1.5" /></div>
            <div v-else-if="m.kind === 'webpage'" class="lr-icon web"><Globe :size="18" :stroke-width="1.5" /></div>
            <img v-else :src="absUrl(m.fileUrl)" :alt="m.originalName" />
          </div>
          <span class="kind-tag" :class="m.kind">
            <Film v-if="m.kind === 'video'" :size="11" :stroke-width="2" />
            <Music v-else-if="m.kind === 'audio'" :size="11" :stroke-width="2" />
            <Globe v-else-if="m.kind === 'webpage'" :size="11" :stroke-width="2" />
            <ImageIcon v-else :size="11" :stroke-width="2" />
            {{ m.kind === 'video' ? '视频' : m.kind === 'audio' ? '音频' : m.kind === 'webpage' ? '网页' : '图片' }}
          </span>
          <div class="lr-name" :title="m.originalName">{{ m.originalName }}</div>
          <div class="lr-badges">
            <span v-if="isWelcome(m)" class="lr-badge welcome"><Home :size="10" :stroke-width="2" /> 欢迎页</span>
            <span v-if="currentSlotFor(m.id)" class="lr-badge playing"><Send :size="10" :stroke-width="2" /> {{ currentSlotFor(m.id) }}</span>
          </div>
          <div class="lr-size">{{ fmtSize(m.sizeBytes) }}<span v-if="m.resolution" class="lr-res"> · {{ m.resolution }}</span></div>
          <div class="lr-date">{{ new Date(m.createdAt).toLocaleDateString('zh-CN') }}</div>
          <div class="lr-actions" @click.stop>
            <button v-if="m.kind === 'audio'" class="card-btn" title="播放背景音乐" @click="pushAudio(m)"><Music :size="14" :stroke-width="2" /></button>
            <el-dropdown v-else trigger="click" @command="(c: number | string) => { if (c === 'welcome') setAsWelcome(m); else pushTo(m, c as 1 | 2 | 'both'); }">
              <button class="card-btn" title="推送到"><Send :size="14" :stroke-width="2" /></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :command="1">推到 LED 大屏 (HDMI1)</el-dropdown-item>
                  <el-dropdown-item :command="2">推到投影仪 (HDMI2)</el-dropdown-item>
                  <el-dropdown-item :command="'both'" divided>同时推两路</el-dropdown-item>
                  <el-dropdown-item v-if="m.kind !== 'webpage'" :command="'welcome'" divided :disabled="isWelcome(m)">{{ isWelcome(m) ? '✓ 已是欢迎页' : '设为欢迎页' }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <button class="card-btn danger" title="删除" @click="confirmDelete(m)"><Trash2 :size="14" :stroke-width="2" /></button>
          </div>
        </div>
      </div>

      <!-- ── 详情视图 ── -->
      <div v-else class="detail-view">
        <div class="dv-head">
          <div class="dv-col dv-c-thumb"></div>
          <div class="dv-col dv-c-name">文件名</div>
          <div class="dv-col dv-c-kind">类型</div>
          <div class="dv-col dv-c-size">大小</div>
          <div class="dv-col dv-c-res">分辨率</div>
          <div class="dv-col dv-c-dur">时长</div>
          <div class="dv-col dv-c-date">上传时间</div>
          <div class="dv-col dv-c-act"></div>
        </div>
        <div
          v-for="m in filtered"
          :key="m.id"
          class="dv-row"
          :class="{ 'pick-mode': pickForSlot }"
          @click="pickForSlot ? pickAndPush(m) : openPreview(m)"
        >
          <div class="dv-col dv-c-thumb">
            <div class="dv-tw">
              <video v-if="m.kind === 'video'" :src="absUrl(m.fileUrl)" preload="metadata" muted playsinline />
              <img v-else-if="m.kind === 'image'" :src="absUrl(m.fileUrl)" :alt="m.originalName" />
              <div v-else-if="m.kind === 'audio'" class="dv-ico"><Music :size="14" :stroke-width="1.5" /></div>
              <div v-else class="dv-ico web"><Globe :size="14" :stroke-width="1.5" /></div>
            </div>
            <span v-if="isWelcome(m)" class="dv-badge welcome" title="欢迎页"><Home :size="9" /></span>
            <span v-if="currentSlotFor(m.id)" class="dv-badge playing" title="播放中"><Send :size="9" /></span>
          </div>
          <div class="dv-col dv-c-name" :title="m.originalName">{{ m.originalName }}</div>
          <div class="dv-col dv-c-kind">
            <span class="kind-tag" :class="m.kind">
              {{ m.kind === 'video' ? '视频' : m.kind === 'audio' ? '音频' : m.kind === 'webpage' ? '网页' : '图片' }}
            </span>
          </div>
          <div class="dv-col dv-c-size">{{ fmtSize(m.sizeBytes) }}</div>
          <div class="dv-col dv-c-res">{{ m.resolution || '—' }}</div>
          <div class="dv-col dv-c-dur">{{ m.durationSec ? fmtDuration(m.durationSec) : '—' }}</div>
          <div class="dv-col dv-c-date">{{ new Date(m.createdAt).toLocaleString('zh-CN') }}</div>
          <div class="dv-col dv-c-act" @click.stop>
            <button v-if="m.kind === 'audio'" class="card-btn" title="播放背景音乐" @click="pushAudio(m)"><Music :size="14" :stroke-width="2" /></button>
            <el-dropdown v-else trigger="click" @command="(c: number | string) => { if (c === 'welcome') setAsWelcome(m); else pushTo(m, c as 1 | 2 | 'both'); }">
              <button class="card-btn" title="推送到"><Send :size="14" :stroke-width="2" /></button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :command="1">推到 LED 大屏 (HDMI1)</el-dropdown-item>
                  <el-dropdown-item :command="2">推到投影仪 (HDMI2)</el-dropdown-item>
                  <el-dropdown-item :command="'both'" divided>同时推两路</el-dropdown-item>
                  <el-dropdown-item v-if="m.kind !== 'webpage'" :command="'welcome'" divided :disabled="isWelcome(m)">{{ isWelcome(m) ? '✓ 已是欢迎页' : '设为欢迎页' }}</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
            <button class="card-btn danger" title="删除" @click="confirmDelete(m)"><Trash2 :size="14" :stroke-width="2" /></button>
          </div>
        </div>
      </div>
    </div>

    <!-- 添加网页 dialog -->
    <div v-if="webpageDialog" class="preview-mask" @click.self="webpageDialog = false">
      <div class="webpage-box">
        <div class="wb-title"><Globe :size="18" :stroke-width="1.8" /> 添加网页</div>
        <div class="wb-hint">网页会进媒体库，可像视频/图片一样推到 LED 大屏 / 投影显示</div>
        <label class="wb-label">名称</label>
        <input v-model="webpageForm.name" class="wb-input" placeholder="如 公司官网 / 活动大屏 H5" />
        <label class="wb-label">网址</label>
        <input v-model="webpageForm.url" class="wb-input" placeholder="https://..." @keyup.enter="submitWebpage" />
        <div class="wb-actions">
          <button class="v2-quick" @click="webpageDialog = false">取消</button>
          <button class="v2-quick primary" @click="submitWebpage">添加</button>
        </div>
      </div>
    </div>

    <!-- 扫描服务器新文件 dialog -->
    <div v-if="orphanDialog" class="preview-mask" @click.self="orphanDialog = false">
      <div class="webpage-box orphan-box">
        <div class="wb-title"><RefreshCcw :size="18" :stroke-width="1.8" /> 扫描服务器新文件</div>
        <div class="wb-hint">
          直接拷进服务器 media 文件夹、没走上传接口的文件, 数据库不认识它们, 所以 PWA 之前看不到。
          点"收编"逐个正式加入媒体库 (不会自动导入, 需要你确认)。
        </div>

        <div v-if="orphanScanning" class="orphan-empty">扫描中…</div>
        <div v-else-if="orphans.length === 0" class="orphan-empty">没发现数据库不认识的文件</div>
        <div v-else class="orphan-list">
          <div v-for="o in orphans" :key="o.relPath" class="orphan-item">
            <component :is="o.kind === 'video' ? Film : o.kind === 'audio' ? Music : o.kind === 'image' ? ImageIcon : X" :size="16" :stroke-width="1.8" />
            <span class="orphan-name" :title="o.relPath">{{ o.name }}</span>
            <span class="orphan-size">{{ fmtSize(o.sizeBytes) }}</span>
            <span v-if="!o.kind" class="orphan-unknown">扩展名不认识, 需重命名后重新扫描</span>
            <button
              v-else class="v2-quick primary orphan-import-btn"
              :disabled="orphanImporting === o.relPath"
              @click="importOrphan(o)"
            >{{ orphanImporting === o.relPath ? '收编中…' : '收编' }}</button>
          </div>
        </div>

        <div class="wb-actions">
          <button class="v2-quick" :disabled="orphanScanning" @click="scanOrphans">
            <RefreshCcw :size="14" :stroke-width="2" /> 重新扫描
          </button>
          <button class="v2-quick" @click="orphanDialog = false">关闭</button>
        </div>
      </div>
    </div>

    <!-- 预览弹层 -->
    <div v-if="previewItem" class="preview-mask" @click.self="closePreview">
      <div class="preview-box">
        <button class="preview-close" @click="closePreview"><X :size="20" :stroke-width="2" /></button>
        <div class="preview-media">
          <video v-if="previewItem.kind === 'video'" :src="absUrl(previewItem.fileUrl)" controls autoplay style="max-width:100%; max-height: 70vh;" />
          <div v-else-if="previewItem.kind === 'audio'" class="audio-preview">
            <Music :size="64" :stroke-width="1.4" />
            <audio :src="absUrl(previewItem.fileUrl)" controls autoplay style="width: 320px; max-width: 80vw;" />
          </div>
          <div v-else-if="previewItem.kind === 'webpage'" class="audio-preview">
            <Globe :size="64" :stroke-width="1.4" />
            <a :href="previewItem.fileUrl" target="_blank" rel="noopener" class="web-url">{{ previewItem.fileUrl }}</a>
          </div>
          <img v-else :src="absUrl(previewItem.fileUrl)" :alt="previewItem.originalName" style="max-width:100%; max-height: 70vh;" />
        </div>
        <div class="preview-info">
          <h3>{{ previewItem.originalName }}</h3>
          <div class="meta-row">
            <span class="kind-tag" :class="previewItem.kind">
              {{ previewItem.kind === 'video' ? '视频' : previewItem.kind === 'audio' ? '音频' : '图片' }}
            </span>
            <span>{{ fmtSize(previewItem.sizeBytes) }}</span>
            <span v-if="previewItem.resolution">{{ previewItem.resolution }}</span>
            <span v-if="previewItem.durationSec">{{ fmtDuration(previewItem.durationSec) }}</span>
            <span>{{ new Date(previewItem.createdAt).toLocaleString('zh-CN') }}</span>
          </div>
          <div v-if="previewItem.remark" class="remark">{{ previewItem.remark }}</div>
          <!-- 音频: 播放背景音乐 -->
          <div v-if="previewItem.kind === 'audio'" class="preview-actions">
            <button class="v2-quick primary" @click="pushAudio(previewItem)">
              <Music :size="14" :stroke-width="2" /> 播放背景音乐 (→ 音响, 循环)
            </button>
            <button class="v2-quick danger" @click="confirmDelete(previewItem)">
              <Trash2 :size="14" :stroke-width="2" /> 删除
            </button>
          </div>
          <!-- 视频/图片: 推 LED/投影/欢迎页 -->
          <div v-else class="preview-actions">
            <button class="v2-quick primary" @click="pushTo(previewItem, 1)">
              <Send :size="14" :stroke-width="2" /> 推到 LED 大屏 (HDMI1)
            </button>
            <button class="v2-quick primary" @click="pushTo(previewItem, 2)">
              <Send :size="14" :stroke-width="2" /> 推到投影仪 (HDMI2)
            </button>
            <button class="v2-quick" @click="pushTo(previewItem, 'both')">
              <Send :size="14" :stroke-width="2" /> 同时推两路
            </button>
            <button
              class="v2-quick"
              :disabled="isWelcome(previewItem)"
              :title="isWelcome(previewItem) ? '已是欢迎页, 点 LED 欢迎页按钮就播这个' : '点 LED 欢迎页按钮时就播这个'"
              @click="setAsWelcome(previewItem)"
            >
              <Home :size="14" :stroke-width="2" /> {{ isWelcome(previewItem) ? '✓ 已是欢迎页' : '设为欢迎页' }}
            </button>
            <button v-if="isWelcome(previewItem)" class="v2-quick" @click="clearWelcome">
              取消欢迎页
            </button>
            <button class="v2-quick danger" @click="confirmDelete(previewItem)">
              <Trash2 :size="14" :stroke-width="2" /> 删除
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.media-page {
  padding: var(--v2-sp-5);
  display: flex; flex-direction: column; gap: var(--v2-sp-4);
  height: 100%; min-height: 0;
}

/* v2 page head */
.v2-page-head { display: flex; justify-content: space-between; align-items: center; gap: var(--v2-sp-4); flex-wrap: wrap; }
.back-row { display: flex; align-items: center; gap: var(--v2-sp-4); }
.v2-back-btn {
  width: 36px; height: 36px; border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center; cursor: pointer; color: var(--v2-text-2);
  transition: all 0.18s ease;
}
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.title-block { display: flex; flex-direction: column; }
.title { font-size: 15px; font-weight: 600; color: var(--v2-text-1); display: inline-flex; align-items: center; gap: var(--v2-sp-2); }
.sub { font-size: var(--v2-fs-xs); color: var(--v2-text-3); margin-top: 2px; }

.v2-tabs {
  display: inline-flex;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm); padding: 3px;
  margin-left: var(--v2-sp-3);
}
.v2-tab {
  padding: 5px 14px; border-radius: 6px;
  font-size: var(--v2-fs-sm); color: var(--v2-text-2);
  cursor: pointer; background: transparent; border: none;
  transition: all 0.18s ease;
}
.v2-tab.active {
  background: var(--v2-primary-soft); color: var(--v2-primary);
  box-shadow: 0 0 0 1px rgba(76, 154, 255, 0.2);
}

.quick-actions { display: flex; gap: var(--v2-sp-2); }
.v2-quick {
  padding: 8px 14px; border-radius: var(--v2-r-sm); font-size: var(--v2-fs-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: all 0.18s ease; min-height: 36px;
}
.v2-quick:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.v2-quick.primary {
  background: var(--v2-primary-soft); color: var(--v2-primary);
  border-color: rgba(76, 154, 255, 0.3);
}
.v2-quick.danger {
  background: rgba(229, 100, 93, 0.1); color: var(--v2-danger);
  border-color: rgba(229, 100, 93, 0.3);
}
.v2-quick.disabled { opacity: 0.6; cursor: progress; }
.v2-quick:disabled { opacity: 0.6; cursor: not-allowed; }
.v2-tab:hover { color: var(--v2-text-1); }

.upload-bar { display: grid; grid-template-columns: 1fr 1fr auto; align-items: center; gap: 12px; padding: 8px 14px; background: rgba(76, 154, 255, 0.1); border: 1px solid rgba(76, 154, 255, 0.3); border-radius: 10px; font-size: 12px; }
.upload-name { color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.upload-track { height: 6px; background: rgba(15, 23, 42, 0.5); border-radius: 3px; overflow: hidden; }
.upload-fill { height: 100%; background: linear-gradient(90deg, #06b6d4 0%, #9BA1A9 100%); transition: width 0.2s; box-shadow: 0 0 8px rgba(76, 154, 255, 0.6); }
.upload-meta { display: flex; align-items: center; gap: 10px; }
.upload-pct { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #06b6d4; font-weight: 600; }
.upload-eta { font-size: 11px; color: var(--text-secondary); font-family: 'JetBrains Mono', ui-monospace, monospace; }
.upload-batch { font-size: 11px; color: #a78bfa; font-family: 'JetBrains Mono', ui-monospace, monospace; font-weight: 600; }
.upload-count-inline { font-size: 11px; opacity: 0.8; }

.grid-wrap { position: relative; flex: 1; min-height: 0; overflow: auto; padding: 4px; border-radius: 12px; }
.grid-wrap.is-drag { background: rgba(76, 154, 255, 0.08); outline: 2px dashed rgba(76, 154, 255, 0.5); outline-offset: -2px; }
.drop-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: rgba(15, 23, 42, 0.6); color: #06b6d4; z-index: 5; backdrop-filter: blur(4px); pointer-events: none; border-radius: 12px; }
.drop-text { font-size: 18px; font-weight: 600; letter-spacing: 2px; }

.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: var(--text-secondary); gap: 8px; }
.empty-icon { color: var(--text-muted); }
.empty-title { font-size: 15px; color: var(--text-primary); font-weight: 600; }
.empty-sub { font-size: 12px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }

.card { position: relative; background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), transparent), rgba(15, 23, 42, 0.55); border: 1px solid var(--border-soft); border-radius: 12px; overflow: hidden; cursor: pointer; transition: all 0.18s; }
.card:hover { transform: translateY(-2px); border-color: rgba(76, 154, 255, 0.55); box-shadow: 0 10px 24px -8px rgba(76, 154, 255, 0.35); }
.card.pick-mode { cursor: pointer; }
.card.pick-mode:hover { border-color: var(--v2-primary); box-shadow: 0 12px 30px -10px rgba(76, 154, 255, 0.55), inset 0 0 0 1px var(--v2-primary); }
.card.pick-mode:hover::after {
  content: '点击直接推送';
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--v2-primary);
  color: white;
  padding: 5px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  pointer-events: none;
  box-shadow: 0 6px 16px -4px rgba(76, 154, 255, 0.5);
  z-index: 3;
}

/* Pick 模式 banner */
.pick-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(90deg, rgba(76, 154, 255, 0.18), rgba(76, 154, 255, 0.06));
  border: 1px solid rgba(76, 154, 255, 0.4);
  border-radius: var(--v2-r-md);
  color: var(--v2-text-1);
  font-size: 14px;
}
.pick-banner .pb-text { flex: 1; }
.pick-banner b { color: var(--v2-primary-hover); font-weight: 600; margin: 0 2px; }
.pick-banner .pb-cancel {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2);
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.pick-banner .pb-cancel:hover { background: rgba(255, 255, 255, 0.14); color: var(--v2-text-1); }
.thumb { position: relative; aspect-ratio: 16/10; background: #0b1220; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.thumb video, .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.audio-thumb { width: 100%; height: 100%; display: grid; place-items: center; color: #c4b5fd;
  background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.08), transparent 70%), #0b1220; }
.kind-tag { position: absolute; top: 8px; left: 8px; display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; font-size: 10px; font-weight: 600; border-radius: 999px; backdrop-filter: blur(6px); }
.kind-tag.video { background: rgba(255, 255, 255, 0.08); color: #f3e8ff; border: 1px solid rgba(255, 255, 255, 0.08); }
.kind-tag.image { background: rgba(76, 154, 255, 0.4); color: #cffafe; border: 1px solid rgba(76, 154, 255, 0.6); }
.kind-tag.audio { background: rgba(224, 160, 48, 0.4); color: #fef3c7; border: 1px solid rgba(224, 160, 48, 0.6); }
.kind-tag.webpage { background: rgba(34, 211, 238, 0.4); color: #cffafe; border: 1px solid rgba(34, 211, 238, 0.6); }
.web-thumb { width: 100%; height: 100%; display: grid; place-items: center; color: #22d3ee; background: linear-gradient(135deg, rgba(34,211,238,0.12), rgba(255, 255, 255, 0.08)); }
.audio-preview { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 30px 20px; color: #c4b5fd; }
.duration { position: absolute; bottom: 8px; right: 8px; padding: 2px 7px; font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; background: rgba(0, 0, 0, 0.6); color: #fff; border-radius: 4px; backdrop-filter: blur(4px); }
.meta { padding: 8px 12px; }
.name { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.info { font-size: 11px; color: var(--text-secondary); margin-top: 3px; display: flex; gap: 4px; }

.card-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; opacity: 0; transition: opacity 0.18s; }
.card:hover .card-actions { opacity: 1; }
.playing-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(76, 154, 255, 0.85);
  color: white;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  box-shadow: 0 4px 10px -2px rgba(76, 154, 255, 0.4);
  z-index: 2;
}
.welcome-tag {
  position: absolute;
  top: 8px;
  left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #E0A030, #d97706);
  color: white;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  box-shadow: 0 4px 10px -2px rgba(224, 160, 48, 0.5);
  z-index: 2;
}
.card-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.8); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; cursor: pointer; backdrop-filter: blur(6px); transition: all 0.15s; }
.card-btn:hover { background: rgba(76, 154, 255, 0.5); border-color: rgba(76, 154, 255, 0.8); }
.card-btn.danger:hover { background: rgba(229, 100, 93, 0.5); border-color: rgba(229, 100, 93, 0.8); }

/* 预览弹层 */
.preview-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
.webpage-box { background: #1B2034; border: 1px solid var(--v2-border-soft); border-radius: 14px; padding: 22px; width: min(440px, 90vw); display: flex; flex-direction: column; gap: 6px; }
.wb-title { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; color: var(--v2-text-1); }
.wb-hint { font-size: 12px; color: var(--v2-text-3); margin-bottom: 8px; }
.wb-label { font-size: 12px; color: var(--v2-text-3); margin-top: 6px; }
.wb-input { background: rgba(255,255,255,0.04); border: 1px solid var(--v2-border-soft); border-radius: 8px; padding: 10px 12px; color: var(--v2-text-1); font-size: 14px; outline: none; font-family: inherit; }
.wb-input:focus { border-color: var(--v2-primary); }
.wb-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 14px; }

.orphan-box { width: min(560px, 90vw); max-height: 80vh; }
.orphan-empty { padding: 20px; text-align: center; font-size: 13px; color: var(--v2-text-3); }
.orphan-list { display: flex; flex-direction: column; gap: 6px; max-height: 46vh; overflow-y: auto; margin-top: 6px; }
.orphan-item {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 10px; border-radius: 9px;
  background: rgba(255,255,255,0.04); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2);
}
.orphan-name { flex: 1 1 auto; min-width: 0; font-size: 13px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.orphan-size { flex: 0 0 auto; font-size: 12px; color: var(--v2-text-3); }
.orphan-unknown { flex: 0 0 auto; font-size: 12px; color: #E0A030; }
.orphan-import-btn { flex: 0 0 auto; }
.web-url { color: #22d3ee; word-break: break-all; text-align: center; font-size: 14px; text-decoration: none; }
.preview-box { position: relative; max-width: 90vw; max-height: 90vh; background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 14px; overflow: auto; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); }
.preview-close { position: absolute; top: 12px; right: 12px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.6); color: #fff; border: 1px solid var(--border-soft); border-radius: 8px; cursor: pointer; z-index: 5; }
.preview-close:hover { background: rgba(229, 100, 93, 0.3); border-color: rgba(229, 100, 93, 0.5); }
.preview-media { display: flex; align-items: center; justify-content: center; background: #000; border-radius: 10px; padding: 4px; }
.preview-info h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; color: var(--text-primary); }
.meta-row { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--text-secondary); }
.remark { padding: 8px 12px; background: rgba(255, 255, 255, 0.08); border-radius: 6px; font-size: 13px; color: var(--text-primary); }
.preview-actions { display: flex; gap: 8px; margin-top: 6px; }

@media (max-width: 1100px) {
  .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}

/* ── 视图切换按钮组 ── */
.view-toggle {
  display: inline-flex;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
  padding: 3px;
  gap: 2px;
}
.vt-btn {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  border: none; border-radius: 5px;
  background: transparent;
  color: var(--v2-text-3);
  cursor: pointer;
  transition: all 0.15s ease;
}
.vt-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.vt-btn.active { background: var(--v2-primary-soft); color: var(--v2-primary); }

/* ── 列表视图 ── */
.list-view { display: flex; flex-direction: column; gap: 3px; }
.list-row {
  display: grid;
  grid-template-columns: 80px auto 1fr auto auto auto auto;
  align-items: center;
  gap: 10px;
  padding: 0 10px 0 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.05), transparent), rgba(15,23,42,0.5);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  min-height: 52px;
}
.list-row:hover { border-color: rgba(76, 154, 255, 0.5); background: rgba(15,23,42,0.7); }
.list-row.pick-mode:hover { border-color: var(--v2-primary); }
.lr-thumb {
  width: 80px; height: 50px; flex-shrink: 0;
  overflow: hidden; background: #0b1220; border-radius: 8px 0 0 8px;
  display: flex; align-items: center; justify-content: center;
}
.lr-thumb video, .lr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.lr-icon { width: 100%; height: 100%; display: grid; place-items: center; color: #c4b5fd;
  background: radial-gradient(ellipse at center, rgba(255, 255, 255, 0.08), transparent 70%); }
.lr-icon.web { color: #22d3ee; background: radial-gradient(ellipse at center, rgba(34,211,238,0.18), transparent 70%); }
.list-row .kind-tag { position: static; flex-shrink: 0; }
.lr-name { font-size: 13px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lr-badges { display: flex; gap: 4px; flex-shrink: 0; }
.lr-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 999px; font-size: 10px; font-weight: 500; }
.lr-badge.welcome { background: linear-gradient(135deg, #E0A030, #d97706); color: white; }
.lr-badge.playing { background: rgba(76, 154, 255, 0.85); color: white; }
.lr-size { font-size: 12px; color: var(--text-secondary); white-space: nowrap; flex-shrink: 0; }
.lr-res { color: var(--v2-text-3); }
.lr-date { font-size: 11px; color: var(--v2-text-3); white-space: nowrap; flex-shrink: 0; }
.lr-actions { display: flex; gap: 4px; flex-shrink: 0; }

/* ── 详情视图 ── */
.detail-view { display: flex; flex-direction: column; gap: 2px; }
.dv-head, .dv-row {
  display: grid;
  grid-template-columns: 72px 1fr 56px 70px 80px 52px 120px 70px;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 0;
}
.dv-head {
  padding: 6px 10px 6px 4px;
  font-size: 11px; color: var(--v2-text-3); font-weight: 500;
  letter-spacing: 0.5px; border-bottom: 1px solid var(--v2-border-soft);
  position: sticky; top: 0; background: rgba(10,15,28,0.95); z-index: 1;
}
.dv-row {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.04), transparent), rgba(15,23,42,0.45);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  min-height: 48px;
}
.dv-row:hover { border-color: rgba(76, 154, 255, 0.5); background: rgba(15,23,42,0.65); }
.dv-row.pick-mode:hover { border-color: var(--v2-primary); }
.dv-col { overflow: hidden; }
.dv-c-thumb { position: relative; display: flex; align-items: center; }
.dv-tw {
  width: 72px; height: 46px;
  overflow: hidden; background: #0b1220;
  display: flex; align-items: center; justify-content: center;
}
.dv-tw video, .dv-tw img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dv-ico { width: 100%; height: 100%; display: grid; place-items: center; color: #c4b5fd; }
.dv-ico.web { color: #22d3ee; }
.dv-badge { position: absolute; top: 2px; right: 2px; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; font-size: 9px; }
.dv-badge.welcome { background: #E0A030; color: white; top: 2px; }
.dv-badge.playing { background: rgba(76, 154, 255, 0.9); color: white; top: 20px; }
.dv-c-name { font-size: 13px; font-weight: 500; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding-left: 4px; }
.dv-c-kind .kind-tag { position: static; }
.dv-c-size { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.dv-c-res { font-size: 12px; color: var(--v2-text-3); white-space: nowrap; }
.dv-c-dur { font-size: 12px; color: var(--v2-text-3); font-family: 'JetBrains Mono', ui-monospace, monospace; white-space: nowrap; }
.dv-c-date { font-size: 11px; color: var(--v2-text-3); white-space: nowrap; }
.dv-c-act { display: flex; gap: 4px; justify-content: flex-end; }
</style>
