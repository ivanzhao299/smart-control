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
      applyFavicon();
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
    applyFavicon();
  }

  /** 把 browserTitle 实际写到 document.title, App.vue + 改完都调一下 */
  function applyBrowserTitle(): void {
    if (typeof document !== 'undefined' && branding.value.browserTitle) {
      document.title = branding.value.browserTitle;
    }
  }

  /**
   * 把 logoUrl 同步到 <link rel="icon"> 和 <link rel="apple-touch-icon">.
   *
   * 业主上传的 logo (256×256 PNG) 当 favicon 用 — 这样:
   *   - 浏览器 tab 上的图标 = 业主 logo
   *   - 平板"添加到主屏幕"的图标 = 业主 logo
   *   - iOS Home Screen 用 apple-touch-icon
   *
   * 没上传 logo 时 (logoUrl=null) 保留 index.html 里的默认 SVG / PWA icon.
   */
  function applyFavicon(): void {
    if (typeof document === 'undefined') return;
    const url = branding.value.logoUrl;
    if (!url) return; // 没上传就用 index.html 默认

    // 标准 favicon
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!icon) {
      icon = document.createElement('link');
      icon.rel = 'icon';
      document.head.appendChild(icon);
    }
    icon.type = 'image/png';
    icon.href = url;

    // iOS / iPadOS "添加到主屏幕"
    let appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
      appleIcon = document.createElement('link');
      appleIcon.rel = 'apple-touch-icon';
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = url;

    // Android Chrome "添加到主屏幕" 用 shortcut icon, 跟 favicon 同一份
    let shortcut = document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
    if (!shortcut) {
      shortcut = document.createElement('link');
      shortcut.rel = 'shortcut icon';
      document.head.appendChild(shortcut);
    }
    shortcut.type = 'image/png';
    shortcut.href = url;
  }

  return { branding, loaded, loading, lastError, load, save, applyBrowserTitle, applyFavicon };
});
