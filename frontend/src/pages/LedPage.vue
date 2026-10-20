<script setup lang="ts">
// LED 大屏 (slot1 = HDMI1 -> 诺瓦 V2460 -> 大屏). 播放控制逻辑跟投影仪 100% 相同,
// 共用 PlayerConsole —— 抄两份必然改一处漏一处。
//
// deviceId 传诺瓦控制器的 code: 现场只有它一台 LED 控制器 (LED-NOVA-1, 192.168.50.30),
// 传了才会出现"输入源"那一栏 (业主: "工具栏页面可以切换各种输入源")。
import PlayerConsole from '@/components/PlayerConsole.vue';
</script>

<template>
  <!-- 电源分组 (2026-07-28 业主；第三十轮加固): 页面开关 = LED 总闸(1f-led) +
       「LED大屏功放」(seq-2，实测仍在第一台) 同开同关。功放改用 code 精确绑定,
       若以后物理移到 SEQ55，只需把这里的 seq-2 换成新 code。 -->
  <PlayerConsole
    :slot="1" title="LED 大屏" device-id="LED-NOVA-1" power-code="1f-led"
    :power-amp-codes="['seq-2']"
  />
</template>
