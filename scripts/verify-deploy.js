#!/usr/bin/env node
/**
 * 部署验证器 — "跑绿" 的唯一判据.
 *
 * 为什么要有它: update.ps1 原来只探 backend 的 /api/system/health, 而现场反复
 * 出现的两类故障它一个都测不出来 ——
 *
 *   1) **前端压根没被检查**. 2026-07-15 前端 pm2 进程崩溃循环 421 次 (EADDRINUSE),
 *      死了整整一天, 而部署脚本每次都报 "更新完成" —— 它只看后端。可业主看到的
 *      就是那个 PWA。
 *
 *   2) **健康检查通过 ≠ 新代码在跑**. 经典孤儿场景: 一个旧 PID 霸占着 3200 跑旧
 *      代码, pm2 起的新进程一直 EADDRINUSE 崩溃→waiting, 但健康检查打到那个旧
 *      进程上照样 200 ok, 于是脚本报成功、业主拿到的还是旧版本。光看
 *      `pnpm build` 成功、光看 health 200, 都证明不了部署生效。
 *
 * 所以这里的判据是 5 条, 全过才算绿:
 *   A. pm2 里每个 app 都 online 且有 pid
 *   B. **端口持有者 PID == pm2 记录的 PID** ← 孤儿检测, 最关键的一条
 *   C. **进程启动时间 > 构建产物 mtime** ← 证明跑的确实是新构建, 不是旧进程
 *   D. HTTP 实测: 后端 health.status==ok, 前端返回 200
 *   E. 重启计数 3s 内不增长 ← 排除"起来了但正在崩溃循环"
 *
 * 用法: node scripts/verify-deploy.js
 * 退出码: 0=绿, 1=红 (update.ps1 据此决定是否报成功)
 *
 * 用 Node 不用 PowerShell: .ps1 在这台机器上踩过两个坑 —— 中文字符 GBK 解析报错,
 * 以及 -ExecutionPolicy Bypass 被安全策略拦。Node 两样都没有。
 */
'use strict';

const { execSync } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';

/**
 * 被检查的 app 清单.
 *
 * freshness 是"怎么证明它跑的是新代码", 两种服务的机制完全不同, 不能一刀切:
 *   'restart' — node 在启动时把 dist/main.js 读进内存, 之后改文件也不生效.
 *               所以判据是: 进程启动时间必须晚于产物 mtime.
 *   'served'  — vite preview 是静态文件服务器, **每次请求都读盘**, 换了 dist
 *               不用重启 (见 deploy/ecosystem.config.js 的注释: 零停机更新).
 *               所以拿启动时间去卡它是误报. 正确判据是: 把它实际吐出来的 HTML
 *               里引用的 bundle 文件名, 跟磁盘上 dist/index.html 里的对比 ——
 *               一致才说明服务的确实是这次构建的产物.
 */
const APPS = [
  {
    name: 'smart-control-backend',
    port: 3200,
    artifact: path.join(ROOT, 'backend', 'dist', 'main.js'),
    /**
     * ⚠️ 新鲜度要看**整个 dist 里最新的文件**, 不能只看 main.js.
     * tsc 是增量编译 (有 tsconfig.build.tsbuildinfo): main.ts 没改它就不重写
     * main.js。2026-07-16 实测 main.js 停在 13:35, 而真正改动的
     * modules/hvac/hvac.controller.js 是 15:22 —— 只看 main.js 的话, "只改了
     * controller + 构建了 + 忘了重启" 这个最常见的场景会被判成绿, 假绿灯正好
     * 是这个验证器要防的东西。
     */
    artifactDir: path.join(ROOT, 'backend', 'dist'),
    freshness: 'restart',
    check: { path: '/api/system/health', expect: (b) => JSON.parse(b)?.data?.status === 'ok' },
  },
  {
    name: 'smart-control-frontend',
    port: 5173,
    artifact: path.join(ROOT, 'frontend', 'dist', 'index.html'),
    freshness: 'served',
    // 前端 vite base 是 /control/, 打根路径会 302 跳过去 —— 那是正常的, 要跟着跳
    check: { path: '/control/', expect: (b) => b.length > 0 },
  },
];

/** 目录里最新的 .js 产物 — 返回 {mtimeMs, file}; 增量编译下只看单个文件会误判 */
function newestBuild(dir) {
  let best = { mtimeMs: 0, file: null };
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (!e.name.endsWith('.js')) continue;
      const st = fs.statSync(full);
      if (st.mtimeMs > best.mtimeMs) best = { mtimeMs: st.mtimeMs, file: full };
    }
  };
  walk(dir);
  return best;
}

