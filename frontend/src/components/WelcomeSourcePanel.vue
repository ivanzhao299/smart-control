<script setup lang="ts">
/**
 * 输入源 · 欢迎方案明细面板（2026-10 输入源改造）。
 *
 * 只做 UI 聚合：静态默认欢迎页（LED 开机首屏 / 点「欢迎页」默认进入）+ 各欢迎方案。
 * 点「上屏」emit pick（id 为 WELCOME_PICK_DEFAULT 或具体方案 id），
 * 由 PlayerConsole 路由回 pickWelcomeSchemeById，不新增任何业务逻辑；
 * 点「编辑」emit edit（无 id 为新建），打开现有欢迎页编辑器。
 */
import { Play, Pencil, Plus, Image, Check, MonitorUp } from 'lucide-vue-next';
import { WELCOME_PICK_DEFAULT, type PlayerInputSource } from '@/features/player-input-source';
import type { WelcomeScheme } from '@/services/system-branding.service';

defineProps<{
  schemes: WelcomeScheme[];
  activeSource: PlayerInputSource | null;
  publishedSchemeId: string | null;
  busy: boolean;
  pickerBusy: boolean;
}>();

const emit = defineEmits<{
  (e: 'pick', id: string): void;
  (e: 'edit', id?: string): void;
}>();

function isDefaultActive(source: PlayerInputSource | null): boolean {
  return source === 'welcome-default';
}
function isSchemeActive(source: PlayerInputSource | null, publishedId: string | null, id: string): boolean {
  return source === 'welcome-editable' && publishedId === id;
}
</script>

<template>
  <section class="panel wsp">
    <div class="panel-head">
      <span class="panel-title"><MonitorUp :size="17" /> 欢迎方案</span>
      <span class="panel-count">{{ schemes.length + 1 }} 项</span>
      <button type="button" class="v2-quick" :disabled="busy" @click="emit('edit')">
        <Plus :size="14" /> 新建
      </button>
    </div>

    <div class="pl-list">
      <!-- 静态默认欢迎页：开机首屏 / 默认进入 -->
      <div class="pl-item ws-item" :class="{ playing: isDefaultActive(activeSource) }">
        <button
          type="button"
          class="pl-play"
          :disabled="busy || pickerBusy"
          title="上屏静态默认欢迎页"
          @click="emit('pick', WELCOME_PICK_DEFAULT)"
        >
          <Check v-if="isDefaultActive(activeSource)" :size="15" />
          <Play v-else :size="15" />
        </button>
        <span class="ws-ico"><Image :size="16" /></span>
        <span class="ws-name">
          <span class="ws-name-text">静态默认欢迎页</span>
          <span class="ws-tag default">默认首屏</span>
        </span>
        <span class="ws-state" v-if="isDefaultActive(activeSource)">已上屏</span>
      </div>

      <!-- 各欢迎方案 -->
      <div
        v-for="scheme in schemes"
        :key="scheme.id"
        class="pl-item ws-item"
        :class="{ playing: isSchemeActive(activeSource, publishedSchemeId, scheme.id) }"
      >
        <button
          type="button"
          class="pl-play"
          :disabled="busy || pickerBusy"
          :title="`上屏「${scheme.name}」`"
          @click="emit('pick', scheme.id)"
        >
          <Check v-if="isSchemeActive(activeSource, publishedSchemeId, scheme.id)" :size="15" />
          <Play v-else :size="15" />
        </button>
        <span class="ws-name">
          <span class="ws-name-text">{{ scheme.name }}</span>
          <span v-if="scheme.id === publishedSchemeId" class="ws-tag">已发布</span>
        </span>
        <span class="ws-state" v-if="isSchemeActive(activeSource, publishedSchemeId, scheme.id)">已上屏</span>
        <button
          type="button"
          class="pl-ico"
          :disabled="busy"
          :title="`编辑「${scheme.name}」`"
          @click="emit('edit', scheme.id)"
        >
          <Pencil :size="15" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 复用 PlayerConsole 的 .panel / .pl-item 视觉语言（CSS 变量同源），仅补充本面板布局 */
.wsp { min-width: 0; }
.ws-item { gap: 8px; }
.ws-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex: 0 0 auto; border-radius: var(--v2-r-sm);
  color: var(--v2-text-2); background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
}
.ws-name { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 7px; }
.ws-name-text {
  font-size: 14px; color: var(--v2-text-1);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.ws-tag {
  flex: 0 0 auto; font-size: 10px; line-height: 1; padding: 2px 7px; border-radius: 5px;
  color: var(--v2-primary); background: var(--v2-primary-soft);
}
.ws-tag.default {
  color: #d9a441; background: rgba(217, 164, 65, .14);
}
.ws-state {
  flex: 0 0 auto; font-size: 11px; color: var(--v2-primary); white-space: nowrap;
}
</style>
