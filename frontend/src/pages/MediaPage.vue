<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  Upload,
  Trash2,
  Film,
  Image as ImageIcon,
  X,
  FolderOpen,
  RefreshCcw,
  Send,
  ArrowLeft,
} from 'lucide-vue-next';
import { mediaService, type MediaItem } from '@/services/media.service';

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }

const items = ref<MediaItem[]>([]);
const loading = ref(false);
const uploading = ref(false);
const uploadPct = ref(0);
const uploadName = ref('');
const uploadStartAt = ref(0);
const filter = ref<'all' | 'video' | 'image'>('all');
const previewItem = ref<MediaItem | null>(null);
const isDragging = ref(false);

const filtered = computed(() => {
  if (filter.value === 'all') return items.value;
  return items.value.filter((m) => m.kind === filter.value);
});

const stats = computed(() => {
  const v = items.value.filter((m) => m.kind === 'video').length;
  const i = items.value.filter((m) => m.kind === 'image').length;
  const totalBytes = items.value.reduce((s, m) => s + m.sizeBytes, 0);
  return { v, i, totalBytes };
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

async function doUpload(file: File): Promise<void> {
  if (uploading.value) {
    ElMessage.warning('正在上传, 请等待当前任务完成');
    return;
  }
  if (file.size > UPLOAD_MAX_GB * 1024 * 1024 * 1024) {
    ElMessage.error(`文件超过 ${UPLOAD_MAX_GB}GB 上限 (现 ${fmtSize(file.size)})`);
    return;
  }
  if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
    ElMessage.error(`不支持的文件类型: ${file.type}`);
    return;
  }
  // 大文件友好提示 (>500MB)
  if (file.size > 500 * 1024 * 1024) {
    const sizeStr = fmtSize(file.size);
    const estMin = Math.ceil(file.size / (10 * 1024 * 1024) / 60); // 估 80Mbps 实际
    try {
      await ElMessageBox.confirm(
        `文件 ${file.name} (${sizeStr}) 是大文件, 预估 ${estMin} 分钟左右上传完成 (实际取决于网速). 上传期间请保持页面打开. 继续?`,
        '大文件上传',
        { type: 'info', confirmButtonText: '开始上传', cancelButtonText: '取消' },
      );
    } catch { return; }
  }
  uploading.value = true;
  uploadPct.value = 0;
  uploadName.value = file.name;
  uploadStartAt.value = Date.now();
  try {
    await mediaService.upload(file, {
      onProgress: (p) => { uploadPct.value = p; },
    });
    ElMessage.success(`上传成功: ${file.name}`);
    await refresh();
  } catch (e) {
    ElMessage.error(`上传失败: ${(e as Error).message}`);
  } finally {
    uploading.value = false;
    uploadPct.value = 0;
    uploadName.value = '';
    uploadStartAt.value = 0;
  }
}

function onFileInput(e: Event): void {
  const target = e.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    void doUpload(target.files[0]);
    target.value = ''; // 允许重选同名
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
function onDrop(e: DragEvent): void {
  e.preventDefault();
  isDragging.value = false;
  const f = e.dataTransfer?.files?.[0];
  if (f) void doUpload(f);
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

async function pushToScreen(m: MediaItem): Promise<void> {
  try {
    const r = await mediaService.publish(m.id);
    ElMessage.success(`已推送「${m.originalName}」到大屏 (${r.player})`);
  } catch (e) {
    ElMessage.error(`推送失败: ${(e as Error).message}`);
  }
}

onMounted(() => { void refresh(); });
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
          <div class="sub">视频 {{ stats.v }} · 图片 {{ stats.i }} · 占 {{ fmtSize(stats.totalBytes) }}</div>
        </div>
        <div class="v2-tabs">
          <button class="v2-tab" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
          <button class="v2-tab" :class="{ active: filter === 'video' }" @click="filter = 'video'">视频</button>
          <button class="v2-tab" :class="{ active: filter === 'image' }" @click="filter = 'image'">图片</button>
        </div>
      </div>
      <div class="quick-actions">
        <button class="v2-quick" :disabled="loading" @click="refresh">
          <RefreshCcw :size="14" :stroke-width="2" /> 刷新
        </button>
        <label class="v2-quick primary" :class="{ disabled: uploading }">
          <Upload :size="14" :stroke-width="2" />
          {{ uploading ? `上传中 ${uploadPct}%` : '上传文件' }}
          <input type="file" accept="video/*,image/*" :disabled="uploading" @change="onFileInput" hidden />
        </label>
      </div>
    </header>

    <!-- 上传进度 (大文件含速率 + ETA) -->
    <div v-if="uploading" class="upload-bar">
      <div class="upload-name" :title="uploadName">{{ uploadName }}</div>
      <div class="upload-track">
        <div class="upload-fill" :style="{ width: uploadPct + '%' }"></div>
      </div>
      <div class="upload-meta">
        <span class="upload-pct">{{ uploadPct }}%</span>
        <span v-if="uploadEta" class="upload-eta">{{ uploadEta }}</span>
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
        <div class="drop-text">释放鼠标即开始上传</div>
      </div>

      <div v-if="!loading && filtered.length === 0" class="empty">
        <FolderOpen :size="42" :stroke-width="1.5" class="empty-icon" />
        <div class="empty-title">{{ items.length === 0 ? '媒体库为空' : '当前过滤无结果' }}</div>
        <div class="empty-sub">{{ items.length === 0 ? '把视频或图片拖进来, 或点右上 "上传文件"' : '换个过滤标签看看' }}</div>
      </div>

      <div class="grid">
        <div v-for="m in filtered" :key="m.id" class="card" @click="openPreview(m)">
          <div class="thumb">
            <video v-if="m.kind === 'video'" :src="m.fileUrl" preload="metadata" muted playsinline />
            <img v-else :src="m.fileUrl" :alt="m.originalName" />
            <span class="kind-tag" :class="m.kind">
              <Film v-if="m.kind === 'video'" :size="11" :stroke-width="2" />
              <ImageIcon v-else :size="11" :stroke-width="2" />
              {{ m.kind === 'video' ? '视频' : '图片' }}
            </span>
            <span v-if="m.kind === 'video'" class="duration">{{ fmtDuration(m.durationSec) || '—' }}</span>
          </div>
          <div class="meta">
            <div class="name" :title="m.originalName">{{ m.originalName }}</div>
            <div class="info">
              <span>{{ fmtSize(m.sizeBytes) }}</span>
              <span v-if="m.resolution">· {{ m.resolution }}</span>
            </div>
          </div>
          <div class="card-actions" @click.stop>
            <button class="card-btn" title="推送到大屏" @click="pushToScreen(m)">
              <Send :size="14" :stroke-width="2" />
            </button>
            <button class="card-btn danger" title="删除" @click="confirmDelete(m)">
              <Trash2 :size="14" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 预览弹层 -->
    <div v-if="previewItem" class="preview-mask" @click.self="closePreview">
      <div class="preview-box">
        <button class="preview-close" @click="closePreview"><X :size="20" :stroke-width="2" /></button>
        <div class="preview-media">
          <video v-if="previewItem.kind === 'video'" :src="previewItem.fileUrl" controls autoplay style="max-width:100%; max-height: 70vh;" />
          <img v-else :src="previewItem.fileUrl" :alt="previewItem.originalName" style="max-width:100%; max-height: 70vh;" />
        </div>
        <div class="preview-info">
          <h3>{{ previewItem.originalName }}</h3>
          <div class="meta-row">
            <span class="kind-tag" :class="previewItem.kind">
              {{ previewItem.kind === 'video' ? '视频' : '图片' }}
            </span>
            <span>{{ fmtSize(previewItem.sizeBytes) }}</span>
            <span v-if="previewItem.resolution">{{ previewItem.resolution }}</span>
            <span v-if="previewItem.durationSec">{{ fmtDuration(previewItem.durationSec) }}</span>
            <span>{{ new Date(previewItem.createdAt).toLocaleString('zh-CN') }}</span>
          </div>
          <div v-if="previewItem.remark" class="remark">{{ previewItem.remark }}</div>
          <div class="preview-actions">
            <button class="v2-quick primary" @click="pushToScreen(previewItem)">
              <Send :size="14" :stroke-width="2" /> 推送到 LED 大屏
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
  box-shadow: 0 0 0 1px rgba(6, 182, 212, 0.2);
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
  border-color: rgba(6, 182, 212, 0.3);
}
.v2-quick.danger {
  background: rgba(239, 68, 68, 0.1); color: var(--v2-danger);
  border-color: rgba(239, 68, 68, 0.3);
}
.v2-quick.disabled { opacity: 0.6; cursor: progress; }
.v2-quick:disabled { opacity: 0.6; cursor: not-allowed; }
.v2-tab:hover { color: var(--v2-text-1); }

.upload-bar { display: grid; grid-template-columns: 1fr 1fr auto; align-items: center; gap: 12px; padding: 8px 14px; background: rgba(6, 182, 212, 0.1); border: 1px solid rgba(6, 182, 212, 0.3); border-radius: 10px; font-size: 12px; }
.upload-name { color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.upload-track { height: 6px; background: rgba(15, 23, 42, 0.5); border-radius: 3px; overflow: hidden; }
.upload-fill { height: 100%; background: linear-gradient(90deg, #06b6d4 0%, #a855f7 100%); transition: width 0.2s; box-shadow: 0 0 8px rgba(6, 182, 212, 0.6); }
.upload-meta { display: flex; align-items: center; gap: 10px; }
.upload-pct { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #06b6d4; font-weight: 600; }
.upload-eta { font-size: 11px; color: var(--text-secondary); font-family: 'JetBrains Mono', ui-monospace, monospace; }

.grid-wrap { position: relative; flex: 1; min-height: 0; overflow: auto; padding: 4px; border-radius: 12px; }
.grid-wrap.is-drag { background: rgba(6, 182, 212, 0.08); outline: 2px dashed rgba(6, 182, 212, 0.5); outline-offset: -2px; }
.drop-overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: rgba(15, 23, 42, 0.6); color: #06b6d4; z-index: 5; backdrop-filter: blur(4px); pointer-events: none; border-radius: 12px; }
.drop-text { font-size: 18px; font-weight: 600; letter-spacing: 2px; }

.empty { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: var(--text-secondary); gap: 8px; }
.empty-icon { color: var(--text-muted); }
.empty-title { font-size: 15px; color: var(--text-primary); font-weight: 600; }
.empty-sub { font-size: 12px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }

.card { position: relative; background: linear-gradient(135deg, rgba(99,102,241,0.08), transparent), rgba(15, 23, 42, 0.55); backdrop-filter: blur(10px); border: 1px solid var(--border-soft); border-radius: 12px; overflow: hidden; cursor: pointer; transition: all 0.18s; }
.card:hover { transform: translateY(-2px); border-color: rgba(6, 182, 212, 0.55); box-shadow: 0 10px 24px -8px rgba(6, 182, 212, 0.35); }
.thumb { position: relative; aspect-ratio: 16/10; background: #0b1220; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.thumb video, .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.kind-tag { position: absolute; top: 8px; left: 8px; display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; font-size: 10px; font-weight: 600; border-radius: 999px; backdrop-filter: blur(6px); }
.kind-tag.video { background: rgba(168, 85, 247, 0.4); color: #f3e8ff; border: 1px solid rgba(168, 85, 247, 0.6); }
.kind-tag.image { background: rgba(6, 182, 212, 0.4); color: #cffafe; border: 1px solid rgba(6, 182, 212, 0.6); }
.duration { position: absolute; bottom: 8px; right: 8px; padding: 2px 7px; font-size: 11px; font-family: 'JetBrains Mono', ui-monospace, monospace; background: rgba(0, 0, 0, 0.6); color: #fff; border-radius: 4px; backdrop-filter: blur(4px); }
.meta { padding: 8px 12px; }
.name { font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.info { font-size: 11px; color: var(--text-secondary); margin-top: 3px; display: flex; gap: 4px; }

.card-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 4px; opacity: 0; transition: opacity 0.18s; }
.card:hover .card-actions { opacity: 1; }
.card-btn { width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.8); color: #fff; border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; cursor: pointer; backdrop-filter: blur(6px); transition: all 0.15s; }
.card-btn:hover { background: rgba(6, 182, 212, 0.5); border-color: rgba(6, 182, 212, 0.8); }
.card-btn.danger:hover { background: rgba(239, 68, 68, 0.5); border-color: rgba(239, 68, 68, 0.8); }

/* 预览弹层 */
.preview-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
.preview-box { position: relative; max-width: 90vw; max-height: 90vh; background: rgba(15, 23, 42, 0.95); border: 1px solid rgba(99, 102, 241, 0.4); border-radius: 16px; padding: 18px; display: flex; flex-direction: column; gap: 14px; overflow: auto; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6); }
.preview-close { position: absolute; top: 12px; right: 12px; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: rgba(15, 23, 42, 0.6); color: #fff; border: 1px solid var(--border-soft); border-radius: 8px; cursor: pointer; z-index: 5; }
.preview-close:hover { background: rgba(239, 68, 68, 0.3); border-color: rgba(239, 68, 68, 0.5); }
.preview-media { display: flex; align-items: center; justify-content: center; background: #000; border-radius: 10px; padding: 4px; }
.preview-info h3 { margin: 0 0 8px; font-size: 16px; font-weight: 600; color: var(--text-primary); }
.meta-row { display: flex; gap: 10px; flex-wrap: wrap; font-size: 12px; color: var(--text-secondary); }
.remark { padding: 8px 12px; background: rgba(99, 102, 241, 0.08); border-radius: 6px; font-size: 13px; color: var(--text-primary); }
.preview-actions { display: flex; gap: 8px; margin-top: 6px; }

@media (max-width: 1100px) {
  .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }
}
</style>
