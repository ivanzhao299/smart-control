<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, MonitorPlay, Play, Tv2, Sun, Globe,
  Image as ImageIcon, MonitorOff,
} from 'lucide-vue-next';
import { usePlaybackStore } from '@/stores/playback';
import { absUrl } from '@/services/http';

const playbackStore = usePlaybackStore();

// 现场只有两块由 GK9000 控制的屏: LED 大屏 (slot1 HDMI1) + 投影 (slot2 HDMI2).
// 概览看这两块的播放/在线状态.
const overview = computed(() => {
  const list = [playbackStore.slot1, playbackStore.slot2];
  return {
    playing: list.filter((s) => s?.currentMediaId).length,
    online: list.filter((s) => s?.alive).length,
  };
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
</script>

<template>
  <section class="v2-page">
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="goBack" title="返回首页">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title-block">
          <div class="title"><MonitorPlay :size="18" :stroke-width="1.8" /> 大屏 / 投影播控</div>
          <div class="sub">GK9000 双路播控 · HDMI1 → LED 大屏 · HDMI2 → 投影仪</div>
        </div>
      </div>
    </header>

    <!-- 总览 -->
    <div class="v2-overview led">
      <div class="ov-item">
        <div class="ov-ico"><MonitorPlay :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">播放中</div>
          <div class="ov-value v2-inter">{{ overview.playing }}<span class="unit">/ 2</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Tv2 :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">播放器在线</div>
          <div class="ov-value v2-inter">{{ overview.online }}<span class="unit">/ 2</span></div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><Play :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">输出</div>
          <div class="ov-value v2-inter" style="font-size: 15px;">HDMI 双路</div>
        </div>
      </div>
      <div class="ov-item">
        <div class="ov-ico"><MonitorPlay :size="18" :stroke-width="2" /></div>
        <div class="ov-body">
          <div class="ov-label">主控</div>
          <div class="ov-value v2-inter" style="font-size: 15px;">GK9000</div>
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
        <!-- 大屏实时镜像 — 跟 PlayerPage 显示一样的内容, 业主一眼看到大屏状态 -->
        <div class="pb-mirror" :class="{ empty: !playbackStore.slot1?.currentMediaUrl }">
          <video
            v-if="playbackStore.slot1?.currentMediaKind === 'video' && playbackStore.slot1?.currentMediaUrl"
            :src="absUrl(playbackStore.slot1.currentMediaUrl)"
            :key="playbackStore.slot1.currentMediaUrl"
            muted
            autoplay
            loop
            playsinline
          />
          <img
            v-else-if="playbackStore.slot1?.currentMediaKind === 'image' && playbackStore.slot1?.currentMediaUrl"
            :src="absUrl(playbackStore.slot1.currentMediaUrl)"
            :alt="playbackStore.slot1.currentMediaName || ''"
          />
          <div v-else-if="playbackStore.slot1?.currentMediaKind === 'webpage'" class="pb-mirror-idle">
            <Globe :size="28" :stroke-width="1.5" />
            <span>网页内容</span>
          </div>
          <div v-else class="pb-mirror-idle">
            <MonitorOff :size="28" :stroke-width="1.5" />
            <span>待机中</span>
          </div>
        </div>
        <div v-if="playbackStore.slot1?.currentMediaName" class="pb-media">
          <Play v-if="playbackStore.slot1.currentMediaKind === 'video'" :size="13" :stroke-width="2" />
          <ImageIcon v-else :size="13" :stroke-width="2" />
          {{ playbackStore.slot1.currentMediaName }}
          <span class="pb-loop">{{ playbackStore.slot1.loopMode === 'loop' ? '· 循环' : '· 单次' }}</span>
        </div>
        <div class="pb-actions">
          <button class="v2-quick primary" @click="gotoMedia(1)"><Play :size="14" :stroke-width="2" /> 视频/图片</button>
          <button class="v2-quick" @click="gotoMedia(1)"><Globe :size="14" :stroke-width="2" /> 网页</button>
          <button class="v2-quick" @click="stopPlayback(1)"><Sun :size="14" :stroke-width="2" /> 欢迎/待机</button>
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
        <div class="pb-mirror" :class="{ empty: !playbackStore.slot2?.currentMediaUrl }">
          <video
            v-if="playbackStore.slot2?.currentMediaKind === 'video' && playbackStore.slot2?.currentMediaUrl"
            :src="absUrl(playbackStore.slot2.currentMediaUrl)"
            :key="playbackStore.slot2.currentMediaUrl"
            muted
            autoplay
            loop
            playsinline
          />
          <img
            v-else-if="playbackStore.slot2?.currentMediaKind === 'image' && playbackStore.slot2?.currentMediaUrl"
            :src="absUrl(playbackStore.slot2.currentMediaUrl)"
            :alt="playbackStore.slot2.currentMediaName || ''"
          />
          <div v-else-if="playbackStore.slot2?.currentMediaKind === 'webpage'" class="pb-mirror-idle">
            <Globe :size="28" :stroke-width="1.5" />
            <span>网页内容</span>
          </div>
          <div v-else class="pb-mirror-idle">
            <MonitorOff :size="28" :stroke-width="1.5" />
            <span>待机中</span>
          </div>
        </div>
        <div v-if="playbackStore.slot2?.currentMediaName" class="pb-media">
          <Play v-if="playbackStore.slot2.currentMediaKind === 'video'" :size="13" :stroke-width="2" />
          <ImageIcon v-else :size="13" :stroke-width="2" />
          {{ playbackStore.slot2.currentMediaName }}
          <span class="pb-loop">{{ playbackStore.slot2.loopMode === 'loop' ? '· 循环' : '· 单次' }}</span>
        </div>
        <div class="pb-actions">
          <button class="v2-quick primary" @click="gotoMedia(2)"><Play :size="14" :stroke-width="2" /> 视频/图片</button>
          <button class="v2-quick" @click="gotoMedia(2)"><Globe :size="14" :stroke-width="2" /> 网页</button>
          <button class="v2-quick" @click="stopPlayback(2)"><Sun :size="14" :stroke-width="2" /> 欢迎/待机</button>
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
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pb-loop { color: var(--v2-text-3); font-size: 11px; margin-left: 4px; }
.pb-actions { display: flex; gap: 8px; flex-wrap: wrap; }

/* 大屏实时镜像 — 业主看大屏播啥的窗口 */
.pb-mirror {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--v2-border-soft);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.4),
    0 4px 14px -4px rgba(0, 0, 0, 0.45);
}
.pb-mirror video, .pb-mirror img {
  width: 100%; height: 100%;
  object-fit: contain;
  display: block;
  background: #000;
}
.pb-mirror.empty {
  background: radial-gradient(ellipse at center, rgba(0, 229, 255, 0.04), transparent 70%), #050810;
  border-color: rgba(255, 255, 255, 0.06);
}
.pb-mirror-idle {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--v2-text-3);
  font-size: 12px;
  letter-spacing: 0.1em;
}

