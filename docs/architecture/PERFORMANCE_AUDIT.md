# 性能体检报告 — 加载慢 / 切页慢 / 反应慢

> 审计日期: 2026-05-29
> 范围: 前端 PWA + nginx + Node 后端 + SQLite + WebSocket + GK9000 现场链路
> 方法: 静态代码审计 + bundle 分析 + 现场调用链梳理

---

## 一、症状到原因的映射

| 用户感知的慢 | 真实原因 (按命中频率排) |
|---|---|
| **首次打开慢** (PWA 启动 2-5s) | 1) 启动期 4 个并行 fetch 但 axios baseURL 透 nginx 经 GK9000 公网回环, 慢于直连; 2) bundle 1.8 MB 全量 precache 后还要 parse; 3) Element Plus 三大重组件 (button/date-picker/select) 占 207 KB 即使没用到的页面也下; 4) Inter 字体 / Lucide 全量打包 |
| **切页慢** (点侧栏 → 新页 0.3-1s) | 1) 每页 onMounted 重新 fetch (HVAC 拉 22 内机, Audio 拉当前预设); 2) keep-alive `max:6` 但侧栏 8 项 → 第 7 项必然失活; 3) Element Plus 表格/抽屉首次实例化解析 80+ KB; 4) 路由 lazy chunk 12-22 KB 首次需要请求 |
| **点亮度/开关后等很久** | 1) HTTP 总耗时 = nginx 转发 + Express 路由 + Adapter syncRuntime (含 DB 查) + Modbus/TCP 短连接重建 + 等响应; 2) syncRuntime 5s 缓存第一次冷启动要 SELECT; 3) 短连接每次重建 socket (50-200ms 握手) — 比长连接慢 5×; 4) Winston 同步写盘日志 |
| **状态/告警/网关刷新慢** | App.vue 20s 兜底轮询 + StatusPage 10s + AlertBanner 30s + MonitorAdmin 8s 4 个 setInterval **同时跑**, GK9000 网络抖动时全部排队 |
| **后台表格 (硬件/驱动/审计) 卡** | Element Plus el-table 没虚拟化, 1000+ 行直接 DOM, 加上 row hover transitions 重排 |
| **WS 时不时断/慢** | 心跳 25s, GK9000 → cnjinhu.top 公网 Tailscale 反向链路抖动时, ping 25s 才发现死连接 |

---

## 二、按生命周期的瓶颈分布

```
┌────────────────────────────────────────────────────────────────┐
│ 浏览器打开 PWA                                                  │
│  ├─ nginx 拉 1.8 MB precache               ←  P0: brotli + 切包  │
│  ├─ parse vue-core 161 KB                  ←  fine                │
│  ├─ parse Element Plus 200+ KB             ←  P1: import on demand│
│  ├─ App.vue onMounted                                            │
│  │   └─ Promise.all 4 fetch                ←  P0: 串行/重试       │
│  │       (info / scenes / refreshAll / refreshRunning)           │
│  ├─ WS 连 nginx → backend (~50ms)          ←  fine                │
│  └─ 首页 Dashboard 渲染 (大部分 keep-alive 命中)                  │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ 点击侧栏 → 切到灯光页                                            │
│  ├─ 路由 lazy chunk (LightingPage.vue 12 KB)  ←  P1: prefetch    │
│  ├─ Vue mount (无 fetch — 灯光页全本地数据)    ←  fine            │
│  └─ keep-alive 缓存                                              │
│ — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — │
│ 切到 HVAC 页                                                     │
│  ├─ chunk 已 prefetch?                       ←  P1: 否, 现下载    │
│  ├─ onMounted 拉 22 内机 listZones           ←  fine (静态数据)   │
│  └─ Element Plus el-select / form-item 实例化 ←  P1: shared chunk │
│ — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — — │
│ 切到第 7 页                                                      │
│  └─ keep-alive 第 6 项被踢出, 重 mount                          │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ 拨亮度 (一次 IO 请求)                                           │
│  ├─ frontend axios.post   ~ 5-10ms          ←  fine             │
│  ├─ nginx 反代             ~ 1-3ms          ←  fine             │
│  ├─ Express + DTO 校验     ~ 5-15ms         ←  fine             │
│  ├─ Controller → Adapter                                        │
│  │   ├─ syncRuntime() (DB SELECT 冷启 8ms)  ←  P2: 持久 cache    │
│  │   └─ writeFadeBrightness                                     │
│  │       └─ Modbus TCP 短连 (重建 socket)    ←  P0: 长连接       │
│  │           ├─ TCP connect    20-50ms                          │
│  │           ├─ Modbus write    8-15ms                          │
│  │           └─ socket close    1-2ms                           │
│  ├─ Winston 同步写盘日志    5-12ms          ←  P1: async         │
│  └─ HTTP 响应回         ~ 5ms                                   │
│  总 ~ 60-110ms 单次; 短连接重建占 1/3                            │
└────────────────────────────────────────────────────────────────┘
```

