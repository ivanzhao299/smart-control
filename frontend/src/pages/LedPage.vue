<script setup lang="ts">
// LED 大屏 (slot1 = HDMI1 -> 诺瓦 V2460 -> 大屏). 播放控制逻辑跟投影仪 100% 相同,
// 共用 PlayerConsole —— 抄两份必然改一处漏一处。
//
// deviceId 传诺瓦控制器的 code: 现场只有它一台 LED 控制器 (LED-NOVA-1, 192.168.50.30),
// 传了才会出现"输入源"那一栏 (业主: "工具栏页面可以切换各种输入源")。
import PlayerConsole from '@/components/PlayerConsole.vue';
</script>

<template>
  <!-- 分阶段电源编排（第三十六轮按现场接线图严格定序，视频源未就绪绝不送屏电）:
       开机 ① 第一时间开 LED 视频服务器(seq55-6，诺瓦 V2460) → ② 约15s时先开音频矩阵(seq-4)，再间隔3s开 LED功放(seq-2) →
       ③ 应用层持续探活，直到核心设备真实上线并稳定响应；等待时间以现场实际为准，不设置固定超时 →
       ④ 锁定视频路径并开 LED 屏体总闸(1f-led)，
       确保屏体一开就有图像和声音；关机逆向（屏→功放/矩阵→诺瓦）。
       音频矩阵与投影仪共用，power-keep-peers 标注「最后离开才关」：LED 关机时若投影仪
       主开关(seq-5)仍通电，矩阵保留给投影。 -->
  <PlayerConsole
    :slot="1" title="LED 大屏" device-id="LED-NOVA-1" power-code="1f-led,seq-4"
    :power-amp-codes="['seq-2']"
    :power-keep-peers="[{ code: 'seq-4', peers: ['seq-5'], peerLabel: '投影仪' }]"
    :power-boot-plan="{
      preheatCodes: ['seq55-6'],
      ampStageCodes: ['seq-4', 'seq-2'],
      screenStageCodes: ['1f-led'],
      readyKind: 'led',
      initialDelaySec: 0,
      pollIntervalSec: 1,
      settleSec: 2,
      confirmIntervalSec: 1,
      ampStartDelaySec: 15,
      ampStageGapSec: 3,
      stageGapMs: 0,
    }"
  />
</template>
