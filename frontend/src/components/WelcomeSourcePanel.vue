<script setup lang="ts">
/**
 * 输入源 · 欢迎方案明细面板（2026-10 输入源改造）。
 *
 * 只做 UI 聚合：系统默认欢迎页（LED 开机首屏 / 点「欢迎页」默认进入）+ 各欢迎方案。
 * 点「上屏」emit pick（id 为 WELCOME_PICK_DEFAULT 或具体方案 id），
 * 由 PlayerConsole 路由回 pickWelcomeSchemeById，不新增任何业务逻辑；
 * 点「编辑」emit edit（无 id 为新建），打开现有欢迎页编辑器。
 */
import { Play, Pencil, Plus, Image, Check, MonitorUp } from 'lucide-vue-next';
import {
  WELCOME_DEFAULT_SCHEME_ID,
  WELCOME_DEFAULT_SCHEME_NAME,
  WELCOME_PICK_DEFAULT,
  type PlayerInputSource,
} from '@/features/player-input-source';
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

function isDefaultActive(source: PlayerInputSource | null, publishedId: string | null): boolean {
  return source === 'welcome-default'
    || (source === 'welcome-editable' && publishedId === WELCOME_DEFAULT_SCHEME_ID);
}
function isSchemeActive(source: PlayerInputSource | null, publishedId: string | null, id: string): boolean {
  return id !== WELCOME_DEFAULT_SCHEME_ID && source === 'welcome-editable' && publishedId === id;
}
function schemeCount(schemes: WelcomeScheme[]): number {
  return schemes.some((scheme) => scheme.id === WELCOME_DEFAULT_SCHEME_ID)
    ? schemes.length
    : schemes.length + 1;
}
</script>

<template>
  <section class="panel wsp">
    <div class="panel-head">
      <span class="panel-title"><MonitorUp :size="17" /> 欢迎方案</span>
      <span class="panel-count">{{ schemeCount(schemes) }} 项</span>
      <button type="button" class="v2-quick" :disabled="busy" @click="emit('edit')">
        <Plus :size="14" /> 新建
      </button>
    </div>

    <div class="pl-list">
      <!-- 系统默认欢迎页：开机首屏 / 默认进入，可复用欢迎方案编辑器 -->
      <div class="pl-item ws-item" :class="{ playing: isDefaultActive(activeSource, publishedSchemeId) }">
        <button
          type="button"
          class="pl-play"
          :disabled="busy || pickerBusy"
          title="上屏默认欢迎页"
          @click="emit('pick', WELCOME_PICK_DEFAULT)"
        >
          <Check v-if="isDefaultActive(activeSource, publishedSchemeId)" :size="15" />
          <Play v-else :size="15" />
        </button>
        <span class="ws-ico"><Image :size="16" /></span>
        <span class="ws-name">
          <span class="ws-name-text">{{ WELCOME_DEFAULT_SCHEME_NAME }}</span>
          <span class="ws-tag default">默认首屏 · 可编辑</span>
        </span>
        <span class="ws-state" v-if="isDefaultActive(activeSource, publishedSchemeId)">已上屏</span>
        <button
          type="button"
          class="pl-ico"
          :disabled="busy"
          title="编辑默认欢迎页"
          @click="emit('edit', WELCOME_DEFAULT_SCHEME_ID)"
        >
          <Pencil :size="15" />
        </button>
      </div>

      <!-- 各欢迎方案 -->
      <div
        v-for="scheme in schemes.filter((item) => item.id !== WELCOME_DEFAULT_SCHEME_ID)"
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
/* 本组件是独立 scoped 组件，拿不到 PlayerConsole 的 scoped 样式，
   因此把容器/列表/列表项/按钮样式完整定义为组件自包含（2026-10 列表化修复）。 */

/* 容器卡片 */
.panel.wsp {
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
  border-radius: var(--v2-r-lg); padding: 12px;
  background: var(--v2-surf-1, #14161A); border: 1px solid var(--v2-border-soft);
}
.panel-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.panel-title {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 15px; font-weight: 700; color: var(--v2-text-1);
}
.panel-count {
  font-size: 12px; color: var(--v2-text-2);
  background: var(--v2-surf-2); border-radius: 20px; padding: 2px 8px;
}
.panel-head .v2-quick { margin-left: auto; }

/* 列表：每行一个方案，纵向排列 */
.pl-list {
  display: flex; flex-direction: column; gap: 6px;
  min-width: 0; min-height: 0;
}
.pl-item.ws-item {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding: 8px 10px; border-radius: var(--v2-r-md);
  background: var(--v2-surf-2, #1A1D22); border: 1px solid transparent;
}
.pl-item.ws-item.playing {
  border-color: var(--v2-primary);
  background: color-mix(in srgb, var(--v2-primary) 14%, var(--v2-surf-1));
}

/* 上屏按钮（左） */
.pl-play {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex: 0 0 auto; border-radius: var(--v2-r-sm);
  cursor: pointer; background: transparent;
  border: 1px solid var(--v2-border-soft); color: var(--v2-text-1);
}
.pl-play:hover:not(:disabled) { color: var(--v2-primary); border-color: var(--v2-primary); }
.pl-play:disabled { opacity: .35; cursor: not-allowed; }
.pl-item.playing .pl-play {
  color: var(--v2-primary); background: var(--v2-primary-soft);
  border-color: color-mix(in srgb, var(--v2-primary) 45%, var(--v2-border-soft));
}

/* 编辑按钮（右） */
.pl-ico {
  display: inline-flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; flex: 0 0 auto; border-radius: var(--v2-r-sm);
  cursor: pointer; background: transparent; border: none; color: var(--v2-text-2);
}
.pl-ico:hover:not(:disabled) { color: var(--v2-text-1); }
.pl-ico:disabled { opacity: .3; cursor: not-allowed; }

/* 系统默认欢迎页的图标 */
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
  flex: 0 0 auto; font-size: 11px; color: var(--v2-primary); white-space:nowrap;
}
</style>