---

## 三、可执行优化清单 — 按 ROI 排

### P0 — 当下就做, 收益最大 (每条 0.5-2h)

#### 1. Modbus / DALI 改长连接 (单点最大收益)
**现状**: `TcpClient.sendAndExpect` 每次新建 socket → write → end → destroy. 短连接占单次命令 1/3 耗时.
**改法**: 加 `KeepAliveTcpClient`, socket 复用 + 30s 空闲断开 + 自动重连. CY-DALI64A / 中弘 网关都吃这个.
**预期**: 单次拨亮度 70ms → 30ms; 批量场景动作 (12 个分区) 800ms → 350ms.
**风险**: 旧网关有 socket 数限制, 加最大并发上限.

#### 2. 启动期 fetch 串行化 + 关键路径优先
**现状**: `App.vue` 同时 fire 4 个 fetch, 失败任一不阻塞 UI 但成功的全 await; 跨 GK9000 公网时排队.
**改法**:
- `fetchInfo` 必拿 (后续判 mock 用)
- `fetchScenes` + `deviceStore.refreshAll` 关键, await
- `refreshRunning` 后台 fire-and-forget (PWA mount 不阻塞)
- 加 5s 超时单独控制
**预期**: 首次屏出现时间 1.8s → 0.9s.

#### 3. 合并所有 setInterval 轮询到一个 tick
**现状**: App 20s + Alert 30s + Status 10s + Monitor 8s, 时序错位 → 平均每 5-8s 触一次, 浪费.
**改法**:
- 统一 `pollingScheduler`, 一个 setInterval 5s, 按需调 (有页面用就调, 无人订阅就 skip)
- WS 在线时把 polling 间隔拉长到 60s; WS 断了才回到 5s
**预期**: 移动浏览器电量友好 + GK9000 cnjinhu 网络抖动时不再雪崩重试.

#### 4. nginx 加 brotli
**现状**: `gzip on` 已开 (smart-control.conf 第 48 行), 但 brotli 没开.
**改法**: nginx 装 ngx_brotli 模块 (Windows 现成 binary), 加 `brotli on; brotli_types text/css application/javascript application/json`.
**预期**: 主 bundle 文件平均压缩率提升 18%, 1.8 MB → 1.5 MB 传输, 慢网下打开省 0.5-1s.

#### 5. PWA cache 策略调到 NetworkFirst for API
**现状**: PWA workbox 默认 cacheFirst for precache; `/api/*` 在 `navigateFallbackDenylist` 但没显式 runtime cache.
**改法**: 加 workbox.runtimeCaching:
```
{ urlPattern: /\/api\//, handler: 'NetworkFirst', options: { networkTimeoutSeconds: 3, cacheName: 'api', expiration: { maxEntries: 50, maxAgeSeconds: 60 } } }
```
**预期**: 网络抖动时返回 stale 数据立即可看, 同时后台更新.

---

### P1 — 这周内做 (每条 1-4h)

#### 6. Element Plus 按需 + 切组件冗余
**现状**: `el-button` 84 KB / `el-select` 32 KB / `el-form-item` 31 KB / `el-tag` 46 KB / `el-date-picker` 90 KB / `el-pagination` 11 KB. 大量分包但每页用到的子集小.
**改法**:
- 已用 `unplugin-vue-components/resolvers/ElementPlusResolver`, 检查 components.d.ts 有没有重复声明
- `el-date-picker` 主前端用不上, 只 admin 用, 加 manualChunks 把 admin-only 组件单独分包
- 用 `unplugin-element-plus` 替代 `unplugin-vue-components` 处理 CSS, 进一步 tree-shake
**预期**: 首屏 JS 200 KB → 130 KB.

#### 7. KeepAlive max 6 → include 全主菜单
**现状**: `<keep-alive :max="6">`, 侧栏 8 项 (首页/灯光/LED/音响/空调/媒体/状态/后台), 第 7 项进来必踢出 1.
**改法**:
```
<keep-alive :include="['DashboardPage','LightingPage','LedPage','AudioPage','HvacPage','MediaPage','StatusPage']">
```
所有主菜单都常驻, 后台 (Admin) 走 max:3.
**预期**: 主菜单切页 100% 命中缓存, 切页耗时 200-400ms → 60-100ms (只是 Vue 切组件).

