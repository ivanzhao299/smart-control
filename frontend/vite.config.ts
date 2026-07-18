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
    // preview (生产 serve) 的缓存头按路径区分, 见下面 cache-control-by-path 插件
    // (不能用这里的 headers 选项 —— 它是全局的, 会把 index.html 也一起缓成"一年不过期")
    preview: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
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
      // 2026-07-18 根因: 之前 preview.headers 是全局的, 把 index.html / sw.js /
      // manifest.webmanifest 全都跟着 hash 化的 /assets/*.js|css 一起缓成了
      // "一年不过期、免验证" —— 结果任何浏览器只要访问过一次这个页面, 之后不管
      // 服务器上部署了多少次新代码, 都会一直吃本地那份一年前的 index.html, 连
      // "下拉刷新""换个浏览器试试"都救不了 (immutable 意味着浏览器根本不会发请求
      // 去验证是否过期)。业主反馈"不同浏览器都不行, 底栏还是在老位置"就是这个:
      // 每个浏览器第一次打开时各自缓了一份旧的, 从此各自动弹不得。
      // 同样道理, sw.js 被缓死也顺带解释了"添加到主屏幕后图标/内容不自动更新"——
      // service worker 自己的更新检测得先能拿到新版 sw.js 才谈得上生效。
      // 只有文件名带 content hash 的 /assets/* 才能安全永久缓存 (内容变化=文件名
      // 变化); index.html / manifest / sw 这些固定文件名的必须每次都找服务器验证。
      {
        name: 'cache-control-by-path',
        configurePreviewServer(server) {
          server.middlewares.use((req, res, next) => {
            const isHashedAsset = !!req.url && /\/assets\//.test(req.url);
            res.setHeader(
              'Cache-Control',
              isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
            );
            next();
          });
        },
      },
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
          // 'fullscreen' = 加到主屏后没有浏览器地址栏/工具栏, 真全屏 (业主: "手机访问
          // 前端的时候要默认全屏状态, 有产品级全屏效果")。
          display: 'fullscreen',
          // 2026-07-17 去掉 orientation: 'landscape'。
          // 原来锁死横屏 —— 手机竖着拿会被强行横过来, 而 MainLayout 里那套手机竖屏
          // 底栏布局 (600px 断点: 侧栏变底栏 + 安全区) 就此完全用不上, 白做。
          // 业主要"横屏、竖屏模式下功能图标分布要科学美观" -> 两种都得让它自然发生。
          // 主控机是横屏大屏, 本来也不靠这个字段锁。
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
          // PERFORMANCE_AUDIT P0-#5: API GET 走 NetworkFirst, 弱网时 3s 内
          // 没返回就降级用 60s 内的 cache, 后台 silent revalidate.
          // POST/PUT/DELETE 默认不缓存 (workbox 行为), 不会影响命令.
          runtimeCaching: [
            {
              urlPattern: /\/api\/(devices|scenes|hardware|drivers|system\/info|system\/runtime|light-zones|power-circuits|brands|system-branding)/,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'api-read',
                networkTimeoutSeconds: 2,   // 旧 3s → 2s, 弱网更快降级
                expiration: {
                  maxEntries: 80,
                  maxAgeSeconds: 60,
                },
              },
            },
            {
              // 媒体缩略图 / 静态资源 stale-while-revalidate
              urlPattern: /\/(media|assets|icons)\/.*\.(?:png|jpg|jpeg|webp|svg|woff2?)$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'static-assets',
                expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 3600 },
              },
            },
          ],
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
              // axios 现在只 MediaPage 用 (P1-#10 主路径已迁 fetch),
              // 不再 manualChunk, 走 MediaPage 的 lazy chunk 一起延后加载.
              // Element Plus 走默认 (Vite auto chunk 已经按组件 tree-shake) —
              // 实测手动 manualChunks 把 EP 全合一会爆 682 KB, 比自动差.
              return undefined;
            }
            return undefined;
          },
        },
      },
    },
  };
});
