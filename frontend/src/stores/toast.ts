import { defineStore } from 'pinia';
import { ref } from 'vue';

/**
 * 全局 inline toast — 不弹浮窗, 写到 header 中段空白处显示.
 *
 * 业主反馈 ElMessage 弹窗挡 header 右侧的场景 pill / 时钟, 改成 inline:
 *   - 纯文字 + 颜色, 无 box (跟时钟看齐)
 *   - 5 秒自动消失
 *   - 同时只显示 1 条 (新的覆盖旧的)
 *
 * 用法:
 *   import { useToastStore } from '@/stores/toast';
 *   const toast = useToastStore();
 *   toast.error('保存失败');
 *   toast.success('已执行');
 *
 * 跟 ElMessage 共存: 后台 admin 页面继续用 ElMessage (弹窗 OK, 后台不嫌挡),
 * 前台用户主面板报错走 toast (inline, 不挡操作区).
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: number;
  type: ToastType;
  text: string;
  expiresAt: number;
}

let _id = 0;
const DEFAULT_DURATION_MS = 5000;

export const useToastStore = defineStore('toast', () => {
  const current = ref<ToastMessage | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function show(type: ToastType, text: string, durationMs = DEFAULT_DURATION_MS): void {
    if (timer) { clearTimeout(timer); timer = null; }
    _id += 1;
    current.value = {
      id: _id,
      type,
      text,
      expiresAt: Date.now() + durationMs,
    };
    timer = setTimeout(() => { current.value = null; timer = null; }, durationMs);
  }
  function clear(): void {
    if (timer) { clearTimeout(timer); timer = null; }
    current.value = null;
  }

  return {
    current,
    show,
    success: (text: string, ms?: number) => show('success', text, ms),
    error:   (text: string, ms?: number) => show('error', text, ms),
    warning: (text: string, ms?: number) => show('warning', text, ms),
    info:    (text: string, ms?: number) => show('info', text, ms),
    clear,
  };
});