/* 屏卡 */
.v2-screen-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--v2-sp-4);
}
@media (max-width: 900px) { .v2-screen-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) {
  .v2-screen { padding: var(--v2-sp-3); gap: var(--v2-sp-3); }
  .screen-name { font-size: 15px; }
  .state-value { font-size: 18px; }
  .input-row { grid-template-columns: repeat(2, 1fr); }
  .v2-toggle { width: 48px; height: 28px; }
  .v2-toggle::after { width: 24px; height: 24px; }
  .v2-toggle.on::after { transform: translateX(20px); }
}

.v2-screen {
  position: relative; padding: var(--v2-sp-4);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  display: flex; flex-direction: column; gap: var(--v2-sp-4);
  overflow: hidden;
  backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
  transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
/* 顶部 1px 电光青光带 — LED 主色 */
.v2-screen::after {
  content: '';
  position: absolute;
  top: 0; left: 12%; right: 12%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--v2-primary) 50%, transparent);
  box-shadow: 0 0 8px var(--v2-primary);
  opacity: 0.4;
  pointer-events: none;
  transition: opacity 0.28s ease;
}
.v2-screen:hover {
  transform: translateY(-3px);
  border-color: rgba(0, 229, 255, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(0, 229, 255, 0.55),
    0 0 0 1px rgba(0, 229, 255, 0.15),
    0 14px 32px -10px rgba(0, 229, 255, 0.3);
}
.v2-screen:hover::after { opacity: 0.85; }
.v2-screen.on {
  border-color: rgba(0, 229, 255, 0.55);
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.10), rgba(0, 184, 212, 0.04));
  box-shadow:
    inset 0 1px 0 rgba(0, 229, 255, 0.65),
    0 8px 32px -8px rgba(0, 229, 255, 0.45),
    0 0 40px -10px rgba(0, 229, 255, 0.35) !important;
}
.v2-screen.on::after { opacity: 1; }
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
  background: linear-gradient(135deg, #00B8D4, #00E5FF);
  box-shadow:
    0 0 14px rgba(0, 229, 255, 0.6),
    0 0 28px rgba(0, 229, 255, 0.35);
}
.v2-toggle.on::after {
  background: white;
  box-shadow:
    0 1px 4px rgba(0,0,0,0.4),
    0 0 8px rgba(255, 255, 255, 0.6);
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
.state-value { font-size: 20px; font-weight: 700; color: var(--v2-text-1); letter-spacing: 0.4px; }
.v2-screen.on .state-value { color: #67FFFF; text-shadow: var(--v2-text-glow-primary); }

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
  background: var(--v2-primary-soft);
  color: var(--v2-primary-hover);
  border-color: rgba(0, 229, 255, 0.5);
  text-shadow: 0 0 8px var(--v2-primary);
  font-weight: 600;
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