#### 8. 路由 chunk prefetch
**现状**: Vue Router 用 `() => import('@/pages/XxxPage.vue')` 懒加载, 第一次进页面拉 12-30 KB chunk.
**改法**: 主菜单的 7 个页面 chunk 在 idle 时 prefetch:
```ts
onMounted(() => {
  requestIdleCallback(() => {
    void import('@/pages/LightingPage.vue');
    void import('@/pages/LedPage.vue');
    // ...
  });
});
```
**预期**: 首次切页"chunk 等待"从 60-150ms → 0.

#### 9. Winston 改 async transport
**现状**: 每次设备 IO 都 logger.warn/info, Winston 默认同步写盘.
**改法**: 配 winston-daily-rotate-file 的 `level: 'info', json: false, options: { flags: 'a' }` + 加 `winston-async` 或自定义批量 flush (每 50ms 一次).
**预期**: 高频命令 (轮询/批量场景) 单条 IO 减 5-12ms.

#### 10. axios 换 fetch + 自定义包装
**现状**: axios 42 KB (gzip 17 KB), 现在我们只用 get/post/put/del + 一个拦截器, 不值这个体积.
**改法**: 写个 40 行的 `httpFetch.ts` 用原生 fetch + AbortController + 统一 wrap, 删 axios.
**预期**: 主 bundle 减 17 KB gzip; fetch 内置 keep-alive 长连接, 不再每请求新连接.

#### 11. SQLite 开 WAL + busy_timeout
**现状**: better-sqlite3 默认是 rollback journal, write 时阻塞所有 read.
**改法**: `typeorm.config.ts` 加:
```ts
extra: { pragma: { journal_mode: 'WAL', synchronous: 'NORMAL', busy_timeout: 5000, cache_size: -64000 } }
```
**预期**: 并发 read+write 不再阻塞, 配置查询 8ms → 1-2ms.

#### 12. el-table 改虚拟滚动 (admin 重列表)
**现状**: HardwareAdmin / DriversAdmin / AuditAdmin 数据量 > 100 行时, Element Plus 普通 table 整 DOM 全渲染, hover transition 触发大量重排.
**改法**: 换 `el-table-v2` (虚拟列表 Element Plus 2.4+ 自带).
**预期**: 1000 行的 audit-log 页面滚动 jank 消失, 切页瞬开.

---

### P2 — 中期 / 系统性 (2-8h 一条)

#### 13. 引入轻量请求缓存层
**现状**: 切回到曾经访问过的页面, onMounted 总是 refetch. 静态数据 (硬件列表 / 驱动模板 / HVAC zones) 反复拉.
**改法**: 加 `useQuery` 风格的小 wrapper (60 行无依赖): 同一 url 30s 内复用缓存; 或上 SWR 模式.
**预期**: 切页 fetch 100% 命中本地 cache (后台 silent revalidate).

#### 14. 设备状态走 ETag / If-Modified-Since
**现状**: `/api/devices` / `/api/system/runtime/gateways` 都是 GET, 每次完整序列化 5-30 KB JSON.
**改法**: 后端在 `device-status.service` 加版本号, 响应带 `ETag: <hash>`; 前端 axios 带 `If-None-Match`, 304 直接返回.
**预期**: 轮询包从 30 KB → 200 字节 (304 + headers).

#### 15. WebSocket 心跳 25s → 10s + onpong 服务端回包
**现状**: 心跳 25s + 浏览器/nginx 间默认 60s 空闲断 → 25s 心跳能保活但发现死连接慢.
**改法**: 改 10s, 加 server pong 回响 (`{event:'pong'}` 已经在收, 但前端没用). 前端 10s 没收 pong 就主动 close + 重连.
**预期**: 网络中断到 PWA 显示离线 25-50s → 10-12s.

#### 16. 主入口分包 — vue / pinia / router 独立 cdn (远期可选)
**现状**: vue-core 161 KB 直接打包.
**改法**: 用 unocss 风格 CDN externalize, html 里直接 `<script>` 引 unpkg/cdn.
**预期**: 业务包改动不再失效 vue 包缓存; 但绑定 CDN, 现场离线场景不适用. **GK9000 现场不开**.

#### 17. backend 进程加 `--max-old-space-size` 警戒
**现状**: pm2 max_memory_restart 512 MB, 但 Node 默认 heap 限 ~1.5 GB, 可能用满才重启.
**改法**: `pm2 ecosystem` 加 `node_args: ['--max-old-space-size=400']`, 让 GC 提前清理.
**预期**: 长跑稳定性 +; 抖动时不会涨到 OOM kill.