/** 从 HTML 里抽出它引用的入口 bundle 文件名 (带内容哈希, 每次构建都变) */
function assetFingerprint(html) {
  const hits = [...html.matchAll(/(?:src|href)="[^"]*?\/(assets\/[\w.-]+\.(?:js|css))"/g)].map((m) => m[1]);
  return hits.length ? hits.sort().join(',') : null;
}

const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s) => `\x1b[90m${s}\x1b[0m`;

const failures = [];
function ok(msg) { console.log('  ' + GREEN('OK') + '   ' + msg); }
function bad(msg) { console.log('  ' + RED('FAIL') + ' ' + msg); failures.push(msg); }
function info(msg) { console.log('  ' + DIM(msg)); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** pm2 jlist — 拿每个 app 的 status / pid / 重启次数 / 启动时间 */
function pm2List() {
  const raw = execSync('pm2 jlist', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('pm2 jlist 输出里找不到 JSON');
  return JSON.parse(m[0]).map((p) => ({
    name: p.name,
    status: p.pm2_env?.status,
    pid: p.pid,
    restarts: p.pm2_env?.restart_time,
    uptime: p.pm2_env?.pm_uptime,
  }));
}

/** 端口的监听者 PID (Windows netstat / Linux ss) */
function portOwner(port) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano -p TCP`, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/);
        if (m && Number(m[1]) === port) return Number(m[2]);
      }
      return null;
    }
    const out = execSync(`ss -ltnp 2>/dev/null || true`, { encoding: 'utf8' });
    const m = out.match(new RegExp(`:${port}\\b[^\\n]*pid=(\\d+)`));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** GET, 跟随 302 (前端根路径会跳到 /control/, 那是正常的) */
function httpGet(port, p, hops = 3) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method: 'GET', timeout: 10000 },
      (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && hops > 0) {
          res.resume();
          const next = loc.startsWith('http') ? new URL(loc).pathname : loc;
          resolve(httpGet(port, next, hops - 1));
          return;
        }
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => resolve({ code: res.statusCode, body: b }));
      },
    );
    req.on('error', (e) => resolve({ code: 0, body: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, body: 'timeout' }); });
    req.end();
  });
}

async function main() {
  console.log('\n==== 部署验证 ====\n');

  let procs;
  try {
    procs = pm2List();
  } catch (e) {
    console.log(RED('无法读取 pm2 进程列表: ' + e.message));
    process.exit(1);
  }

  for (const app of APPS) {
    console.log(`[${app.name}]`);
    const p = procs.find((x) => x.name === app.name);

    // --- A. pm2 里在不在, online 吗 ---
    if (!p) { bad(`${app.name}: pm2 里没有这个进程`); console.log(''); continue; }
    if (p.status !== 'online' || !p.pid) {
      bad(`${app.name}: pm2 状态 = ${p.status} (pid=${p.pid}), 重启 ${p.restarts} 次`);
      console.log('');
      continue;
    }
    ok(`pm2 online, pid=${p.pid}, 重启 ${p.restarts} 次`);

    // --- B. 端口持有者 == pm2 的 pid (孤儿检测) ---
    const owner = portOwner(app.port);
    if (owner === null) {
      bad(`${app.name}: 端口 ${app.port} 没有监听者`);
    } else if (owner !== p.pid) {
      bad(
        `${app.name}: 端口 ${app.port} 被 PID ${owner} 占着, 但 pm2 管的是 PID ${p.pid} ` +
        `—— 孤儿进程! 服务的是旧代码, pm2 管不到它。` +
        `处理: taskkill /F /PID ${owner} 然后 pm2 restart ${app.name}`,
      );
    } else {
      ok(`端口 ${app.port} 持有者 PID ${owner} 与 pm2 一致 (无孤儿)`);
    }

    if (!fs.existsSync(app.artifact)) {
      bad(`${app.name}: 找不到构建产物 ${app.artifact} —— 构建没做?`);
      console.log('');
      continue;
    }

    // --- C. 新鲜度: 跑的是不是这次构建的东西 (两种机制判法不同, 见 APPS 注释) ---
    if (app.freshness === 'restart') {
      // 取整个 dist 里最新的 .js, 不是 main.js —— 增量编译不重写没变的文件
      const newest = newestBuild(app.artifactDir);
      if (!newest.file) {
        bad(`${app.name}: ${app.artifactDir} 里一个 .js 都没有 —— 构建没做?`);
      } else if (p.uptime && p.uptime < newest.mtimeMs) {
        const lag = Math.round((newest.mtimeMs - p.uptime) / 1000);
        bad(
          `${app.name}: 进程 ${new Date(p.uptime).toLocaleTimeString()} 就启动了, ` +
          `但产物 ${path.relative(app.artifactDir, newest.file)} 是 ` +
          `${new Date(newest.mtimeMs).toLocaleTimeString()} 才构建的 (晚 ${lag}s) ` +
          `—— 跑的是旧代码, 需要 pm2 restart ${app.name}`,
        );
      } else {
        ok(
          `跑的是最新构建 (进程 ${new Date(p.uptime).toLocaleTimeString()} > ` +
          `最新产物 ${path.relative(app.artifactDir, newest.file)} ` +
          `${new Date(newest.mtimeMs).toLocaleTimeString()})`,
        );
      }
    }

    // --- D. HTTP 实测 ---
    const r = await httpGet(app.port, app.check.path);
    if (r.code !== 200) {
      bad(`${app.name}: GET :${app.port}${app.check.path} → ${r.code || '无响应'} ${r.body.slice(0, 80)}`);
    } else {
      let good = false;
      try { good = app.check.expect(r.body); } catch { good = false; }
      if (good) ok('HTTP 200 且内容校验通过');
      else bad(`${app.name}: HTTP 200 但内容不对: ${r.body.slice(0, 120)}`);
    }

    // --- C'. 静态服务: 比对它吐出来的 bundle 指纹 vs 磁盘上的构建产物 ---
    if (app.freshness === 'served' && r.code === 200) {
      const onDisk = assetFingerprint(fs.readFileSync(app.artifact, 'utf8'));
      const served = assetFingerprint(r.body);
      if (!onDisk || !served) {
        bad(`${app.name}: HTML 里找不到 assets 引用, 没法确认服务的是不是新构建 (磁盘=${onDisk} 服务=${served})`);
      } else if (onDisk !== served) {
        bad(
          `${app.name}: 服务的不是这次的构建 —— 它吐出来的是 [${served}], ` +
          `磁盘上是 [${onDisk}]. 多半有个旧进程占着端口 (pm2 管不到的孤儿)`,
        );
      } else {
        ok('服务的正是这次构建的产物 (bundle 指纹一致)');
      }
    }
    console.log('');
  }

  // --- E. 重启计数不增长 (排除"起来了但在崩溃循环") ---
  console.log('[崩溃循环检测] 3s 后复采重启计数...');
  const before = new Map(procs.map((p) => [p.name, p.restarts]));
  await sleep(3000);
  try {
    for (const p of pm2List()) {
      const b = before.get(p.name);
      if (b !== undefined && p.restarts > b) {
        bad(`${p.name}: 3s 内重启计数 ${b} → ${p.restarts}, 正在崩溃循环`);
      }
    }
    if (!failures.some((f) => f.includes('崩溃循环'))) ok('重启计数稳定, 无崩溃循环');
  } catch (e) {
    bad('复采 pm2 失败: ' + e.message);
  }

  // --- F. Kiosk 播放器心跳 (信息性, 不计入成败) ---
  // 播放器是控制台会话里的 Chromium kiosk 窗口, 不归 pm2 管; 拉活它们是
  // SmartControl-PlayerWatchdog (每分钟, 心跳陈旧超 3 分钟自动重拉) 的职责。
  // 这里只把 backend 记录的各 slot 心跳打出来, 让远程 CI 探针能看到
  // "大屏(1)/投影(2)/BGM(3) 到底活没活" —— 不算进部署成败: 部署好坏与
  // 控制台会话里有没有浏览器窗口是两回事 (RDP 抢占控制台也会杀心跳)。
  console.log('[kiosk 心跳] GET /api/playback/channels (信息性)');
  try {
    const r = await httpGet(3200, '/api/playback/channels');
    if (r.code !== 200) {
      console.log('  ' + RED('WARN') + ` 读取失败: HTTP ${r.code || '无响应'} ${String(r.body).slice(0, 80)}`);
    } else {
      const rows = JSON.parse(r.body).data || [];
      if (!rows.length) console.log('  ' + RED('WARN') + ' 没有任何播控通道记录');
      for (const c of rows) {
        const hb = c.lastHeartbeatAt ? new Date(c.lastHeartbeatAt) : null;
        const ageSec = hb ? Math.round((Date.now() - hb.getTime()) / 1000) : null;
        const label =
          `slot=${c.slot} alive=${c.alive} ` +
          `心跳=${hb ? `${hb.toLocaleTimeString()} (${ageSec}s 前)` : '从未'} ` +
          `媒体=${c.mediaName ?? '-'}`;
        if (c.alive) ok(label);
        else console.log('  ' + RED('WARN') + ' ' + label + ' — kiosk 可能没在跑或控制台会话被 RDP 抢占');
      }
    }
  } catch (e) {
    console.log('  ' + RED('WARN') + ' kiosk 心跳读取异常: ' + e.message);
  }
  console.log('');

  // --- G. 硬件网关连接 + 电源回路/时序器 (信息性, 不计入成败) ---
  // 网关 state 来自 AdapterConnectionRegistry (DALI/LED/音响/空调/时序器等的
  // 传输层连接); 电源回路的 on/电流/功率 读数经时序器(EPO-802P)/断路器采回,
  // 有新鲜读数 = 控制链路活着。设备受不受控是现场硬件+网线的事, 不该拦部署,
  // 所以只打印不判失败 —— 但远程一眼能看出哪条链路断了。
  console.log('[硬件网关] GET /api/system/runtime/gateways (信息性)');
  try {
    const r = await httpGet(3200, '/api/system/runtime/gateways');
    if (r.code !== 200) {
      console.log('  ' + RED('WARN') + ` 读取失败: HTTP ${r.code || '无响应'}`);
    } else {
      const rows = JSON.parse(r.body).data || [];
      if (!rows.length) console.log('  ' + RED('WARN') + ' 注册表为空 (MOCK 模式?)');
      for (const g of rows) {
        const label = `${g.gateway} @ ${g.endpoint ?? '-'} state=${g.state}` +
          (g.lastError ? ` lastError=${String(g.lastError).slice(0, 60)}` : '');
        if (g.state === 'online') ok(label);
        else console.log('  ' + RED('WARN') + ' ' + label);
      }
    }
  } catch (e) {
    console.log('  ' + RED('WARN') + ' 网关状态读取异常: ' + e.message);
  }
  console.log('');
  console.log('[电源回路] GET /api/power-circuits (信息性)');
  try {
    const r = await httpGet(3200, '/api/power-circuits');
    if (r.code !== 200) {
      console.log('  ' + RED('WARN') + ` 读取失败: HTTP ${r.code || '无响应'}`);
    } else {
      const rows = JSON.parse(r.body).data || [];
      if (!rows.length) console.log('  ' + RED('WARN') + ' 无回路记录');
      for (const c of rows) {
        // 读数嵌在 reading 子对象里 (toView: {...baseView, isBreaker, reading})
        // —— 第一版探针按顶层字段读, 全 undefined, 打出了"全部断开"的假象。
        const rd = c.reading ?? c;
        const read = rd.lastReadAt ? new Date(rd.lastReadAt) : null;
        const ageSec = read ? Math.round((Date.now() - read.getTime()) / 1000) : null;
        console.log(
          `  - ${c.name ?? c.id}${c.relayChannel != null ? `[时序${c.relayChannel}路]` : ''}: ` +
          `${rd.on ? '通电' : '断开'} ` +
          `P=${rd.power ?? '-'}W I=${rd.current ?? '-'}A ` +
          `读数=${read ? `${ageSec}s 前` : '无'}`,
        );
      }
    }
  } catch (e) {
    console.log('  ' + RED('WARN') + ' 电源回路读取异常: ' + e.message);
  }
  console.log('');

  // --- I. 音频矩阵 (信息性) —— 验证 2026-07-26 割接: 命名 + 设备实时路由 ---
  // inputs/zones 读 DB (heal 是否执行过), matrix/live 读 EKX-808 本人 (0x61 一帧,
  // ~284ms) —— reconciler 是否已把期望路由真正下发到设备。只打印不判失败。
  console.log('[音频矩阵] 命名 + 设备实时路由 (信息性)');
  try {
    const ri = await httpGet(3200, '/api/audio-config/inputs');
    const rz = await httpGet(3200, '/api/audio-config/zones');
    if (ri.code === 200) {
      const rows = JSON.parse(ri.body).data || [];
      console.log('  输入: ' + rows.map((s) => `IN${s.channel + 1}=${s.name}` +
        (s.desiredGainDb !== null && s.desiredGainDb !== undefined ? `(${s.desiredGainDb}dB)` : '')).join(' | '));
    }
    if (rz.code === 200) {
      const rows = JSON.parse(rz.body).data || [];
      console.log('  输出: ' + rows.map((z) => `OUT${z.channel + 1}=${z.name}`).join(' | '));
    }
    const rm = await httpGet(3200, '/api/audio/matrix/live');
    const m = rm.code === 200 ? JSON.parse(rm.body).data : null;
    if (m && m.ok && m.data && Array.isArray(m.data.matrix)) {
      const onList = [];
      m.data.matrix.forEach((row, out) => row.forEach((on, inn) => {
        if (on) onList.push(`OUT${out + 1}←IN${inn + 1}`);
      }));
      console.log('  设备实时接通交叉点: ' + (onList.join(', ') || '(全断)'));
    } else {
      console.log('  ' + RED('WARN') + ' 矩阵实时读取失败: ' + (m && m.error ? m.error : `HTTP ${rm.code}`));
    }
    // 输出音量回读 (慢 ~4.6s): 诊断"推子不受控" — 界面推完看这里, 设备值变了
    // 说明指令到位, 听感没变就查功放侧。老部署没有这个接口, 404 静默跳过。
    const ro = await httpGet(3200, '/api/audio/outputs/live');
    const o = ro.code === 200 ? JSON.parse(ro.body).data : null;
    if (o && o.ok && o.data && Array.isArray(o.data.channels)) {
      console.log('  设备输出音量: ' + o.data.channels
        .map((c) => `OUT${c.ch + 1}=${c.volume ?? '?'}%${c.muted ? '(静音)' : ''}`).join(' '));
    }
  } catch (e) {
    console.log('  ' + RED('WARN') + ' 音频矩阵探测异常: ' + e.message);
  }
  console.log('');

  // --- J. 媒体库健康 (信息性) —— 总数 / 测试素材在不在 / 有没有空 path 死行 ---
  console.log('[媒体库] GET /api/media (信息性)');
  try {
    const r = await httpGet(3200, '/api/media');
    if (r.code !== 200) {
      console.log('  ' + RED('WARN') + ` 读取失败: HTTP ${r.code || '无响应'}`);
    } else {
      const payload = JSON.parse(r.body).data || {};
      const rows = payload.items || [];
      const test = rows.find((m) => m.originalName === '左右声道测试.wav');
      console.log(`  共 ${payload.total ?? rows.length} 个素材; 左右声道测试.wav: ${test ? `在 (#${test.id}, kind=${test.kind})` : RED('不在! (查 backend 日志里 [Media] 内置素材 行)')}`);
    }
  } catch (e) {
    console.log('  ' + RED('WARN') + ' 媒体库探测异常: ' + e.message);
  }
  console.log('');

  // --- K. 系统体检 (信息性, 仅 Windows) —— 资源水位 + 进程泄漏扫描 + 磁盘 ---
  if (isWin) {
    console.log('[系统体检] 资源 / 进程泄漏 / 磁盘 (信息性)');
    try {
      const rh = await httpGet(3200, '/api/system/health');
      if (rh.code === 200) {
        const h = JSON.parse(rh.body).data || {};
        const up = typeof h.uptime === 'number' ? (h.uptime / 3600).toFixed(1) + 'h' : '?';
        console.log(`  backend: status=${h.status} CPU=${h.cpuUsagePercent}% 内存=${h.memoryUsagePercent}% ` +
          `已运行=${up} DB=${h.databaseStatus} WS=${h.websocketStatus} 调度=${h.schedulerStatus}`);
      }
    } catch (e) { console.log('  ' + RED('WARN') + ' 健康指标读取异常: ' + e.message); }
    try {
      // node.exe 逐个按命令行分类: 期望 = backend(dist/main.js) 1 + 前端(vite preview) 1
      // + pm2 守护(Daemon.js) 1。多出来的都是泄漏嫌疑, 原样打出来。
      const raw = execSync('wmic process where (name="node.exe") get ProcessId,CommandLine /format:csv', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
      const rows = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^Node,/i.test(l));
      const cls = { backend: [], frontend: [], pm2daemon: [], other: [] };
      for (const l of rows) {
        const pid = (l.match(/,(\d+)\s*$/) || [])[1] || '?';
        const cmd = l.toLowerCase();
        if (cmd.includes('dist\\main.js') || cmd.includes('dist/main.js')) cls.backend.push(pid);
        else if (cmd.includes('vite')) cls.frontend.push(pid);
        else if (cmd.includes('daemon.js') || cmd.includes('pm2')) cls.pm2daemon.push(pid);
        else cls.other.push(`${pid}: ${l.slice(0, 110)}`);
      }
      const summary = `node 进程: backend×${cls.backend.length} 前端×${cls.frontend.length} pm2相关×${cls.pm2daemon.length} 其他×${cls.other.length}`;
      const healthyCounts = cls.backend.length === 1 && cls.frontend.length === 1 && cls.pm2daemon.length <= 3 && cls.other.length === 0;
      console.log('  ' + (healthyCounts ? GREEN('OK') + '   ' : RED('WARN') + ' ') + summary);
      cls.other.forEach((o) => console.log('  ' + RED('  泄漏嫌疑') + ' ' + o));
      // pm2 桶按命令行去重统计 — 128 个"pm2相关"到底是什么, 一眼定罪
      if (cls.pm2daemon.length > 3) {
        const byCmd = new Map();
        for (const l of rows) {
          const cmd = l.toLowerCase();
          if ((cmd.includes('daemon.js') || cmd.includes('pm2')) && !cmd.includes('dist\\main.js') && !cmd.includes('vite')) {
            const key = l.replace(/^[^,]*,/, '').replace(/,\d+\s*$/, '').slice(0, 150);
            byCmd.set(key, (byCmd.get(key) || 0) + 1);
          }
        }
        [...byCmd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
          .forEach(([cmd, n]) => console.log(`  ${RED('  ×' + n)} ${cmd}`));
      }
      if (cls.backend.length > 1) console.log('  ' + RED('  backend 多于 1 个!') + ' pids=' + cls.backend.join(','));
      // 定罪三件套: 守护创建时间/会话抽样 (看孵化节奏与所在会话)、pm2 相关
      // Windows 服务 (pm2-windows-service 遗留?)、相关计划任务 (触发器周期)
      if (cls.pm2daemon.length > 3) {
        try {
          // ParentProcessId 一并采: 泄漏守护的父进程 (cmd 早退场的话 PPID 是
          // 悬空数字, 但同一批孵化的 PPID 分布仍能指认孵化者形态)
          const det = execSync('wmic process where (name="node.exe") get ProcessId,ParentProcessId,SessionId,CreationDate,CommandLine /format:csv', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
          const ds = det.split(/\r?\n/).filter((l) => l.toLowerCase().includes('daemon.js'));
          const parse = (l) => {
            const parts = l.split(',');
            // csv 列按字母序: Node,CommandLine,CreationDate,ParentProcessId,ProcessId,SessionId
            const cd = parts[parts.length - 4] || '';
            return { ppid: parts[parts.length - 3], pid: parts[parts.length - 2], sess: parts[parts.length - 1], t: cd.slice(0, 14) };
          };
          const sample = [...ds.slice(0, 3), ...ds.slice(-3)].map(parse);
          console.log('  守护抽样(最早3+最新3): ' + sample.map((s) => `pid${s.pid}(ppid${s.ppid})@s${s.sess} ${s.t}`).join(' | '));
        } catch (e) { console.log('  ' + RED('WARN') + ' 守护抽样失败: ' + e.message); }
        try {
          const svc = execSync('wmic service get Name,State,StartMode,PathName /format:csv', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
          svc.split(/\r?\n/).filter((l) => /pm2|node/i.test(l)).slice(0, 5)
            .forEach((l) => console.log('  服务: ' + l.trim().slice(0, 160)));
        } catch (e) { console.log('  ' + RED('WARN') + ' 服务枚举失败: ' + e.message); }
        try {
          const st = execSync('schtasks /query /fo csv /v', { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
          const lines = st.split(/\r?\n/);
          const hits = lines.filter((l) => /smartcontrol|pm2/i.test(l));
          hits.slice(0, 6).forEach((l) => {
            const c = l.split('","');
            // TaskName(1), Next Run(2)?, Status, ... Schedule fields near end
            console.log('  任务: ' + (c[1] || '').replace(/"/g, '') + ' | 状态=' + (c[3] || '') + ' | 上次=' + (c[5] || '') + ' | 重复间隔=' + (c[c.length - 4] || ''));
          });
        } catch (e) { console.log('  ' + RED('WARN') + ' 计划任务枚举失败: ' + e.message); }
      }
      try {
        // pm2 命名管道清单 (常开): rpc/pub 管道名里逐字嵌着 PM2_HOME —— 有几种
        // 不同的管道名, 就有几套互不相认的 pm2 世界。名字用 <> 包起来打印,
        // 尾随空格会当场现形 (2026-07-27 根因: set 值带尾随空格 -> 管道名多个空格)。
        const pcmd = String.raw`powershell -NoProfile -Command "[System.IO.Directory]::GetFiles('\\.\pipe\') -match 'pm2|rpc\.sock|pub\.sock'"`;
        const pipes = execSync(pcmd, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
          .split(/\r?\n/).map((l) => l.replace(/\r/g, '')).filter((l) => l.trim());
        console.log(`  pm2 相关命名管道: ${pipes.length} 条`);
        pipes.slice(0, 8).forEach((p) => console.log('  管道: <' + p + '>'));
        if (pipes.length > 8) console.log(`  ... 其余 ${pipes.length - 8} 条略`);
      } catch (e) { console.log('  ' + RED('WARN') + ' 管道枚举失败: ' + e.message); }
      try {
        // boot-pm2.log 尾 (常开): \SmartControlBackend 每 5 分钟跑一次 boot-pm2.ps1,
        // 这里能直接看到每轮走的是"端口在听早退"还是"WMI resurrect" —— 守护
        // 堆积节奏的第一现场。
        const bootLog = path.resolve(__dirname, '..', 'logs', 'boot-pm2.log');
        if (fs.existsSync(bootLog)) {
          const tail = fs.readFileSync(bootLog, 'utf8').trimEnd().split(/\r?\n/).slice(-40);
          console.log('  boot-pm2.log 尾 40 行:');
          tail.forEach((l) => console.log('  | ' + l));
        } else {
          console.log('  ' + RED('WARN') + ' 找不到 boot-pm2.log — boot 任务可能从未跑过');
        }
      } catch (e) { console.log('  ' + RED('WARN') + ' boot-pm2.log 读取异常: ' + e.message); }
      try {
        // 决定性实验 (2026-07-27): 管道清单证明全机只有固定名 \\.\pipe\rpc.sock
        // 一套管道, 而守护数在部署的几十秒内随 pm2 CLI 调用逐次 +1 —— 怀疑机制:
        // 客户端 ping 探活失败 -> 孵新守护 -> 新守护绑固定管道失败(老守护占着)
        // -> 僵尸滞留, 客户端随后连上老守护干活成功。这里当场做一次对照实验:
        // 数守护 -> pm2 ping -> 再数。净增=1 即定罪 "每次 CLI 调用净增一僵尸"。
        const pidFile = 'C:\\Users\\user\\.pm2\\pm2.pid';
        const pidVal = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : '(无文件)';
        const countDaemons = () => execSync('wmic process where (name="node.exe") get CommandLine', { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
          .split(/\r?\n/).filter((l) => l.includes('Daemon.js')).length;
        const before = countDaemons();
        const t0 = Date.now();
        let pingOut = '';
        try {
          const out = execSync('C:\\Users\\user\\AppData\\Roaming\\npm\\pm2.cmd ping', {
            encoding: 'utf8', timeout: 30000,
            env: { ...process.env, PM2_HOME: 'C:\\Users\\user\\.pm2' },
          });
          pingOut = (out.trim().split(/\r?\n/).pop() || '').slice(0, 80);
        } catch (e) { pingOut = 'ping 失败: ' + String(e.message || e).slice(0, 80); }
        const ms = Date.now() - t0;
        const after = countDaemons();
        console.log(`  pm2.pid 登记=${pidVal} | ping 实验: 前守护=${before} 后守护=${after} 净增=${after - before} 耗时=${ms}ms 回应="${pingOut}"`);
      } catch (e) { console.log('  ' + RED('WARN') + ' ping 实验异常: ' + e.message); }
      try {
        const pm2Log = 'C:\\Users\\user\\.pm2\\pm2.log';
        if (fs.existsSync(pm2Log)) {
          const tail = fs.readFileSync(pm2Log, 'utf8').trimEnd().split(/\r?\n/).slice(-12);
          console.log('  pm2.log 尾 12 行:');
          tail.forEach((l) => console.log('  | ' + l));
        }
      } catch (e) { console.log('  ' + RED('WARN') + ' pm2.log 读取异常: ' + e.message); }
      for (const img of ['powershell.exe', 'wscript.exe', 'conhost.exe', 'cmd.exe']) {
        const t = execSync(`tasklist /FI "IMAGENAME eq ${img}" /FO CSV`, { encoding: 'utf8' });
        const n = t.split(/\r?\n/).filter((l) => l.startsWith('"')).length - 1;
        if (n > 0) console.log(`  ${img}: ${Math.max(n, 0)} 个`);
      }
    } catch (e) { console.log('  ' + RED('WARN') + ' 进程扫描异常: ' + e.message); }
    try {
      const d = execSync('wmic logicaldisk where drivetype=3 get Caption,FreeSpace,Size /format:csv', { encoding: 'utf8' });
      d.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^Node,/i.test(l)).forEach((l) => {
        const p = l.split(',');
        if (p.length >= 4) {
          const free = Number(p[2]) / 1e9, size = Number(p[3]) / 1e9;
          if (size > 0) console.log(`  磁盘 ${p[1]} 剩余 ${free.toFixed(0)}GB / ${size.toFixed(0)}GB (${((free / size) * 100).toFixed(0)}%)`);
        }
      });
    } catch (e) { console.log('  ' + RED('WARN') + ' 磁盘读取异常: ' + e.message); }
    console.log('');
  }

  // --- H. 控制台会话 / 播放器窗口归属 (信息性, 仅 Windows) ---
  // "心跳全活但大屏显示桌面" = 播放器窗口不在物理控制台会话里 (典型: 有人挂着
  // RDP, watchdog 主动退让; 或窗口落错会话)。qwinsta 看会话, tasklist 看浏览器
  // 进程落在哪个会话, watchdog 日志尾看它每分钟的决策, MAINTENANCE.flag 看有没有
  // 人为停用 watchdog。全部只读, 不动任何状态。
  if (isWin) {
    console.log('[会话归属] qwinsta / 浏览器进程会话 / watchdog 日志尾 (信息性)');
    try {
      const q = execSync('qwinsta', { encoding: 'utf8' });
      q.split(/\r?\n/).filter((l) => l.trim()).forEach((l) => console.log('  | ' + l));
    } catch (e) { console.log('  ' + RED('WARN') + ' qwinsta 失败: ' + e.message); }
    try {
      for (const img of ['msedge.exe', 'chrome.exe']) {
        const t = execSync(`tasklist /FI "IMAGENAME eq ${img}" /FO CSV`, { encoding: 'utf8' });
        const lines = t.split(/\r?\n/).filter((l) => l.startsWith('"'));
        if (lines.length > 1) {
          // CSV: "Image","PID","SessionName","Session#","Mem" — 汇总各会话进程数
          const bySession = {};
          for (const l of lines.slice(1)) {
            const cols = l.split('","');
            const sess = `${cols[2]}#${cols[3]}`;
            bySession[sess] = (bySession[sess] || 0) + 1;
          }
          console.log(`  ${img}: ` + Object.entries(bySession).map(([s, n]) => `${s} x${n}`).join(', '));
        }
      }
    } catch (e) { console.log('  ' + RED('WARN') + ' tasklist 失败: ' + e.message); }
    try {
      const flag = path.resolve(__dirname, '..', 'MAINTENANCE.flag');
      if (fs.existsSync(flag)) {
        const ageMin = Math.round((Date.now() - fs.statSync(flag).mtimeMs) / 60000);
        console.log('  ' + RED('WARN') + ` MAINTENANCE.flag 存在 (${ageMin} 分钟前) — watchdog 被停用 (8h 自动过期)`);
      } else {
        ok('无 MAINTENANCE.flag');
      }
      const wdLog = path.resolve(__dirname, '..', 'logs', 'player-watchdog.log');
      if (fs.existsSync(wdLog)) {
        const tail = fs.readFileSync(wdLog, 'utf8').trimEnd().split(/\r?\n/).slice(-10);
        console.log('  watchdog 日志尾 10 行:');
        tail.forEach((l) => console.log('  | ' + l));
      } else {
        console.log('  ' + RED('WARN') + ' 找不到 player-watchdog.log — watchdog 可能从未跑过');
      }
    } catch (e) { console.log('  ' + RED('WARN') + ' watchdog 状态读取异常: ' + e.message); }
    console.log('');
  }

  console.log('\n==== 结果 ====');
  if (failures.length) {
    console.log(RED(`\n部署未通过 — ${failures.length} 项失败:\n`));
    failures.forEach((f, i) => console.log(RED(`  ${i + 1}. ${f}`)));
    console.log('');
    process.exit(1);
  }
  console.log(GREEN('\n全绿 — 两个服务都在跑最新代码, 无孤儿, 无崩溃循环\n'));
  process.exit(0);
}

main().catch((e) => {
  console.log(RED('验证器自身出错: ' + (e && e.stack ? e.stack : e)));
  process.exit(1);
});
