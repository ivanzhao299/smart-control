<script setup lang="ts">
// 投影仪 (slot2 = HDMI2). 2026-07-17 业主: "把投影仪页面单独摘出来" ——
// 原来它跟 LED 挤在同一页, 两块屏的控件混在一起, 现场容易推错屏。
// 播放控制逻辑跟 LED 完全一样, 共用 PlayerConsole。
//
// **刻意不传 device-id**: 查过生产硬件清单, 现场只有 LED-NOVA-1 一台 LED 控制器,
// 没有可远程切输入源的投影仪设备 (DRV-HLG-* 那些是灯带电源, 跟显示无关)。
// 传了就会摆出一排点了没用的按钮 —— 比不摆更糟。现场真接了能控的投影机之后,
// 在这儿补上它的 code 即可, 输入源栏会自动出现。
import PlayerConsole from '@/components/PlayerConsole.vue';
</script>

<template>
  <PlayerConsole :slot="2" title="投影仪" />
</template>
