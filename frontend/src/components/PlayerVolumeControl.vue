<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { AlertTriangle, LoaderCircle, Volume2, VolumeX } from 'lucide-vue-next';
import { captureIdentityGuard } from '@/services/identity-boundary';
import { audioService } from '@/services/audio.service';

const props = defineProps<{
  /** EKX-808 0-based output pair: LED [0,1], projector [2,3]. */
  channels: readonly [number, number];
  label: string;
  disabled?: boolean;
}>();

const anchorEl = ref<HTMLElement | null>(null);
const panelEl = ref<HTMLElement | null>(null);
const open = ref(false);
const loading = ref(false);
const loaded = ref(false);
const error = ref('');
const value = ref<number | null>(null);
const muted = ref(false);
const mismatch = ref(false);
const panelStyle = ref<Record<string, string>>({});

let disposed = false;
let requestRevision = 0;
let pendingValue: number | null = null;
let sending = false;

const iconComponent = computed(() => (muted.value ? VolumeX : Volume2));
const sliderDisabled = computed(() => Boolean(props.disabled) || loading.value || value.value === null || Boolean(error.value));

function clampVolume(raw: number): number {
  return Math.max(0, Math.min(100, Math.round(raw)));
}

function placePanel(): void {
  const anchor = anchorEl.value;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  const width = 236;
  const height = 86;
  const gap = 8;
  const padding = 12;

  // Prefer the side of the label row. This keeps the panel away from the video
  // seek row, which occupies its own full-width line on mobile.
  let left = rect.right + gap;
  let top = rect.top - 6;
  if (left + width > window.innerWidth - padding) left = rect.left - width - gap;
  if (left < padding) left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding));
  if (top + height > window.innerHeight - padding) top = window.innerHeight - height - padding;
  if (top < padding) top = padding;

  panelStyle.value = {
    left: `${Math.round(left)}px`,
    top: `${Math.round(top)}px`,
    width: `${width}px`,
  };
}

function onViewportChange(): void {
  if (open.value) placePanel();
}

function onDocumentPointerDown(event: PointerEvent): void {
  const target = event.target as Node | null;
  if (target && (anchorEl.value?.contains(target) || panelEl.value?.contains(target))) return;
  open.value = false;
}

async function readLiveVolume(): Promise<void> {
  if (loaded.value || loading.value || disposed) return;
  loading.value = true;
  error.value = '';
  const revision = ++requestRevision;
  try {
    const result = await audioService.getLiveOutputs();
    const isCurrent = captureIdentityGuard(() => !disposed && requestRevision === revision);
    if (!isCurrent()) return;
    if (!result.ok || !result.data?.channels) throw new Error(result.error || '无法读取音量');
    const [leftCh, rightCh] = props.channels;
    const left = result.data.channels.find((channel) => channel.ch === leftCh);
    const right = result.data.channels.find((channel) => channel.ch === rightCh);
    if (left?.volume == null || right?.volume == null) throw new Error('左右声道音量未知');
    value.value = clampVolume(left.volume);
    mismatch.value = clampVolume(left.volume) !== clampVolume(right.volume);
    muted.value = Boolean(left.muted || right.muted);
    loaded.value = true;
  } catch (reason) {
    if (disposed || requestRevision !== revision) return;
    error.value = (reason as Error).message || '无法读取当前音量';
  } finally {
    if (!disposed && requestRevision === revision) loading.value = false;
  }
}

function openPanel(): void {
  if (props.disabled) return;
  open.value = !open.value;
  if (!open.value) return;
  void nextTick(() => placePanel());
  void readLiveVolume();
}

function queueVolume(next: number): void {
  value.value = clampVolume(next);
  pendingValue = value.value;
  error.value = '';
  if (!sending) void drainVolumeQueue();
}

async function drainVolumeQueue(): Promise<void> {
  sending = true;
  try {
    while (pendingValue !== null && !disposed) {
      const next = pendingValue;
      pendingValue = null;
      const revision = ++requestRevision;
      const results = await Promise.allSettled([
        audioService.setVolume(`audio_out${props.channels[0] + 1}`, next, `out${props.channels[0] + 1}`),
        audioService.setVolume(`audio_out${props.channels[1] + 1}`, next, `out${props.channels[1] + 1}`),
      ]);
      const isCurrent = captureIdentityGuard(() => !disposed && requestRevision === revision);
      if (!isCurrent()) continue;
      const failed = results.find((result) => result.status === 'rejected'
        || (result.status === 'fulfilled' && !result.value.ok));
      if (failed) {
        error.value = '左右声道未完全同步';
        mismatch.value = true;
      } else {
        error.value = '';
        mismatch.value = false;
        muted.value = next === 0;
      }
    }
  } finally {
    sending = false;
  }
}

function retry(): void {
  loaded.value = false;
  void readLiveVolume();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false;
}

