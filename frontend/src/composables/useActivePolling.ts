import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue';

/**
 * keep-alive 页面的轮询生命周期 (2026-07-27 "切页卡顿"根治)。
 *
 * 根因: MainLayout 用 <keep-alive :max="10"> 缓存功能页, 页面切走时只触发
 * onDeactivated —— onUnmounted **永远不来** (除非被挤出缓存)。而各页的轮询
 * 定时器都只在 onUnmounted/onBeforeUnmount 清理, 于是逛过一圈后: 电源页 5s、
 * 投影页 8s、空调页与音响页 8s 递归轮询、状态页 10s、首页 30s……全部在后台
 * 永续运行, 每轮 fetch + 响应式重渲染把主线程周期性打断, 切页动画正好撞上
 * 就是"卡顿/不丝滑"; 同时还在持续骚扰脆弱的单客户端设备网关。
 *
 * 用法: useActivePolling(start, stop)
 *   - 进入页面 (首次 mount 和每次从缓存激活) 调 start
 *   - 切走 (deactivated) 和真正销毁 (beforeUnmount, 缓存被挤出) 调 stop
 *   - start/stop 必须**幂等**: keep-alive 下首次进入 mounted 和 activated
 *     都会触发, start 会被连调两次。
 */
export function useActivePolling(start: () => void, stop: () => void): void {
  onMounted(start);      // 非 keep-alive 场景兜底 (activated 不触发)
  onActivated(start);
  onDeactivated(stop);
  onBeforeUnmount(stop); // 被挤出缓存/整页销毁时的最终清理
}
