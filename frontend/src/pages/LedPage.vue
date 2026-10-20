<script setup lang="ts">
// LED 大屏 (slot1 = HDMI1 -> 诺瓦 V2460 -> 大屏). 播放控制逻辑跟投影仪 100% 相同,
// 共用 PlayerConsole —— 抄两份必然改一处漏一处。
//
// deviceId 传诺瓦控制器的 code: 现场只有它一台 LED 控制器 (LED-NOVA-1, 192.168.50.30),
// 传了才会出现"输入源"那一栏 (业主: "工具栏页面可以切换各种输入源")。
import PlayerConsole from '@/components/PlayerConsole.vue';
</script>

<template>
  <!-- 电源分组 (2026-07-28 业主；第三十轮加固；音频矩阵共享): 页面开关 = LED 总闸(1f-led)
       + 音频矩阵主机(seq-4) + 「LED大屏功放」(seq-2，实测仍在第一台) 同开同关。
       音频矩阵与投影仪共用，故 power-keep-peers 标注「最后离开才关」：LED 关机时若投影仪
       主开关(seq-5)仍通电，矩阵保留给投影。功放改用 code 精确绑定，若以后物理移到 SEQ55，
       只需把这里的 seq-2 换成新 code。 -->
  <PlayerConsole
    :slot="1" title="LED 大屏" device-id="LED-NOVA-1" power-code="1f-led,seq-4"
    :power-amp-codes="['seq-2']"
    :power-keep-peers="[{ code: 'seq-4', peers: ['seq-5'], peerLabel: '投影仪' }]"
  />
</template>