window.addEventListener('resize', onViewportChange, { passive: true });
window.addEventListener('scroll', onViewportChange, { passive: true });
document.addEventListener('pointerdown', onDocumentPointerDown);
document.addEventListener('keydown', onKeydown);
onBeforeUnmount(() => {
  disposed = true;
  requestRevision += 1;
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange);
  document.removeEventListener('pointerdown', onDocumentPointerDown);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <button
    ref="anchorEl"
    type="button"
    class="player-volume-trigger"
    :class="{ active: open, muted, readonly: disabled }"
    :disabled="disabled"
    :aria-label="`${label}${disabled ? '（只读）' : ''}`"
    :aria-expanded="open"
    :title="disabled ? `${label}（只读）` : label"
    @click.stop="openPanel"
  >
    <component :is="iconComponent" :size="16" :stroke-width="2" />
  </button>

  <Teleport to="body">
    <div
      v-if="open"
      ref="panelEl"
      class="player-volume-popover"
      :style="panelStyle"
      role="dialog"
      :aria-label="label"
      @pointerdown.stop
    >
      <div class="player-volume-head">
        <span>{{ label }}</span>
        <span v-if="value !== null" class="player-volume-value">{{ value }}%</span>
      </div>
      <div v-if="loading" class="player-volume-state">
        <LoaderCircle :size="14" class="player-volume-spin" /> 正在读取当前音量…
      </div>
      <div v-else-if="error" class="player-volume-state error">
        <AlertTriangle :size="14" />
        <span>{{ error }}</span>
        <button type="button" class="player-volume-retry" @click="retry">重试</button>
      </div>
      <label v-else class="player-volume-slider">
        <span class="sr-only">{{ label }}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="value ?? 0"
          :disabled="sliderDisabled"
          :aria-label="label"
          @input="queueVolume(Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <span v-if="mismatch && !error" class="player-volume-note">左右声道已按同一音量控制</span>
    </div>
  </Teleport>
</template>

<style scoped>
.player-volume-trigger {
  width: 32px; height: 32px; flex: 0 0 32px;
  display: inline-grid; place-items: center;
  border-radius: var(--v2-r-sm, 8px);
  border: 1px solid var(--v2-border-soft, #23262c);
  background: var(--v2-surf-2, #1a1d22);
  color: var(--v2-text-2, #9ba6b5);
  cursor: pointer;
  transition: color .16s ease, border-color .16s ease, background .16s ease, box-shadow .16s ease;
}
.player-volume-trigger:hover:not(:disabled),
.player-volume-trigger.active {
  color: var(--v2-primary, #408cff);
  border-color: color-mix(in srgb, var(--v2-primary, #408cff) 65%, var(--v2-border-soft, #23262c));
  background: color-mix(in srgb, var(--v2-primary, #408cff) 12%, var(--v2-surf-2, #1a1d22));
  box-shadow: 0 0 12px color-mix(in srgb, var(--v2-primary, #408cff) 18%, transparent);
}
.player-volume-trigger.muted { color: var(--v2-warning, #f59e0b); }
.player-volume-trigger:disabled { opacity: .48; cursor: not-allowed; }
.player-volume-popover {
  position: fixed; z-index: 2200;
  padding: 10px 12px 9px;
  border: 1px solid var(--v2-border-strong, #354052);
  border-radius: var(--v2-r-md, 12px);
  background: var(--v2-surf-1, #14161a);
  box-shadow: 0 14px 34px rgba(0, 0, 0, .38), inset 0 1px 0 rgba(255,255,255,.04);
  color: var(--v2-text-1, #f2f5f8);
}
.player-volume-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; font-weight: 650; }
.player-volume-value { color: var(--v2-primary, #408cff); font-variant-numeric: tabular-nums; }
.player-volume-slider { display: block; margin-top: 8px; }
.player-volume-slider input { display: block; width: 100%; height: 26px; margin: 0; accent-color: var(--v2-primary, #408cff); cursor: pointer; touch-action: none; }
.player-volume-slider input:disabled { opacity: .45; cursor: wait; }
.player-volume-state { display: flex; align-items: center; gap: 6px; min-height: 26px; margin-top: 6px; color: var(--v2-text-2, #9ba6b5); font-size: 11px; }
.player-volume-state.error { color: var(--v2-danger, #e5645d); }
.player-volume-spin { animation: player-volume-spin .9s linear infinite; }
.player-volume-retry { margin-left: auto; padding: 3px 7px; border-radius: 6px; border: 1px solid var(--v2-border-soft, #23262c); background: var(--v2-surf-2, #1a1d22); color: var(--v2-text-1, #f2f5f8); cursor: pointer; font-size: 11px; }
.player-volume-note { display: block; margin-top: 3px; color: var(--v2-text-3, #718096); font-size: 10px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
@keyframes player-volume-spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) {
  .player-volume-trigger { width: 34px; height: 34px; flex-basis: 34px; }
  .player-volume-popover { max-width: calc(100vw - 24px); }
}
</style>
