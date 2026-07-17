<script setup lang="ts">
// LED 大屏 (slot1 = HDMI1 -> 诺瓦 V2460 -> 大屏). 播放控制逻辑跟投影仪 100% 相同,
// 共用 PlayerConsole —— 抄两份必然改一处漏一处。
//
// deviceId 传诺瓦控制器的 code: 现场只有它一台 LED 控制器 (LED-NOVA-1, 192.168.50.30),
// 传了才会出现"输入源"那一栏 (业主: "工具栏页面可以切换各种输入源")。
import PlayerConsole from '@/components/PlayerConsole.vue';
</script>

<template>
  <PlayerConsole :slot="1" title="LED 大屏" device-id="LED-NOVA-1" />
</template>
