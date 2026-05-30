import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchSystemBranding, saveSystemBranding, type SystemBranding, type SystemBrandingPatch } from '@/services/system-branding.service';

/**
 * 系统品牌 store — App 启动时 load() 一次, 全局 reactive 复用.
 *
 * 默认值跟 backend service 里的 DEFAULTS 保持一致. 这样网络挂了 (e.g. backend
 * 没起来 / API 502) 时, 前台仍显示合理品牌而不是空白. backend 起来后下一次
 * load() 会被覆盖到实际配置.
 */

const FALLBACK: SystemBranding = {
  systemName: '金湖展贸中心 · 智能控制',
  systemSubtitle: '智慧展厅中控',
  logoText: '金',
  logoUrl: null,
  browserTitle: '金湖展贸中心 控制系统',
  copyright: null,
};

export const useSystemBrandingStore = defineStore('system-branding', () => {
  const branding = ref<SystemBranding>({ ...FALLBACK });
  const loaded = ref(false);
  const loading = ref(false);
  const lastError = ref<string | null>(null);

  async function load(force = false): Promise<void> {
    if (loaded.value && !force) return;
    loading.value = true;
    lastError.value = null;
    try {
      branding.value = await fetchSystemBranding();
      loaded.value = true;
      applyBrowserTitle();
    } catch (e) {
      lastError.value = (e as Error).message;
      // 保留 FALLBACK, 不抛, 避免 App 起不来
    } finally {
      loading.value = false;
    }
  }

  async function save(patch: SystemBrandingPatch): Promise<void> {
    branding.value = await saveSystemBranding(patch);
    loaded.value = true;
    applyBrowserTitle();
  }

  /** 把 browserTitle 实际写到 document.title, App.vue + 改完都调一下 */
  function applyBrowserTitle(): void {
    if (typeof document !== 'undefined' && branding.value.browserTitle) {
      document.title = branding.value.browserTitle;
    }
  }

  return { branding, loaded, loading, lastError, load, save, applyBrowserTitle };
});