#### 18. 加 `@nestjs/throttler` 给设备控制 API 限速
**现状**: 没限流, PWA 上误连续点 30 次, 30 个 Modbus 命令排队, 后面的等几秒才执行.
**改法**: lighting / led / audio / hvac controller 加 ThrottlerGuard, 每用户 5 req/s.
**预期**: 用户感受变好 (前端立刻拒绝重复点, 不让最后一次等队列).

#### 19. 长期: 上 redis cache (仅 cnjinhu.top, GK9000 不上)
**现状**: device-status / gateway 状态在 backend 内存 Map, GK9000 单实例不存在分布式问题. 但 cnjinhu.top 多实例时数据不一致.
**改法**: cnjinhu.top 上 redis, GK9000 保持内存. **现在不做**.

---

### P3 — 监控 / 数据驱动 (放最后, 但应该做)

#### 20. 加前端性能埋点
**现状**: 没有 RUM (Real User Monitoring), 只能凭感觉判断"慢".
**改法**: PWA 启动时 `performance.timing` + 每路由切换 mark/measure, 上报到 backend `/api/metrics/rum` 持久化.
**预期**: 客观数据告诉我们"切页 P50 / P95 多少 ms", 后续改有 baseline.

#### 21. 后端 endpoint 加请求耗时直方图
**现状**: 没有 endpoint 级别 latency.
**改法**: 加全局 interceptor 记 `endpoint, method, statusCode, durationMs`, 写入 `request_metrics` 表, /admin/monitor 加柱状图.
**预期**: 可视化 IO 瓶颈, 看哪些 endpoint 突然变慢.

---

## 四、推荐执行顺序

```
第一波 (今天/明天, 共 ~ 4h, 立竿见影):
  P0-#1 Modbus 长连接     2h    单次命令 -40%
  P0-#2 启动 fetch 整理   30min 首屏 -50%
  P0-#3 polling 合并      1h    电量 + 网络稳定
  P0-#4 nginx brotli      30min 传输 -18%

第二波 (这周, 共 ~ 8h):
  P1-#6 ElementPlus 切包  2h    主 bundle -35%
  P1-#7 KeepAlive 全主菜单 30min 切页 -70%
  P1-#8 路由 prefetch     1h    切页冷启动消失
  P1-#10 axios → fetch    2h    包 -17 KB + 长连
  P1-#11 SQLite WAL       30min DB 查 -80%
  P1-#12 el-table-v2      2h    后台表格不卡

第三波 (下周, 共 ~ 6h):
  P0-#5 PWA NetworkFirst  1h    弱网体验
  P1-#9 Winston async     1h    设备 IO 命令 -5-12ms
  P2-#13 useQuery cache   2h    切页 0 等待
  P2-#14 ETag             2h    轮询 -98% 流量

P3 监控放最后, 单独 sprint
```

---

## 五、衡量改完效果的 KPI

| 维度 | 当前 (估) | P0+P1 改完后 |
|---|---|---|
| PWA 首次启动到 dashboard 可用 | 2.5s | 1.0s |
| 主菜单切页 | 200-400ms | 50-100ms |
| 单次拨亮度 (现场 LAN) | 60-110ms | 25-50ms |
| 12 灯分区场景执行 | 800ms | 350ms |
| WS 断开到 UI 显示 | 25-50s | 10-12s |
| 后台 1000 行表格滚动 | 卡顿 30fps | 流畅 60fps |
| 总 bundle 大小 (传输) | 1.8 MB | 1.1 MB |

---

## 六、记录

- 2026-05-29 完成初版审计, 等用户确认顺序
- 改完每一波要重新跑一遍 KPI 测量, 更新本文档表格
- 2026-06-14 第二轮 (聚焦后台切换丝滑):
  - 后台 AdminLayout 补 keep-alive :max=12 (前台早有, 后台漏了) — 切回已访问页瞬开 + 保留筛选/滚动
  - 切页过渡 0.4s→~0.23s, 纯 opacity/transform (GPU)
  - 进后台后 idle 预取各分组主页 chunk (前台 P1-#8 已做, 这次补后台)
  - 新增复用骨架屏组件 AppSkeleton, 应用到灯光/电源/硬件首次加载 (替代空白/转圈)
  - SWR 缓存 (P2-#13): query.service.ts 之前写好但 0 处使用, 这次接到 light-zones/power-circuits/audio-config
    的 list (queryOnce 缓存 + 写操作 invalidate); 页面零改动. 切页/回访命中缓存瞬开 + 后台 silent revalidate.
  - 待办: 骨架屏可继续铺到首页 + 其余后台页; SWR 可扩到 device/scene (需先确认其 mutation 路径); P2-#14 ETag 未做
