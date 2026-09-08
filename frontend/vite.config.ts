import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'path';
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

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
      // 公网直连: 跳板机 nginx 反代 erp.cnjinhu.top 过来的请求带域名 Host,
      // vite 的 DNS-rebind 防护默认只放行 IP/localhost, 域名不加白会 403。
      // 注意: 本文件变更需重启 frontend 进程才生效 (update.ps1 6c.2 哈希戳记负责, delete+start)
      allowedHosts: ['.cnjinhu.top', 'erp.cnjinhu.top'],
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
      {
        name: 'publish-deployment-version',
        apply: 'build',
        generateBundle() {
          const commit = gitOutput(['rev-parse', 'HEAD']);
          const trackedChanges = gitOutput(['status', '--porcelain', '--untracked-files=no']);
          this.emitFile({
            type: 'asset',
            fileName: 'deployment-version.json',
            source: `${JSON.stringify({
              commit,
              clean: trackedChanges === '',
              builtAt: new Date().toISOString(),
            }, null, 2)}\n`,
          });
        },
      },
      {
        name: 'publish-required-park-ops-assets',
        apply: 'build',
        writeBundle(options) {
          const sourceDir = resolve(__dirname, 'public', 'park-ops');
          const outputDir = resolve(options.dir ?? resolve(__dirname, 'dist'), 'park-ops');
          cpSync(sourceDir, outputDir, { recursive: true, force: true });

          const dashboard = resolve(outputDir, 'index.html');
          const aerial = resolve(outputDir, 'park-aerial.jpg');
          const relief = resolve(outputDir, 'park-aerial-relief.glb');
          const viewer = resolve(outputDir, 'park-ops-3d.js');
          if (!existsSync(dashboard) || !readFileSync(dashboard, 'utf8').includes('window.PARK_DEMO')) {
            throw new Error('Required park-ops dashboard was not published into the frontend build.');
          }
          if (!existsSync(aerial) || statSync(aerial).size < 100_000) {
            throw new Error('Required park-ops aerial image was not published into the frontend build.');
          }
          if (!existsSync(relief) || statSync(relief).size < 100_000 || statSync(relief).size >= 1_000_000) {
            throw new Error('Required compact park-ops GLB was not published into the frontend build.');
          }
          if (!existsSync(viewer) || !readFileSync(viewer, 'utf8').includes('static-fallback')) {
            throw new Error('Required park-ops 3D viewer was not published into the frontend build.');
          }
        },
      },
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
          importScripts: [`${SCOPE_PREFIX}/sw-privacy.js`],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,webp,ico,woff2}'],
          // C2 (2026-07-25): 离线预缓存只收业主侧 — 20+ 个后台管理页 chunk
          // (文件名含 Admin) 和只有 admin 用的 date-picker 不进每台手机的离线包。
          // admin 在线才用得上, 其 chunk 走浏览器 HTTP 缓存 (assets 带一年 immutable)。
          // 注意 admin.service (小写) 被业主侧状态页共享, 不匹配此模式, 不受影响。
          globIgnores: ['**/*Admin*', '**/el-date-picker*', 'welcome/**'],
          navigateFallback: `${SCOPE_PREFIX}/index.html`,
          navigateFallbackDenylist: [/\/api(\/|$)/, /\/ws(\/|$)/, /\/park-ops(\/|$)/],
          // Authenticated APIs must never fall back to another account's cache.
          runtimeCaching: [
            {
              urlPattern: /\/(api|media)(\/|$)/,
              handler: 'NetworkOnly',
            },
            {
              // Only application assets; never user-uploaded media.
              urlPattern: /\/(assets|icons)\/.*\.(?:png|jpg|jpeg|webp|svg|woff2?)$/,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'smart-control-static-v2',
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
