<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, MonitorPlay, Power, X, Sparkles, Play, Tv2, Sun,
} from 'lucide-vue-next';
import { ledService, type LedInput } from '@/services/led.service';
import { usePlaybackStore } from '@/stores/playback';

const playbackStore = usePlaybackStore();

interface LedRow {
  id: string;
  name: string;
  floor: string;
  power: boolean;
  input: LedInput;
  brightness: number;
  media: string;
  busy: boolean;
  error: string | null;
}

const screens = ref<LedRow[]>([
  { id: 'led_1f_main', name: '一层主 LED', floor: '1F', power: false, input: 'HDMI1', brightness: 80, media: '', busy: false, error: null },
  { id: 'led_2f_main', name: '二层主 LED', floor: '2F', power: false, input: 'HDMI1', brightness: 80, media: '', busy: false, error: null },
]);

const INPUTS: Array<{ value: LedInput; label: string }> = [
  { value: 'HDMI1', label: 'HDMI 1' },
  { value: 'HDMI2', label: 'HDMI 2' },
  { value: 'welcome', label: '欢迎页' },
  { value: 'video', label: '视频' },
];

async function call(z: LedRow, label: string, fn: () => Promise<{ ok: boolean; error?: string }>): Promise<boolean> {
  z.busy = true; z.error = null;
  try {
    const res = await fn();
    if (!res.ok) throw new Error(res.error || '执行失败');
    ElMessage.success(`${z.name} ${label}成功`);
    return true;
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} ${label}失败: ${z.error}`);
    return false;
  } finally { z.busy = false; }
}

async function togglePower(z: LedRow): Promise<void> {
  const want = !z.power;
  const ok = await call(z, want ? '开屏' : '关屏', () => (want ? ledService.on(z.id) : ledService.off(z.id)));
  if (ok) z.power = want;
}

async function changeInput(z: LedRow, input: LedInput): Promise<void> {
  const ok = await call(z, `切换 ${input}`, () => ledService.switchInput(z.id, input));
  if (ok) { z.input = input; z.power = true; }
}

async function welcome(z: LedRow): Promise<void> {
  const ok = await call(z, '欢迎页', () => ledService.welcome(z.id));
  if (ok) { z.power = true; z.input = 'welcome'; }
}

// Sprint-10 后: 不再用旧 ledService.play(media=字符串) 这条路径, 媒体走 playbackStore.publish.
// 留 ledService.play() 的 API 给场景引擎用 (LED 切到 "video" 预设, 不传文件名).

// ============ 总览 ============
const overview = computed(() => {
  const total = screens.value.length;
  const onCount = screens.value.filter((z) => z.power).length;
  return { total, onCount };
});

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }
/**
 * 跳媒体页"选一个推到 slot" — 带 ?pick_for_slot=N 参数, MediaPage 检测到这个
 * 模式就变成"选一张就推 + 回 LED 页", 用户不用再手动回来.
 */
function gotoMedia(slot?: 1 | 2): void {
  if (slot) router.push({ name: 'media', query: { pick_for_slot: String(slot) } });
  else router.push({ name: 'media' });
}

async function stopPlayback(slot: 1 | 2): Promise<void> {
  try {
    await playbackStore.stop(slot);
    ElMessage.success(`已停止 ${slot === 1 ? 'LED' : '投影'} 播放, 回到待机`);
  } catch (e) {
    ElMessage.error(`停止失败: ${(e as Error).message}`);
  }
}
async function allOn(): Promise<void> {
  for (const z of screens.value) { if (!z.power) await togglePower(z); }
}
async function allOff(): Promise<void> {
  for (const z of screens.value) { if (z.power) await togglePower(z); }
}
</script>

<template>
  <section class="v2-page">
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="goBack" title="返回首页">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title-block">
          <div class="title"><MonitorPlay :size="18" :stroke-width="1.8" /> LED 大屏控制</div>
          <div class="sub">诺瓦 V2460 · V/VX 协议族 · {{ overview.total }} 屏</div>
        </div>
      </div>
      <div class="quick-actions">
        <button class="v2-quick primary" @click="allOn">
          <Power :size="14" :stroke-width="2" /> 全部开
        </button>
        <button class="v2-quick danger" @click="allOff">
          <X :size="14" :stroke-width="2" /> 全部关
        </button>
      </div>
    </header>

    <!-- 总览 -->
    <div class="v2-overview led">
      <div class="ov-item">
        <div class="ov-ico"><MonitorPlay :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">开屏中</div>
          <div class="ov-value v2-inter">{{ overview.onCount }}<span class="unit">/ {{ overview.total }}</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Tv2 :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">控制器</div>
          <div class="ov-value v2-inter" style="font-size: 16px;">诺瓦 V2460</div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Sparkles :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">协议</div>
          <div class="ov-value v2-inter" style="font-size: 16px;">TCP 5200</div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Power :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">网关状态</div>
          <div class="ov-value v2-inter" style="font-size: 16px; color: var(--v2-success);">在线</div>
        </div>
      </div>
    </div>

    <!-- 双路播控当前状态 (HDMI1 → LED, HDMI2 → 投影) -->
    <div class="playback-row">
      <div class="playback-card" :class="{ idle: !playbackStore.slot1?.currentMediaId, dead: playbackStore.slot1 && !playbackStore.slot1.alive }">
        <div class="pb-head">
          <div>
            <div class="pb-name">{{ playbackStore.slot1?.name ?? 'HDMI1 → LED' }}</div>
            <div class="pb-sub">{{ playbackStore.slot1?.alive ? '播控在线' : 'kiosk 离线 / 未启动' }}</div>
          </div>
          <div class="pb-tag" :class="playbackStore.slot1?.currentMediaId ? 'on' : 'off'">
            {{ playbackStore.slot1?.currentMediaId ? '播放中' : '待机' }}
          </div>
        </div>
        <div v-if="playbackStore.slot1?.currentMediaName" class="pb-media">
          {{ playbackStore.slot1.currentMediaKind === 'video' ? '🎬' : '🖼' }}
          {{ playbackStore.slot1.currentMediaName }}
          <span class="pb-loop">{{ playbackStore.slot1.loopMode === 'loop' ? '· 循环' : '· 单次' }}</span>
        </div>
        <div class="pb-actions">
          <button class="v2-quick" @click="gotoMedia(1)">选媒体</button>
          <button v-if="playbackStore.slot1?.currentMediaId" class="v2-quick danger" @click="stopPlayback(1)">停止 / 回待机</button>
        </div>
      </div>

      <div class="playback-card" :class="{ idle: !playbackStore.slot2?.currentMediaId, dead: playbackStore.slot2 && !playbackStore.slot2.alive }">
        <div class="pb-head">
          <div>
            <div class="pb-name">{{ playbackStore.slot2?.name ?? 'HDMI2 → 投影' }}</div>
            <div class="pb-sub">{{ playbackStore.slot2?.alive ? '播控在线' : 'kiosk 离线 / 未启动' }}</div>
          </div>
          <div class="pb-tag" :class="playbackStore.slot2?.currentMediaId ? 'on' : 'off'">
            {{ playbackStore.slot2?.currentMediaId ? '播放中' : '待机' }}
          </div>
        </div>
        <div v-if="playbackStore.slot2?.currentMediaName" class="pb-media">
          {{ playbackStore.slot2.currentMediaKind === 'video' ? '🎬' : '🖼' }}
          {{ playbackStore.slot2.currentMediaName }}
          <span class="pb-loop">{{ playbackStore.slot2.loopMode === 'loop' ? '· 循环' : '· 单次' }}</span>
        </div>
        <div class="pb-actions">
          <button class="v2-quick" @click="gotoMedia(2)">选媒体</button>
          <button v-if="playbackStore.slot2?.currentMediaId" class="v2-quick danger" @click="stopPlayback(2)">停止 / 回待机</button>
        </div>
      </div>
    </div>

    <!-- 屏卡 -->
    <div class="v2-screen-grid">
      <div
        v-for="z in screens"
        :key="z.id"
        class="v2-screen"
        :class="{ on: z.power, offline: !!z.error }"
      >
        <div class="screen-top">
          <div class="screen-meta">
            <div class="screen-name">{{ z.name }}</div>
            <div class="screen-addr v2-inter">{{ z.id.toUpperCase() }} · {{ z.floor }}</div>
          </div>
          <button
            class="v2-toggle"
            :class="{ on: z.power }"
            :disabled="z.busy"
            @click="togglePower(z)"
            :title="z.power ? '关屏' : '开屏'"
          ></button>
        </div>

        <!-- 当前输入 -->
        <div class="screen-state">
          <div class="state-label">当前输入</div>
          <div class="state-value v2-inter">{{ INPUTS.find(i => i.value === z.input)?.label ?? z.input }}</div>
        </div>

        <!-- 输入切换 -->
        <div class="input-row">
          <button
            v-for="i in INPUTS"
            :key="i.value"
            class="input-chip"
            :class="{ active: z.input === i.value }"
            :disabled="z.busy"
            @click="changeInput(z, i.value)"
          >{{ i.label }}</button>
        </div>

        <!-- 媒体操作: 旧手输文件名行已下架, 改成"去媒体页选" 链接 + 当前播放 -->
        <div class="media-row">
          <button class="v2-quick primary" @click="gotoMedia(1)">
            <Play :size="14" :stroke-width="2" /> 选媒体推送
          </button>
          <button class="v2-quick" :disabled="z.busy" @click="welcome(z)">
            <Sun :size="14" :stroke-width="2" /> 欢迎页
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.v2-page { padding: var(--v2-sp-5); display: flex; flex-direction: column; gap: var(--v2-sp-4); }

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
.title {
  font-size: 15px; font-weight: 600; color: var(--v2-text-1);
  display: inline-flex; align-items: center; gap: var(--v2-sp-2); letter-spacing: 0.5px;
}
.sub { font-size: var(--v2-fs-xs); color: var(--v2-text-3); margin-top: 2px; }

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

/* 总览 (LED 用青色调) */
.v2-overview.led {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--v2-sp-3);
  padding: var(--v2-sp-4);
  background: linear-gradient(135deg, rgba(6, 182, 212, 0.05), rgba(6, 182, 212, 0.01));
  border: 1px solid rgba(6, 182, 212, 0.12);
  border-radius: var(--v2-r-lg);
}
.ov-item { display: flex; align-items: center; gap: var(--v2-sp-3); }
.ov-ico {
  width: 40px; height: 40px; border-radius: var(--v2-r-sm);
  background: var(--v2-primary-soft); color: var(--v2-primary);
  display: grid; place-items: center; flex-shrink: 0;
}
.ov-body { display: flex; flex-direction: column; min-width: 0; }
.ov-label { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 1px; }
.ov-value { font-size: 20px; font-weight: 600; line-height: 1.1; margin-top: 2px; color: var(--v2-text-1); }
.ov-value .unit { font-size: 12px; color: var(--v2-text-3); margin-left: 2px; font-weight: 400; }

/* 双路播控当前状态卡 */
.playback-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--v2-sp-4);
}
@media (max-width: 900px) { .playback-row { grid-template-columns: 1fr; } }
.playback-card {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow:
    inset 0 1px 0 rgba(6, 182, 212, 0.35),
    var(--v2-elev-1);
}
.playback-card.idle { opacity: 0.78; }
.playback-card.dead { border-color: rgba(239, 68, 68, 0.5); }
.pb-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.pb-name { font-size: 15px; font-weight: 500; color: var(--v2-text-1); }
.pb-sub { font-size: 11px; color: var(--v2-text-3); margin-top: 3px; letter-spacing: 0.04em; }
.pb-tag {
  display: inline-flex; align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
}
.pb-tag.on  { background: rgba(6, 182, 212, 0.25); color: var(--v2-primary-hover); }
.pb-tag.off { background: rgba(255, 255, 255, 0.08); color: var(--v2-text-3); }
.pb-media {
  font-size: 13px;
  color: var(--v2-text-2);
  background: rgba(0, 0, 0, 0.25);
  border-radius: 8px;
  padding: 8px 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pb-loop { color: var(--v2-text-3); font-size: 11px; margin-left: 4px; }
.pb-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* 屏卡 */
.v2-screen-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--v2-sp-4);
}
@media (max-width: 900px) { .v2-screen-grid { grid-template-columns: 1fr; } }

.v2-screen {
  position: relative; padding: var(--v2-sp-4);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  display: flex; flex-direction: column; gap: var(--v2-sp-4);
  overflow: hidden;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
  transition: all 0.22s ease;
}
.v2-screen.on {
  border-color: rgba(6, 182, 212, 0.22);
  box-shadow: 0 8px 24px -10px rgba(6, 182, 212, 0.3);
}
.v2-screen.offline { opacity: 0.5; }

.screen-top { display: flex; align-items: center; justify-content: space-between; }
.screen-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.screen-name { font-size: 17px; font-weight: 600; color: var(--v2-text-1); letter-spacing: 0.5px; }
.screen-addr { font-size: 10px; color: var(--v2-text-3); letter-spacing: 1px; }

.v2-toggle {
  position: relative; width: 42px; height: 24px;
  border-radius: 12px; background: var(--v2-surf-2);
  cursor: pointer; transition: background 0.22s ease;
  flex-shrink: 0; border: none; padding: 0;
}
.v2-toggle::after {
  content: ''; position: absolute; top: 2px; left: 2px;
  width: 20px; height: 20px; border-radius: 50%;
  background: white; box-shadow: 0 1px 4px rgba(0,0,0,0.4);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
}
.v2-toggle.on {
  background: linear-gradient(135deg, var(--v2-primary), #22d3ee);
  box-shadow: 0 0 10px rgba(6, 182, 212, 0.45);
}
.v2-toggle.on::after { transform: translateX(18px); }
.v2-toggle:disabled { opacity: 0.5; cursor: not-allowed; }

.screen-state {
  display: flex; flex-direction: column; gap: var(--v2-sp-1);
  padding: var(--v2-sp-3);
  background: var(--v2-surf-2);
  border-radius: var(--v2-r-md);
}
.state-label { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 1px; }
.state-value { font-size: 18px; font-weight: 600; color: var(--v2-text-1); }

.input-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.input-chip {
  padding: 10px 0; border-radius: 6px;
  font-size: var(--v2-fs-sm); background: var(--v2-surf-2);
  color: var(--v2-text-2); text-align: center; cursor: pointer;
  transition: all 0.18s ease; border: 1px solid transparent;
  min-height: 40px;
}
.input-chip:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.input-chip.active {
  background: var(--v2-primary-soft); color: var(--v2-primary);
  border-color: rgba(6, 182, 212, 0.3);
}
.input-chip:disabled { opacity: 0.4; cursor: not-allowed; }

.media-row {
  display: grid; grid-template-columns: 1fr auto auto;
  gap: var(--v2-sp-2); align-items: center;
}
.media-input {
  padding: 10px 14px;
  background: var(--v2-surf-2);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-sm);
  color: var(--v2-text-1);
  font-size: var(--v2-fs-sm);
  outline: none;
  min-height: 40px;
}
.media-input:focus { border-color: var(--v2-primary); }
</style>
