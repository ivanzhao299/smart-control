import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // 加载 .env.production / .env.local / .env 文件 (Vite 不会自动注入 process.env)
  const env = loadEnv(mode, process.cwd(), '');
  const PUBLIC_BASE = env.VITE_PUBLIC_BASE ?? '/';
  const SCOPE = PUBLIC_BASE.replace(/\/+$/, '') || '/';
  const SCOPE_PREFIX = SCOPE === '/' ? '' : SCOPE; // 给 manifest icon path 用
  const apiTarget = process.env.VITE_PROXY_API ?? 'http://localhost:3000';

  return {
    base: PUBLIC_BASE,
    resolve: {
      alias: { '@': resolve(__dirname, 'src') },
    },
    // preview (生产 serve) 加缓存头让 PWA 资源走浏览器缓存
    preview: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      headers: {
        // hash 化的 assets 永久缓存 (vite 文件名带 hash, 改动会换名)
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/ws': {
          target: apiTarget.replace(/^http/, 'ws'),
          ws: true,
          changeOrigin: true,
        },
      },
    },
    plugins: [
      vue(),
      AutoImport({ resolvers: [ElementPlusResolver()] }),
      Components({ resolvers: [ElementPlusResolver()] }),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/pwa-192x192.png', 'icons/pwa-512x512.png', 'icons/app.svg'],
        manifest: {
          name: '金湖展贸中心智能控制系统',
          short_name: '金湖中控',
          description: '金湖展贸中心 — 展厅自动化中控平板界面',
          theme_color: '#111827',
          background_color: '#111827',
          display: 'fullscreen',
          orientation: 'landscape',
          start_url: `${SCOPE_PREFIX}/`,
          scope: `${SCOPE_PREFIX}/`,
          icons: [
            {
              src: `${SCOPE_PREFIX}/icons/pwa-192x192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any maskable',
            },
            {
              src: `${SCOPE_PREFIX}/icons/pwa-512x512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          navigateFallback: `${SCOPE_PREFIX}/index.html`,
          navigateFallbackDenylist: [/\/api(\/|$)/, /\/ws(\/|$)/],
        },
        devOptions: { enabled: false },
      }),
    ],
    build: {
      target: 'es2022',
      sourcemap: false,
      chunkSizeWarningLimit: 1500,
      cssCodeSplit: true,
      minify: 'esbuild',
      // 不要手动 chunk Element Plus — 它的 auto-import 已 tree-shaking 到组件级 lazy load
      // 只切核心 vendor + lucide 让缓存复用 (业务改不影响这些)
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules')) {
              if (id.includes('lucide-vue-next')) return 'lucide';
              if (/[\\/](vue|vue-router|pinia|@vue)[\\/]/.test(id)) return 'vue-core';
              if (id.includes('axios')) return 'axios';
              // 其余 (包括 Element Plus) 走默认: 按组件懒加载, 自动 tree-shake
              return undefined;
            }
            return undefined;
          },
        },
      },
    },
  };
});
