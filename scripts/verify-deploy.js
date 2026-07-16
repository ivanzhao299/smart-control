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

/** 被检查的 app 清单 */
const APPS = [
  {
    name: 'smart-control-backend',
    port: 3200,
    /** 跑的代码产物 — 进程启动时间必须晚于它 */
    artifact: path.join(ROOT, 'backend', 'dist', 'main.js'),
    check: { path: '/api/system/health', expect: (b) => JSON.parse(b)?.data?.status === 'ok' },
  },
  {
    name: 'smart-control-frontend',
    port: 5173,
    artifact: path.join(ROOT, 'frontend', 'dist', 'index.html'),
    // vite preview 每次请求读文件系统, 所以只要 200 就说明在服务新 dist
    check: { path: '/', expect: (b) => b.length > 0 },
  },
];

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

function httpGet(port, p) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: p, method: 'GET', timeout: 10000 },
      (res) => {
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

    // --- C. 进程启动时间晚于构建产物 (证明跑的是新代码) ---
    if (fs.existsSync(app.artifact)) {
      const built = fs.statSync(app.artifact).mtimeMs;
      if (p.uptime && p.uptime < built) {
        const lag = Math.round((built - p.uptime) / 1000);
        bad(
          `${app.name}: 进程 ${new Date(p.uptime).toLocaleString()} 就启动了, ` +
          `但产物 ${path.basename(app.artifact)} 是 ${new Date(built).toLocaleString()} 才构建的 ` +
          `(晚 ${lag}s) —— 跑的是旧代码, 需要 pm2 restart ${app.name}`,
        );
      } else {
        ok(`跑的是最新构建 (进程启动于产物之后)`);
      }
    } else {
      bad(`${app.name}: 找不到构建产物 ${app.artifact} —— 构建没做?`);
    }

    // --- D. HTTP 实测 ---
    const r = await httpGet(app.port, app.check.path);
    if (r.code !== 200) {
      bad(`${app.name}: GET :${app.port}${app.check.path} → ${r.code || '无响应'} ${r.body.slice(0, 80)}`);
    } else {
      let good = false;
      try { good = app.check.expect(r.body); } catch { good = false; }
      if (good) ok(`HTTP 200 且内容校验通过`);
      else bad(`${app.name}: HTTP 200 但内容不对: ${r.body.slice(0, 120)}`);
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
