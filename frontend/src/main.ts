import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import 'element-plus/dist/index.css';
import './styles/theme.css';
import './styles/design-tokens.css';

/**
 * 把 <link rel="manifest"> 从 vite-plugin-pwa 生成的静态 manifest.webmanifest
 * 切到 backend 动态 endpoint, 让 icon/name/short_name 跟系统品牌 (logoUrl) 走.
 *
 * 必须在 SW register 之前替换, 否则 SW 会缓存旧 manifest URL.
 * 注意: 已经"添加到主屏幕"的 PWA, 主屏图标是装的当时缓存的, 不会自动更新.
 * 业主要把旧图标删了重新"添加到主屏幕"才能看到新 logo.
 */
function redirectManifestToBackend(): void {
  // base 是 /control/ (生产), 或 / (dev), 跟 router 一致
  const base = import.meta.env.BASE_URL ?? '/';
  const dynamicManifestUrl = `${base}api/system-branding/manifest.webmanifest`.replace(/\/+/g, '/');
  // vite-plugin-pwa 在构建时注入 <link rel="manifest"> 指向静态文件,
  // 我们替换它的 href, 但保留 link 节点 (浏览器只看 head 里第一个 manifest)
  const existing = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (existing) {
    existing.href = dynamicManifestUrl;
  } else {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = dynamicManifestUrl;
    document.head.appendChild(link);
  }
}
redirectManifestToBackend();

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
