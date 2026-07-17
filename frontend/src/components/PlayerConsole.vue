<script setup lang="ts">
/**
 * 播放控制台 — LED 大屏 / 投影仪**共用**这一个组件, 只有 slot 和标题不同。
 *
 * 为什么抽成组件而不是两个页面各写一份: 2026-07-17 在空调页刚吃过教训 ——
 * 同一个卡片写两遍, 必然改一处漏一处。这里两块屏的播放控制逻辑 100% 相同
 * (列表/历史/上下曲/暂停/终止/上传), 只是 slot 不一样, 没有任何理由抄两份。
 *
 * **所有操作都在本页完成, 不跳走**。
 *
 * 2026-07-17 业主原话:
 *   "播放页面不应该点击按钮跳转到其他页面, 应该在该页面固定不变"
 *   "平时经常播放的内容应该在播放列表里面, 随时可以切换播放列表内的内容"
 *   "在播放列表里面可以更改文件名字, 便于随时查找需要播放的素材"
 *   "播放过程中应该随时可以点击终止"
 *   "在 LED 大屏播放页面就可以直接点击上传内容"
 *   "播放过的内容应该有播放历史"
 *   "媒体文件夹内容默认不加入播放列表, 需经管理员确认后再手工加入播放列表"
 *
 * 之前: "视频/图片"和"网页"四个按钮全是 router.push 跳到媒体页选片, 选完再跳回来 ——
 * 要换个片子得离开正在盯着的播放页, 这正是业主说的毛病。
 * 现在: 播放列表内嵌本页, 点一下就切; 上传也在本页 (传完只入媒体库, **不自动进列表**,
 * 要人工点"加入列表" —— 业主明确要求媒体库内容需确认后才进列表)。
 *
 * 投影仪 (slot2) 已拆到独立页 ProjectorPage, 本页只管 LED (slot1)。
 */
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, MonitorPlay, Play, Pause, Square, SkipBack, SkipForward,
  Upload, ListMusic, History, Pencil, Trash2, Plus, Repeat, Repeat1, AlertTriangle,
} from 'lucide-vue-next';
import { usePlaybackStore } from '@/stores/playback';
import {
  listPlaylist, addToPlaylist, renamePlaylistItem, removeFromPlaylist,
  listHistory, type PlaylistItemView, type PlaybackHistoryView,
} from '@/services/playback.service';
import { mediaService } from '@/services/media.service';

const props = defineProps<{
  /** 1 = LED 大屏 (HDMI1), 2 = 投影仪 (HDMI2) */
  slot: 1 | 2;
  title: string;
}>();
const SLOT = computed(() => props.slot);

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }

const playbackStore = usePlaybackStore();
const ch = computed(() => (props.slot === 1 ? playbackStore.slot1 : playbackStore.slot2));

const playlist = ref<PlaylistItemView[]>([]);
const history = ref<PlaybackHistoryView[]>([]);
const busy = ref(false);

async function loadAll(): Promise<void> {
  try {
    const [pl, his] = await Promise.all([listPlaylist(SLOT.value), listHistory(SLOT.value)]);
    playlist.value = pl;
    history.value = his;
  } catch (e) {
    ElMessage.error(`加载播放列表失败: ${(e as Error).message}`);
  }
}
onMounted(() => { void loadAll(); });

/** 当前在播的是列表里的哪一条 (用 mediaId 比, 不信 index —— 可能从媒体库临时推过片子) */
const currentInList = computed(() =>
  playlist.value.find((x) => x.mediaId === ch.value?.currentMediaId) ?? null);

