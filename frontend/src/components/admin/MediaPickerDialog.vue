<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Film, Image as ImageIcon, Search, X } from 'lucide-vue-next';
import { mediaService, type MediaItem } from '@/services/media.service';

/**
 * 媒体库挑选弹层 — 替代 "去媒体页" 跳转.
 * 在场景动作编辑 / 任何需要选 mediaId 的地方都能用:
 *   <MediaPickerDialog v-model="visible" v-model:selectedId="form.mediaId" />
 *
 * 不影响 MediaPage 自身, 复用 mediaService.list() 拿数据.
 */

const props = defineProps<{
  modelValue: boolean;
  selectedId?: number | null;
  /** 限制 kind, 缺省两种都列 */
  kind?: 'video' | 'image';
}>();

const emit = defineEmits<{
  'update:modelValue': [v: boolean];
  'update:selectedId': [v: number];
  /** 选定 + 关闭 (业主点确认或双击卡片) */
  picked: [item: MediaItem];
}>();

const items = ref<MediaItem[]>([]);
const loading = ref(false);
const search = ref('');
const filter = ref<'all' | 'video' | 'image'>(props.kind ?? 'all');
const localSelectedId = ref<number | null>(props.selectedId ?? null);

const filtered = computed<MediaItem[]>(() => {
  let list = items.value;
  if (filter.value !== 'all') list = list.filter((m) => m.kind === filter.value);
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    list = list.filter((m) => m.originalName.toLowerCase().includes(q));
  }
  return list;
});

const selectedItem = computed<MediaItem | null>(
  () => items.value.find((m) => m.id === localSelectedId.value) ?? null,
);

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

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      localSelectedId.value = props.selectedId ?? null;
      void refresh();
    }
  },
);

function pick(m: MediaItem): void {
  localSelectedId.value = m.id;
}

function confirm(): void {
  if (!selectedItem.value) {
    ElMessage.warning('请先选一个媒体');
    return;
  }
  emit('update:selectedId', selectedItem.value.id);
  emit('picked', selectedItem.value);
  emit('update:modelValue', false);
}

function close(): void {
  emit('update:modelValue', false);
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtDur(sec: number | null): string {
  if (!sec) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="选媒体"
    width="820"
    destroy-on-close
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <!-- 顶部: 过滤 + 搜索 -->
    <div class="picker-head">
      <el-radio-group v-model="filter" size="default">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button value="video">视频</el-radio-button>
        <el-radio-button value="image">图片</el-radio-button>
      </el-radio-group>
      <div class="search-box">
        <Search :size="14" :stroke-width="2" class="search-icon" />
        <input v-model="search" class="search-input" placeholder="按文件名搜索..." />
        <X v-if="search" :size="14" class="search-clear" @click="search = ''" />
      </div>
      <span class="count-tag">{{ filtered.length }} 项</span>
    </div>

    <!-- 网格 -->
    <div v-loading="loading" class="picker-grid">
      <div v-if="!loading && filtered.length === 0" class="picker-empty">
        媒体库为空, 先去媒体页面上传
      </div>
      <div
        v-for="m in filtered"
        :key="m.id"
        class="picker-card"
        :class="{ selected: localSelectedId === m.id }"
        @click="pick(m)"
        @dblclick="pick(m); confirm()"
      >
        <div class="thumb">
          <video v-if="m.kind === 'video'" :src="m.fileUrl" preload="metadata" muted playsinline />
          <img v-else :src="m.fileUrl" :alt="m.originalName" />
          <span class="kind-tag" :class="m.kind">
            <Film v-if="m.kind === 'video'" :size="10" :stroke-width="2" />
            <ImageIcon v-else :size="10" :stroke-width="2" />
            {{ m.kind === 'video' ? '视频' : '图片' }}
          </span>
          <span v-if="m.kind === 'video'" class="duration">{{ fmtDur(m.durationSec) || '—' }}</span>
        </div>
        <div class="card-meta">
          <div class="card-name" :title="m.originalName">{{ m.originalName }}</div>
          <div class="card-info">{{ fmtSize(m.sizeBytes) }}</div>
        </div>
      </div>
    </div>

    <!-- 底部: 当前选中 + 操作 -->
    <template #footer>
      <div class="footer-row">
        <span class="selected-hint">
          已选: <b>{{ selectedItem ? selectedItem.originalName : '(未选)' }}</b>
          <span v-if="selectedItem" class="sel-id">#{{ selectedItem.id }}</span>
        </span>
        <span class="btn-group">
          <el-button @click="close">取消</el-button>
          <el-button type="primary" :disabled="!selectedItem" @click="confirm">确定</el-button>
        </span>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.picker-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 14px;
}
.search-box {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 10px;
  color: var(--v2-text-3);
  pointer-events: none;
}
.search-input {
  flex: 1;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--v2-border-soft);
  border-radius: 8px;
  padding: 7px 30px;
  color: var(--v2-text-1);
  font-size: 13px;
  outline: none;
  transition: border-color 0.18s;
  width: 100%;
}
.search-input:focus { border-color: var(--v2-primary); }
.search-clear {
  position: absolute;
  right: 10px;
  color: var(--v2-text-3);
  cursor: pointer;
}
.count-tag {
  font-size: 12px;
  color: var(--v2-text-3);
  letter-spacing: 0.04em;
}

.picker-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
  max-height: 52vh;
  overflow-y: auto;
  padding: 4px 2px;
}
.picker-empty {
  grid-column: 1 / -1;
  padding: 40px;
  text-align: center;
  color: var(--v2-text-3);
  font-size: 13px;
}

.picker-card {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--v2-border-soft);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  flex-direction: column;
}
.picker-card:hover {
  transform: translateY(-2px);
  border-color: rgba(76, 154, 255, 0.55);
  box-shadow: 0 8px 20px -8px rgba(76, 154, 255, 0.4);
}
.picker-card.selected {
  border-color: var(--v2-primary);
  box-shadow: 0 0 0 2px var(--v2-primary), 0 10px 24px -6px rgba(76, 154, 255, 0.6);
}

.thumb {
  position: relative;
  aspect-ratio: 16 / 9;
  background: #000;
  overflow: hidden;
}
.thumb video, .thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.kind-tag {
  position: absolute;
  top: 6px;
  left: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.65);
  color: white;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
}
.kind-tag.video { background: rgba(139, 92, 246, 0.85); }
.kind-tag.image { background: rgba(34, 197, 94, 0.85); }
.duration {
  position: absolute;
  bottom: 6px;
  right: 6px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  border-radius: 4px;
  font-size: 10px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.card-meta {
  padding: 8px 10px;
}
.card-name {
  font-size: 12px;
  color: var(--v2-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-info {
  font-size: 11px;
  color: var(--v2-text-3);
  margin-top: 2px;
}

.footer-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.selected-hint {
  font-size: 13px;
  color: var(--v2-text-2);
}
.selected-hint b {
  color: var(--v2-primary-hover);
  font-weight: 500;
  margin: 0 4px;
}
.sel-id {
  color: var(--v2-text-3);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  margin-left: 4px;
}
.btn-group { display: flex; gap: 8px; }
</style>
