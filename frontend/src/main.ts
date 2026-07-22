import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import 'element-plus/dist/index.css';
import './styles/theme.css';
import './styles/design-tokens.css';
import './styles/industrial-hardening.css';
import { initTheme } from './services/theme.service';

// 主题必须在 mount 之前应用, 否则会先渲染一帧深色再跳浅色 (闪一下)
initTheme();

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

/**
 * 禁双指/双击缩放 (iOS Safari 13+ 兜底)
 *
 * iOS Safari 13+ 故意无视 user-scalable=no (帮助残障人士), 但 PWA standalone 模式
 * 仍尊重. 不过业主可能在浏览器访问 URL, 那种情况下要靠下面这些 JS 才能彻底禁:
 *
 * - gesturestart/change/end: Safari 专属手势事件, 双指缩放从这里开始 → 直接吃掉
 * - touchstart 多指: Android Chrome / 通用浏览器 → 多于 1 指就吃
 * - dblclick / 双击 touchend: 双击 zoom
 *
 * passive: false 必须的, 否则 preventDefault 不生效.
 */
function disableZoom(): void {
  const opts: AddEventListenerOptions = { passive: false };
  // Safari 手势事件 (双指缩放)
  document.addEventListener('gesturestart', (e) => e.preventDefault(), opts);
  document.addEventListener('gesturechange', (e) => e.preventDefault(), opts);
  document.addEventListener('gestureend', (e) => e.preventDefault(), opts);

  // 多指 touch 通杀 (Android / Firefox 等没有 gesture 事件的)
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, opts);
  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, opts);

  // 双击 zoom (旧 iOS Safari)
  let lastTap = 0;
  document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 320) e.preventDefault();
    lastTap = now;
  }, opts);

  // Ctrl+滚轮 / Cmd+加减 (桌面浏览器调试时也禁)
  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, opts);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) {
      e.preventDefault();
    }
  });

  // 触屏长按卡片 (尤其场景卡长按激活) 会弹出浏览器右键/上下文菜单, 干扰操作 —
  // 全局禁掉, 覆盖所有页面所有卡片.
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // 工业终端: 禁元素拖拽 (图片/链接/文本被拖出或拖动), 防误操作把界面拖乱
  document.addEventListener('dragstart', (e) => e.preventDefault());
}
disableZoom();

/**
 * 白屏看门狗 — 工业终端最后防线
 *
 * #app 挂载后正常应一直有子节点; 若整个应用崩溃导致根节点清空且持续 >8s,
 * 自动 reload 恢复. sessionStorage 限流: 连续 3 次重载仍白屏就停手 (持久
 * 故障别无限刷, 留白屏让现场维护介入), 一旦恢复正常立即清零计数.
 */
function startBlankScreenWatchdog(): void {
  const appEl = document.getElementById('app');
  if (!appEl) return;
  const KEY = 'sc.watchdog.reloads';
  let blankSince = 0;
  window.setInterval(() => {
    const blank = appEl.childElementCount === 0;
    if (!blank) {
      blankSince = 0;
      if (sessionStorage.getItem(KEY)) sessionStorage.removeItem(KEY);
      return;
    }
    if (blankSince === 0) {
      blankSince = Date.now();
    } else if (Date.now() - blankSince > 8000) {
      const n = Number(sessionStorage.getItem(KEY) ?? '0');
      if (n < 3) {
        sessionStorage.setItem(KEY, String(n + 1));
        window.location.reload();
      }
    }
  }, 3000);
}

const app = createApp(App);

// 工业终端健壮性: Vue 层 + JS 层错误兜底 (跟 ErrorBoundary + 白屏看门狗 配合)
app.config.errorHandler = (err, _instance, info) => {
  // eslint-disable-next-line no-console
  console.error('[Vue errorHandler]', info, err);
};
window.addEventListener('unhandledrejection', (e) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledrejection]', e.reason);
});

app.use(createPinia());
app.use(router);
app.mount('#app');

// 白屏看门狗: 应用挂载后启动
startBlankScreenWatchdog();