// ============ 播放控制 (业主: "不能一直无脑播放, 保持用户控制状态") ============
async function playItem(it: PlaylistItemView): Promise<void> {
  if (it.missing) { ElMessage.warning('这个媒体已被删除, 先从列表移除'); return; }
  busy.value = true;
  try {
    await playbackStore.publish(SLOT.value, it.mediaId, 'loop');
    await loadAll();                       // 刷新历史
    ElMessage.success(`正在播放「${it.title}」`);
  } catch (e) {
    ElMessage.error(`播放失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

/**
 * 播放 / 暂停 / 继续 —— 一个按钮三态。
 *
 * 待机时按下 = **接着上次那个继续播** (业主: "要保持最后状态, 不要每次都丢状态")。
 * 上次播的从**播放历史**里取 (history[0] 就是最近一次), 它还在列表里就播它;
 * 不在了 (被移出列表/媒体被删) 就退回列表第一个 —— 总能播起来, 不会按了没反应。
 */
async function togglePause(): Promise<void> {
  // 待机 -> 起播
  if (!ch.value?.currentMediaId) {
    if (playlist.value.length === 0) {
      ElMessage.warning('播放列表是空的, 先上传内容或从历史里加回来');
      return;
    }
    const lastId = history.value.find((h) => !h.missing)?.mediaId;
    const target = playlist.value.find((x) => x.mediaId === lastId && !x.missing)
      ?? playlist.value.find((x) => !x.missing);
    if (!target) { ElMessage.warning('列表里的媒体都已被删除'); return; }
    await playItem(target);
    return;
  }
  // 播放中 -> 暂停; 已暂停 -> 继续
  busy.value = true;
  try {
    if (ch.value.paused) await playbackStore.resume(SLOT.value);
    else await playbackStore.pause(SLOT.value);
  } catch (e) {
    ElMessage.error(`操作失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

/** 随时终止 (业主: "播放过程中应该随时可以点击终止") */
async function stopPlayback(): Promise<void> {
  busy.value = true;
  try {
    await playbackStore.stop(SLOT.value);
    ElMessage.success(`已终止, ${props.title}回到待机`);
  } catch (e) {
    ElMessage.error(`终止失败: ${(e as Error).message}`);
  } finally { busy.value = false; }
}

async function step(dir: 'next' | 'prev'): Promise<void> {
  busy.value = true;
  try {
    await (dir === 'next' ? playbackStore.next(SLOT.value) : playbackStore.prev(SLOT.value));
    await loadAll();
  } catch (e) {
    // 列表空时后端返回 400 + 人话, 直接透给业主
    ElMessage.warning((e as Error).message);
  } finally { busy.value = false; }
}

// ============ 播放列表维护 ============
const editingId = ref<number | null>(null);
const editingText = ref('');
function startRename(it: PlaylistItemView): void {
  editingId.value = it.id;
  editingText.value = it.title;
}
async function commitRename(it: PlaylistItemView): Promise<void> {
  const title = editingText.value.trim();
  editingId.value = null;
  if (!title || title === it.title) return;
  const before = it.title;
  it.title = title;                        // 乐观
  try {
    await renamePlaylistItem(it.id, title);
    ElMessage.success('已改名 (只改列表显示名, 媒体库原文件不变)');
  } catch (e) {
    it.title = before;
    ElMessage.error(`改名失败: ${(e as Error).message}`);
  }
}

async function removeItem(it: PlaylistItemView): Promise<void> {
  try {
    await ElMessageBox.confirm(`把「${it.title}」移出播放列表? (媒体库里的文件不会删)`, '移出播放列表', { type: 'warning' });
  } catch { return; }
  try {
    await removeFromPlaylist(it.id);
    await loadAll();
    ElMessage.success('已移出播放列表');
  } catch (e) {
    ElMessage.error(`移出失败: ${(e as Error).message}`);
  }
}

/** 从历史里一键加回列表 (现场常有"刚才那个再放一遍") */
async function addFromHistory(h: PlaybackHistoryView): Promise<void> {
  if (h.missing) { ElMessage.warning('这个媒体已被删除'); return; }
  try {
    await addToPlaylist(SLOT.value, h.mediaId);
    await loadAll();
    ElMessage.success(`「${h.mediaName}」已加入播放列表`);
  } catch (e) {
    ElMessage.error(`加入失败: ${(e as Error).message}`);
  }
}

// ============ 本页直接上传 (业主: "在 LED 大屏播放页面就可以直接点击上传内容") ============
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const uploadPct = ref(0);
function pickFile(): void { fileInput.value?.click(); }

async function onFilePicked(ev: Event): Promise<void> {
  const f = (ev.target as HTMLInputElement).files?.[0];
  (ev.target as HTMLInputElement).value = '';    // 允许连续传同一个文件
  if (!f) return;
  uploading.value = true;
  uploadPct.value = 0;
  try {
    const m = await mediaService.upload(f, { onProgress: (pct: number) => { uploadPct.value = pct; } });
    // **只入媒体库, 不自动进播放列表** —— 业主: "媒体文件夹内容默认不加入播放列表,
    // 需经管理员确认后再手工加入"。所以这里问一句, 由人决定。
    try {
      await ElMessageBox.confirm(
        `「${m.originalName}」已上传到媒体库。要现在加入播放列表吗?`,
        '上传完成',
        { confirmButtonText: '加入播放列表', cancelButtonText: '只放媒体库', type: 'success' },
      );
      await addToPlaylist(SLOT.value, m.id);
      await loadAll();
      ElMessage.success('已加入播放列表');
    } catch {
      ElMessage.info('已保存到媒体库 (未加入播放列表)');
    }
  } catch (e) {
    ElMessage.error(`上传失败: ${(e as Error).message}`);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <section class="led-page">
    <header class="led-head">
      <button class="v2-back-btn" @click="goBack" title="返回首页">
        <ArrowLeft :size="18" :stroke-width="2" />
      </button>
      <div class="led-title"><MonitorPlay :size="18" :stroke-width="1.8" /> {{ title }}</div>
      <span class="led-state" :class="{ on: ch?.currentMediaId, off: !ch?.currentMediaId }">
        {{ ch?.currentMediaId ? (ch.paused ? '已暂停' : '播放中') : '待机' }}
      </span>
      <span v-if="ch && !ch.alive" class="led-warn" title="播放器没有心跳">
        <AlertTriangle :size="14" /> 播放器离线
      </span>
    </header>

    <!-- ===== 正在播 + 播放控制 ===== -->
    <section class="now">
      <div class="now-info">
        <div class="now-label">正在播放</div>
        <div class="now-name" :title="ch?.currentMediaName || ''">
          {{ currentInList?.title || ch?.currentMediaName || '— 待机中 —' }}
        </div>
        <div class="now-sub">
          <span v-if="ch?.loopMode === 'loop'"><Repeat :size="13" /> 循环</span>
          <span v-else><Repeat1 :size="13" /> 播一遍</span>
          <span v-if="ch?.currentMediaId && !currentInList" class="tmp">· 临时推送 (不在播放列表里)</span>
        </div>
      </div>
      <!-- 业主: "暂停、切换、上下内容等均可控制" + "随时可以点击终止" -->
      <div class="now-ctrl">
        <button class="pc-btn" :disabled="busy || playlist.length === 0" title="上一个" @click="step('prev')">
          <SkipBack :size="20" />
        </button>
        <!-- 待机时必须是「播放」而不是一个被禁用的「暂停」(2026-07-17 业主:
             "有停止和暂停按钮, 但是没有播放按钮")。原来 disabled 挂在
             !ch.currentMediaId 上 —— 恰恰在最需要它的时候(待机)把它锁死了。
             口径对齐音响页 BGM 那个已验证好用的: disabled 只看列表空不空。 -->
        <button
          class="pc-btn main"
          :disabled="busy || playlist.length === 0"
          :title="!ch?.currentMediaId ? '播放' : (ch.paused ? '继续' : '暂停')"
          @click="togglePause"
        >
          <Pause v-if="ch?.currentMediaId && !ch.paused" :size="22" />
          <Play v-else :size="22" />
        </button>
        <button class="pc-btn" :disabled="busy || playlist.length === 0" title="下一个" @click="step('next')">
          <SkipForward :size="20" />
        </button>
        <button class="pc-btn stop" :disabled="busy || !ch?.currentMediaId" title="终止播放, 回到待机" @click="stopPlayback">
          <Square :size="18" />
        </button>
      </div>
    </section>

    <div class="cols">
      <!-- ===== 播放列表 ===== -->
      <section class="panel">
        <header class="panel-head">
          <span class="panel-title"><ListMusic :size="16" /> 播放列表</span>
          <span class="panel-count">{{ playlist.length }}</span>
          <input ref="fileInput" type="file" class="hidden-file" accept="video/*,image/*,audio/*" @change="onFilePicked" />
          <button class="v2-quick primary" :disabled="uploading" @click="pickFile">
            <Upload :size="14" /> {{ uploading ? `上传中 ${uploadPct}%` : '上传内容' }}
          </button>
        </header>

        <div v-if="playlist.length === 0" class="empty">
          播放列表是空的。点「上传内容」传新素材, 或从右侧历史里加回来。
          <div class="empty-sub">媒体库里的文件不会自动进这里 — 需要你确认后手工加入</div>
        </div>

        <div v-else class="pl-list">
          <div
            v-for="it in playlist" :key="it.id"
            class="pl-item"
            :class="{ playing: ch?.currentMediaId === it.mediaId, missing: it.missing }"
          >
            <button class="pl-play" :disabled="busy || it.missing" title="播放这个" @click="playItem(it)">
              <Play :size="15" />
            </button>
            <input
              v-if="editingId === it.id"
              v-model="editingText" class="pl-name-input" maxlength="60"
              @click.stop @keyup.enter="commitRename(it)"
              @keyup.esc="editingId = null" @blur="commitRename(it)"
            />
            <span v-else class="pl-name" :title="it.title" @dblclick="startRename(it)">
              {{ it.title }}
              <i v-if="it.missing" class="tag-missing">媒体已删除</i>
            </span>
            <span v-if="ch?.currentMediaId === it.mediaId" class="pl-now">播放中</span>
            <button class="pl-ico" title="改名 (只改这里的显示名, 不动媒体库原文件)" @click="startRename(it)">
              <Pencil :size="14" />
            </button>
            <button class="pl-ico danger" title="移出播放列表" @click="removeItem(it)">
              <Trash2 :size="14" />
            </button>
          </div>
        </div>
      </section>

      <!-- ===== 播放历史 ===== -->
      <section class="panel">
        <header class="panel-head">
          <span class="panel-title"><History :size="16" /> 播放历史</span>
          <span class="panel-count">{{ history.length }}</span>
        </header>
        <div v-if="history.length === 0" class="empty">还没有播放记录</div>
        <div v-else class="pl-list">
          <div v-for="h in history" :key="h.mediaId" class="pl-item" :class="{ missing: h.missing }">
            <span class="pl-name" :title="h.mediaName">
              {{ h.mediaName }}
              <i v-if="h.missing" class="tag-missing">已删除</i>
            </span>
            <span class="pl-time">{{ new Date(h.playedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) }}</span>
            <button class="pl-ico" :disabled="h.missing" title="加入播放列表" @click="addFromHistory(h)">
              <Plus :size="15" />
            </button>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
/* LED 播放页 — 所有操作内嵌本页, 不跳走 (业主: "播放页面不应该点击按钮跳转到其他页面") */
.led-page { display: flex; flex-direction: column; gap: 12px; height: 100%; padding: 12px; min-height: 0; }
.led-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.led-title { display: flex; align-items: center; gap: 8px; font-size: 20px; font-weight: 700; color: var(--v2-text-1); }
.led-state { padding: 3px 12px; border-radius: 20px; font-size: 13px; font-weight: 600; }
.led-state.on { background: #14532d55; color: #4ade80; }
.led-state.off { background: #1b2534; color: var(--v2-text-2); }
.led-warn { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; color: #fbbf24; }

/* 正在播 + 控制条 */
.now {
  display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
  padding: 14px 16px; border-radius: 14px;
  background: var(--v2-surface, #141c28); border: 1px solid var(--v2-border-soft);
}
.now-info { flex: 1 1 240px; min-width: 0; }
.now-label { font-size: 12px; color: var(--v2-text-2); }
.now-name {
  font-size: 22px; font-weight: 700; color: var(--v2-text-1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.now-sub { display: flex; gap: 8px; align-items: center; font-size: 12px; color: var(--v2-text-2); margin-top: 3px; }
.now-sub .tmp { color: #fbbf24; }
.now-ctrl { display: flex; align-items: center; gap: 10px; }
/* 触摸目标做足 —— 现场是站着用平板点的 */
.pc-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border-radius: 12px; cursor: pointer;
  background: var(--v2-surface-2, #1b2534);
  border: 1px solid var(--v2-border, #26344a); color: var(--v2-text-1);
}
.pc-btn:disabled { opacity: .35; cursor: not-allowed; }
.pc-btn.main { width: 60px; height: 60px; background: var(--v2-primary-soft); border-color: var(--v2-primary); color: #fff; }
.pc-btn.stop:not(:disabled):hover { border-color: #ff4757; color: #ff4757; }

.cols { display: grid; grid-template-columns: 1.4fr 1fr; gap: 12px; flex: 1 1 auto; min-height: 0; }
.panel {
  display: flex; flex-direction: column; min-height: 0;
  border-radius: 14px; padding: 12px;
  background: var(--v2-surface, #141c28); border: 1px solid var(--v2-border-soft);
}
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.panel-title { display: inline-flex; align-items: center; gap: 6px; font-size: 15px; font-weight: 700; color: var(--v2-text-1); }
.panel-count { font-size: 12px; color: var(--v2-text-2); background: #1b2534; border-radius: 20px; padding: 2px 8px; }
.panel-head .v2-quick { margin-left: auto; }
.hidden-file { display: none; }

.empty { padding: 20px; text-align: center; font-size: 13px; color: var(--v2-text-2); border: 1px dashed var(--v2-border-soft); border-radius: 10px; }
.empty-sub { margin-top: 6px; font-size: 12px; color: #6d7f98; }

.pl-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.pl-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 10px;
  background: var(--v2-surface-2, #1b2534); border: 1px solid transparent;
}
.pl-item.playing { border-color: var(--v2-primary); background: #16375a; }
.pl-item.missing { opacity: .55; }
.pl-play {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex: 0 0 auto; border-radius: 8px; cursor: pointer;
  background: transparent; border: 1px solid var(--v2-border); color: var(--v2-text-1);
}
.pl-play:disabled { opacity: .35; cursor: not-allowed; }
.pl-name { flex: 1 1 auto; min-width: 0; font-size: 14px; color: var(--v2-text-1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: text; }
.pl-name-input {
  flex: 1 1 auto; min-width: 0; padding: 5px 8px; font-size: 14px;
  color: var(--v2-text-1); background: rgba(0,0,0,.35);
  border: 1px solid var(--v2-primary); border-radius: 6px; outline: none;
}
.tag-missing { margin-left: 6px; padding: 1px 6px; border-radius: 4px; background: #7f1d1d55; color: #fca5a5; font-size: 11px; font-style: normal; }
.pl-now { font-size: 11px; color: var(--v2-primary); flex: 0 0 auto; }
.pl-time { font-size: 12px; color: var(--v2-text-2); flex: 0 0 auto; }
.pl-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex: 0 0 auto; border-radius: 8px; cursor: pointer;
  background: transparent; border: none; color: var(--v2-text-2);
}
.pl-ico:hover { color: var(--v2-text-1); }
.pl-ico.danger:hover { color: #ff6b6b; }
.pl-ico:disabled { opacity: .3; cursor: not-allowed; }

/* 平板/手机: 两栏叠成一栏 */
@media (max-width: 900px) {
  .cols { grid-template-columns: 1fr; }
  .now-ctrl { width: 100%; justify-content: center; }
}
</style>
