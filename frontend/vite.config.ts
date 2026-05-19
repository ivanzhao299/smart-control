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
    },
  };
});
