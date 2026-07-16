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
      const built = fs.statSync(app.artifact).mtimeMs;
      if (p.uptime && p.uptime < built) {
        const lag = Math.round((built - p.uptime) / 1000);
        bad(
          `${app.name}: 进程 ${new Date(p.uptime).toLocaleString()} 就启动了, ` +
          `但产物 ${path.basename(app.artifact)} 是 ${new Date(built).toLocaleString()} 才构建的 ` +
          `(晚 ${lag}s) —— 跑的是旧代码, 需要 pm2 restart ${app.name}`,
        );
      } else {
        ok('跑的是最新构建 (进程启动于产物之后)');
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
