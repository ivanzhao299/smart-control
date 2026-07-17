<script setup lang="ts">
// 投影仪 (slot2 = HDMI2). 2026-07-17 业主: "把投影仪页面单独摘出来" ——
// 原来它跟 LED 挤在同一页, 两块屏的控件混在一起, 现场容易推错屏。
// 播放控制逻辑跟 LED 完全一样, 共用 PlayerConsole。
import PlayerConsole from '@/components/PlayerConsole.vue';
</script>

<template>
  <PlayerConsole :slot="2" title="投影仪" />
</template>
