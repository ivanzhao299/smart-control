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
} from 'lucide-vue-next';
import { mediaService, type MediaItem } from '@/services/media.service';
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

/** 挑选模式下点卡片: 直接推 + 回来源页 */
async function pickAndPush(m: MediaItem): Promise<void> {
  const slot = pickForSlot.value;
  if (!slot) return;
  try {
    // 背景音乐默认循环播放, 视频/图片默认单次
    await playbackStore.publish(slot, m.id, slot === 3 ? 'loop' : 'once');
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
const filter = ref<'all' | 'video' | 'image' | 'audio'>('all');
const previewItem = ref<MediaItem | null>(null);
const isDragging = ref(false);

const filtered = computed(() => {
  if (filter.value === 'all') return items.value;
  return items.value.filter((m) => m.kind === filter.value);
});

const stats = computed(() => {
  const v = items.value.filter((m) => m.kind === 'video').length;
  const i = items.value.filter((m) => m.kind === 'image').length;
  const a = items.value.filter((m) => m.kind === 'audio').length;
  const totalBytes = items.value.reduce((s, m) => s + m.sizeBytes, 0);
  return { v, i, a, totalBytes };
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

/**
 * 推送到指定播控通道.
 * slot=1: HDMI1 → V2460 → LED 大屏
 * slot=2: HDMI2 → 投影仪
 * 同时推 both: 两个 slot 一起切到同一素材
 */
async function pushTo(m: MediaItem, slot: 1 | 2 | 'both', loopMode: 'once' | 'loop' = 'once'): Promise<void> {
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
          <div class="sub">视频 {{ stats.v }} · 图片 {{ stats.i }} · 音频 {{ stats.a }} · 占 {{ fmtSize(stats.totalBytes) }}</div>
        </div>
        <div class="v2-tabs">
          <button class="v2-tab" :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
          <button class="v2-tab" :class="{ active: filter === 'video' }" @click="filter = 'video'">视频</button>
          <button class="v2-tab" :class="{ active: filter === 'image' }" @click="filter = 'image'">图片</button>
          <button class="v2-tab" :class="{ active: filter === 'audio' }" @click="filter = 'audio'">音频</button>
        </div>
      </div>
      <div class="quick-actions">
        <button class="v2-quick" :disabled="loading" @click="refresh">
          <RefreshCcw :size="14" :stroke-width="2" /> 刷新
        </button>
        <label class="v2-quick primary" :class="{ disabled: uploading }">
          <Upload :size="14" :stroke-width="2" />
          {{ uploading ? `上传中 ${uploadPct}%` : '上传文件' }}
          <input type="file" accept="video/*,image/*,audio/*,.mp3,.wav,.aac,.m4a,.ogg,.flac" :disabled="uploading" @change="onFileInput" hidden />
        </label>
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
            <img v-else :src="absUrl(m.fileUrl)" :alt="m.originalName" />
            <span class="kind-tag" :class="m.kind">
              <Film v-if="m.kind === 'video'" :size="11" :stroke-width="2" />
              <Music v-else-if="m.kind === 'audio'" :size="11" :stroke-width="2" />
              <ImageIcon v-else :size="11" :stroke-width="2" />
              {{ m.kind === 'video' ? '视频' : m.kind === 'audio' ? '音频' : '图片' }}
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
          <div v-if="isWelcome(m)" class="welcome-tag" title="当前欢迎页 — 点 LED 欢迎页按钮会播这个">
            <Home :size="11" :stroke-width="2" /> 欢迎页
          </div>
          <div v-if="currentSlotFor(m.id)" class="playing-tag" :style="isWelcome(m) ? 'top: 36px;' : ''">
            <Send :size="11" :stroke-width="2" /> 播放中: {{ currentSlotFor(m.id) }}
          </div>
          <div class="card-actions" @click.stop>
            <!-- 音频: 直接一个"播放背景音乐"按钮 -->
            <button v-if="m.kind === 'audio'" class="card-btn" title="播放背景音乐" @click="pushAudio(m)">
              <Music :size="14" :stroke-width="2" />
            </button>
            <!-- 视频/图片: 推送到 LED/投影/欢迎页菜单 -->
            <el-dropdown v-else trigger="click" @command="(c: number | string) => {
              if (c === 'welcome') setAsWelcome(m);
              else pushTo(m, c as 1 | 2 | 'both');
            }">
              <button class="card-btn" title="推送到">
                <Send :size="14" :stroke-width="2" />
              </button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item :command="1">推到 LED 大屏 (HDMI1)</el-dropdown-item>
                  <el-dropdown-item :command="2">推到投影仪 (HDMI2)</el-dropdown-item>
                  <el-dropdown-item :command="'both'" divided>同时推两路</el-dropdown-item>
                  <el-dropdown-item :command="'welcome'" divided :disabled="isWelcome(m)">
                    {{ isWelcome(m) ? '✓ 已是欢迎页' : '设为欢迎页' }}
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
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
          <video v-if="previewItem.kind === 'video'" :src="absUrl(previewItem.fileUrl)" controls autoplay style="max-width:100%; max-height: 70vh;" />
          <div v-else-if="previewItem.kind === 'audio'" class="audio-preview">
            <Music :size="64" :stroke-width="1.4" />
            <audio :src="absUrl(previewItem.fileUrl)" controls autoplay style="width: 320px; max-width: 80vw;" />
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

.card { position: relative; background: linear-gradient(135deg, rgba(99,102,241,0.08), transparent), rgba(15, 23, 42, 0.55); border: 1px solid var(--border-soft); border-radius: 12px; overflow: hidden; cursor: pointer; transition: all 0.18s; }
.card:hover { transform: translateY(-2px); border-color: rgba(6, 182, 212, 0.55); box-shadow: 0 10px 24px -8px rgba(6, 182, 212, 0.35); }
.card.pick-mode { cursor: pointer; }
.card.pick-mode:hover { border-color: var(--v2-primary); box-shadow: 0 12px 30px -10px rgba(6, 182, 212, 0.55), inset 0 0 0 1px var(--v2-primary); }
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
  box-shadow: 0 6px 16px -4px rgba(6, 182, 212, 0.5);
  z-index: 3;
}

/* Pick 模式 banner */
.pick-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: linear-gradient(90deg, rgba(6, 182, 212, 0.18), rgba(6, 182, 212, 0.06));
  border: 1px solid rgba(6, 182, 212, 0.4);
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
  background: radial-gradient(ellipse at center, rgba(168,85,247,0.18), transparent 70%), #0b1220; }
.kind-tag { position: absolute; top: 8px; left: 8px; display: inline-flex; align-items: center; gap: 4px; padding: 3px 7px; font-size: 10px; font-weight: 600; border-radius: 999px; backdrop-filter: blur(6px); }
.kind-tag.video { background: rgba(168, 85, 247, 0.4); color: #f3e8ff; border: 1px solid rgba(168, 85, 247, 0.6); }
.kind-tag.image { background: rgba(6, 182, 212, 0.4); color: #cffafe; border: 1px solid rgba(6, 182, 212, 0.6); }
.kind-tag.audio { background: rgba(245, 158, 11, 0.4); color: #fef3c7; border: 1px solid rgba(245, 158, 11, 0.6); }
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
  background: rgba(6, 182, 212, 0.85);
  color: white;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  box-shadow: 0 4px 10px -2px rgba(6, 182, 212, 0.4);
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
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.04em;
  box-shadow: 0 4px 10px -2px rgba(245, 158, 11, 0.5);
  z-index: 2;
}
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
