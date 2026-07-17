<script setup lang="ts">
// LED 大屏 (slot1 = HDMI1 -> 诺瓦 V2460 -> 大屏). 播放控制逻辑跟投影仪 100% 相同,
// 共用 PlayerConsole —— 抄两份必然改一处漏一处。
import PlayerConsole from '@/components/PlayerConsole.vue';
</script>

<template>
  <PlayerConsole :slot="1" title="LED 大屏" />
</template>
