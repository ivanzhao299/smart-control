import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  fetchSystemBranding,
  saveSystemBranding,
  saveSystemBrandingVersioned,
  type SystemBranding,
  type SystemBrandingPatch,
} from '@/services/system-branding.service';

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
  welcomeMediaId: null,
  welcomeGuest: null,
  welcomeTitle: null,
  welcomeTagline: null,
  welcomeBgMediaId: null,
  configRevision: null,
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

  /**
   * 仅供有管理员编辑权限的页面调用。公共启动读取失败时的 FALLBACK 从不进入这里，
   * 因而不会把默认名称/Logo 当作可写基线覆盖服务器配置。
   */
  async function loadEditorBaseline(): Promise<SystemBranding> {
    const current = await fetchSystemBranding();
    if (!Number.isSafeInteger(current.configRevision) || (current.configRevision ?? 0) < 1) {
      throw new Error('系统配置版本不可用，请重新加载');
    }
    branding.value = current;
    loaded.value = true;
    lastError.value = null;
    applyBrowserTitle();
    applyFavicon();
    return current;
  }

  async function saveVersioned(patch: SystemBrandingPatch, expectedRevision: number): Promise<SystemBranding> {
    const confirmed = await saveSystemBrandingVersioned(patch, expectedRevision);
    if (!Number.isSafeInteger(confirmed.configRevision) || (confirmed.configRevision ?? 0) <= expectedRevision) {
      throw new Error('服务器未确认系统配置的新版本');
    }
    branding.value = confirmed;
    loaded.value = true;
    lastError.value = null;
    applyBrowserTitle();
    applyFavicon();
    return confirmed;
  }

  /** 把 browserTitle 实际写到 document.title, App.vue + 改完都调一下 */
  function applyBrowserTitle(): void {
    if (typeof document !== 'undefined' && branding.value.browserTitle) {
      document.title = branding.value.browserTitle;
    }
  }

  /**
   * 把所有 logo 相关 link 都指向 backend 的真实 HTTP 端点
   * (/control/api/system-branding/logo.png), 而不是 raw data URL.
   *
   * 为啥: data URL 在 PWA manifest / apple-touch-icon / 某些浏览器的 favicon
   * 上支持不稳定. 走真实 HTTP URL 兼容性最好, ETag 让业主换 logo 时浏览器
   * 立刻拿新图.
   *
   * 没上传 logo 时 backend logo.png 会 302 重定向到默认 PWA icon.
   */
  function applyFavicon(): void {
    if (typeof document === 'undefined') return;
    // 业主有没有上传 logo 都走这个端点 — 没上传时 backend 自己 redirect 到默认.
    // 使用服务端确认版本而非 data URL 长度：同长度换图、远程 URL 换图都必须刷新。
    const base = import.meta.env.BASE_URL ?? '/';
    const revision = Number.isSafeInteger(branding.value.configRevision)
      ? branding.value.configRevision
      : 0;
    const url = `${base}api/system-branding/logo.png?v=${revision}`.replace(/\/+/g, '/');

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

    // Android Chrome "添加到主屏幕" 用 shortcut icon
    let shortcut = document.querySelector<HTMLLinkElement>('link[rel="shortcut icon"]');
    if (!shortcut) {
      shortcut = document.createElement('link');
      shortcut.rel = 'shortcut icon';
      document.head.appendChild(shortcut);
    }
    shortcut.type = 'image/png';
    shortcut.href = url;
  }

  return {
    branding, loaded, loading, lastError,
    load, save, loadEditorBaseline, saveVersioned,
    applyBrowserTitle, applyFavicon,
  };
});
