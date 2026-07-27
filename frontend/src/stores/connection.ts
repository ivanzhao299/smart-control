import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/**
 * 服务器连通状态 store — 汇聚 http.ts 的每请求连通性报告.
 *
 * 判定: 连续 >= 2 次网络层失败 → offline (单次失败可能是超时抖动, 不弹窗).
 * 任何一次成功 (拿到 HTTP 响应) → 立刻恢复 online.
 *
 * MainLayout 挂载时把 report() 注册进 setConnectivityListener,
 * 并 watch online: true→false 沿触发服务器设置弹窗 (每次断线只自动弹一次).
 */
/**
 * 2026-07-27 加固 (业主: "PWA 频繁被踢回服务器设置页"): 2 → 3。
 * iPhone 息屏/切后台回来的 1-2 秒里 Wi-Fi 还没重连好, 切页时并发发出的
 * 两三个请求全失败 —— 阈值 2 一碰就 offline, 服务器设置弹窗跟着自动弹,
 * 业主感觉"被踢出来"。3 次 + MainLayout 侧 8s 持续复核双闸后, 瞬断不再弹。
 */
const OFFLINE_THRESHOLD = 3;

export const useConnectionStore = defineStore('connection', () => {
  const consecutiveFails = ref(0);
  const lastFailAt = ref<number | null>(null);

  const online = computed(() => consecutiveFails.value < OFFLINE_THRESHOLD);

  function report(ok: boolean): void {
    if (ok) {
      consecutiveFails.value = 0;
      return;
    }
    consecutiveFails.value += 1;
    lastFailAt.value = Date.now();
  }

  /** 换完地址 / 手动重试前调, 清掉失败计数避免立刻再弹窗 */
  function reset(): void {
    consecutiveFails.value = 0;
  }

  return { online, consecutiveFails, lastFailAt, report, reset };
});
