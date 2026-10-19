const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, relative, resolve } = require('node:path');

/**
 * 裸奔写端点扫描护栏（动态 RBAC P5，对应规划报告 9.3 安全防护清单）。
 *
 * 背景：
 *  - 全局 GlobalAuthGuard 只做【认证】：除 @Public 外每个请求必须携带有效 token，
 *    viewer 的写请求在全局门被硬拦。但它不做【功能授权】（角色/权限点）。
 *  - 因此一个非 @Public 的写端点，如果方法/类上没有任何授权守卫或权限装饰器，
 *    那么任何一个登录用户（operator/hardware/property 等）都能调用它 —— 这就是
 *    “裸奔写端点”。前端隐藏按钮不是安全边界，后端必须有守卫。
 *
 * 本测试静态扫描 src/modules 下全部 .controller.ts 的所有写端点（POST/PUT/PATCH/DELETE），
 * 分三类并与两份“人工审计登记清单”做严格相等比对：
 *  - protected：方法/类装饰器栈含功能授权（@RequirePermission / @UseGuards(授权守卫) /
 *    @ModuleAccess / @Roles / @WriteRoles / @ActorAdmin …）。
 *  - PUBLIC  ：显式 @Public 的写端点（认证登录、设备 webhook/心跳、运营大屏接管、
 *    本机 loopback 运维）。登记在 PUBLIC_WRITE_ALLOWLIST。
 *  - NAKED  ：非 @Public 但没有功能授权装饰器，仅靠方法体内的认证/对象所有权/接管锁/
 *    限流保护的存量端点。登记在 NAKED_WRITE_ALLOWLIST（这是 P3 待清的挂账）。
 *
 * 两份清单都是“只减不增”的护栏：
 *  - 新增一个裸奔/公开写端点，集合多出项 → 测试失败：要么补授权守卫，要么经安全评审后
 *    在此登记并写明原因。
 *  - 某个存量端点补上了权限守卫，集合少项 → 测试也失败：提示把它从清单移除（保证清单
 *    随 P3 收敛，不会越积越多）。
 *
 * 注意：ParkOpsGuard / RateLimitGuard / 设备凭据守卫属于“公开通道”的接管锁/限流/设备认证，
 * 叠加在 @Public 方法上时该端点仍是【显式公开】，归入 PUBLIC 清单，不算功能授权。
 */

const root = resolve(__dirname, '../..');
const modulesRoot = join(root, 'backend/src/modules');

const WRITE_RE = /@(Post|Put|Patch|Delete)\s*\(/;
const PUBLIC_RE = /@Public\s*\(/;
// 功能授权信号：权限点 / 角色 / 模块 / 后台 / 各类授权守卫。
const AUTHZ_RE =
  /@RequirePermission|@WriteRoles|@Roles\b|@ModuleAccess|@ActorAdmin|(?:ModuleAccess|Roles|WriteRole|ActorAdmin|Admin|Permission|BackendSession|PlaybackOperator|MediaUpload|PowerDomain)Guard/;

function walkControllers(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkControllers(p));
    else if (e.name.endsWith('.controller.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

/** 取 export class 正上方紧邻的类装饰器栈（跳过空行/注释），不含文件头 import。 */
function classDecoratorBlock(lines, classIdx) {
  const acc = [];
  for (let j = classIdx - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t.startsWith('@')) { acc.unshift(lines[j]); continue; }
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    break;
  }
  return acc.join('\n');
}

/** 取写方法装饰器栈：HTTP 方法装饰器上方紧邻装饰器 + 其与方法声明之间的装饰器。 */
function methodDecoratorBlock(lines, httpIdx) {
  let m = httpIdx + 1;
  while (m < lines.length) {
    const t = lines[m].trim();
    if (t === '' || t.startsWith('@') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) { m++; continue; }
    break;
  }
  const below = [];
  for (let k = httpIdx + 1; k < m; k++) if (lines[k].trim().startsWith('@')) below.push(lines[k]);
  const above = [];
  for (let j = httpIdx - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (t.startsWith('@')) { above.unshift(lines[j]); continue; }
    if (t === '' || t.startsWith('//') || t.startsWith('/*') || t.startsWith('*')) continue;
    break;
  }
  return [...above, lines[httpIdx], ...below].join('\n');
}

function scan() {
  const pub = new Set();
  const naked = new Set();
  let protectedCount = 0;
  let total = 0;

  for (const file of walkControllers(modulesRoot)) {
    const rel = relative(modulesRoot, file).split(require('node:path').sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const classIdx = lines.findIndex(l => /export\s+class\s+/.test(l));
    if (classIdx < 0) continue;
    const classBlock = classDecoratorBlock(lines, classIdx);

    for (let i = classIdx + 1; i < lines.length; i++) {
      const wm = lines[i].match(WRITE_RE);
      if (!wm) continue;
      total++;
      const methodBlock = methodDecoratorBlock(lines, i);
      const pathM = lines[i].match(/@(?:Post|Put|Patch|Delete)\s*\(\s*['"`]([^'"`]*)['"`]/);
      const key = `${rel}::${wm[1].toUpperCase()} ${pathM ? pathM[1] : '(root)'}`;

      if (AUTHZ_RE.test(methodBlock) || AUTHZ_RE.test(classBlock)) {
        protectedCount++;
      } else if (PUBLIC_RE.test(methodBlock) || PUBLIC_RE.test(classBlock)) {
        pub.add(key);
      } else {
        naked.add(key);
      }
    }
  }
  return { total, protectedCount, pub, naked };
}

// ---------------------------------------------------------------------------
// 已审计的【显式公开写端点】清单（匿名或设备可访问；新增必须经安全评审）。
// 分组：
//  A. 认证/登出：登录本来就无法要求已登录。
//  B. 设备 webhook / 播放器心跳与进度：相机/播放器设备凭据或无状态上报。
//  C. 运营大屏接管：现场大屏匿名主控 + ParkOpsGuard 接管锁 + 限流。
//  D. 本机运维：仅 loopback + token（公网经 nginx 无法触达）。
// ---------------------------------------------------------------------------
const PUBLIC_WRITE_ALLOWLIST = [
  // A. 认证
  'admin-auth/admin-auth.controller.ts::POST login',
  'admin-auth/admin-auth.controller.ts::POST logout',
  'client-auth/client-auth.controller.ts::POST login',
  // B. 相机/播放器设备通道
  'cameras/cameras.controller.ts::POST :channel/hls/ensure',
  'lpr/lpr-webhook.controller.ts::POST plate',
  'lpr/lpr-webhook.controller.ts::POST gio',
  'lpr/lpr-webhook.controller.ts::POST serial',
  'lpr/lpr-webhook.controller.ts::POST snap',
  'lpr/lpr-webhook.controller.ts::POST gate-status',
  'lpr/lpr-webhook.controller.ts::POST heartbeat',
  'playback/player-device.controller.ts::POST doc-meta',
  'playback/player-device.controller.ts::POST doc-prepare',
  'playback/player-device.controller.ts::POST heartbeat',
  'playback/player-device.controller.ts::POST advance',
  'playback/player-device.controller.ts::POST progress',
  // C. 运营大屏接管（ParkOpsGuard + 限流）
  'cameras/park-ops-control.controller.ts::POST claim',
  'cameras/park-ops-control.controller.ts::POST gate-open',
  'cameras/park-ops-control.controller.ts::POST gate-close',
  // D. 本机 loopback 运维（token + 来源 IP 双保险）
  'system/system.controller.ts::POST site-heartbeat',
  'system/system.controller.ts::POST admin-restart',
  'system/system.controller.ts::POST admin-rebuild-frontend',
];

// ---------------------------------------------------------------------------
// 已审计的【非公开但无功能授权装饰器】存量端点（P3 待清挂账，只减不增）。
// 这些端点不是匿名裸奔（非 @Public，必须登录，viewer 写被全局门拦），但功能授权没有
// 用装饰器表达，而是靠方法体内的认证 / 对象所有权 / 接管锁 / 限流兜底：
//  A. 自助/自身资源：actor 取自 token，只能改自己（userId 不可传入），或 service 层
//     做对象所有权校验（updateOwned/remove/authorized）。
//  B. 运营大屏接管锁：next/prev/goto/auto/release 内部 isOwner 校验当前接管者，非接管者
//     静默忽略；refresh 是刻意开放的低风险刷新。
//  C. 实时视频转码：仅 RateLimitGuard 限流 + 登录（查看实时视频的辅助），P3 建议补 camera:view。
// ---------------------------------------------------------------------------
const NAKED_WRITE_ALLOWLIST = [
  // A. 自助 / 自身资源（对象所有权在 service 层）
  'client-auth/client-auth.controller.ts::POST change-password',
  'media/media.controller.ts::PUT :id',
  'media/media.controller.ts::POST :id/access',
  'media/media.controller.ts::DELETE :id',
  'media/media.controller.ts::POST :id/prepare',
  // B. 运营大屏接管锁（claim-based）
  'cameras/park-ops-control.controller.ts::POST release',
  'cameras/park-ops-control.controller.ts::POST next',
  'cameras/park-ops-control.controller.ts::POST prev',
  'cameras/park-ops-control.controller.ts::POST goto',
  'cameras/park-ops-control.controller.ts::POST auto',
  'cameras/park-ops-control.controller.ts::POST refresh',
  // C. 实时视频转码（限流 + 登录；P3 补 camera:view 权限点）
  'cameras/cameras.controller.ts::POST :channel/hls/start',
  'cameras/cameras.controller.ts::POST :channel/hls/stop',
];

function diff(list, set) {
  const expected = [...list].sort();
  const actual = [...set].sort();
  const added = actual.filter(x => !expected.includes(x));   // 新冒出的（未登记）
  const missing = expected.filter(x => !actual.includes(x)); // 已修复/已移除的
  return { added, missing };
}

test('写端点全量扫描可运行并覆盖全部控制器', () => {
  const { total, protectedCount, pub, naked } = scan();
  assert.ok(total > 200, `写端点数量异常偏少: ${total}`);
  assert.equal(protectedCount + pub.size + naked.size, total, '三类计数之和应等于总数');
});

test('非 Public 写端点不允许裸奔：新增裸端点必须补守卫或经安全评审登记（P3 清单只减不增）', () => {
  const { naked } = scan();
  const { added, missing } = diff(NAKED_WRITE_ALLOWLIST, naked);
  assert.deepEqual(
    added,
    [],
    `发现未登记的裸奔写端点（任何登录角色可调用，需补 @RequirePermission/@UseGuards 等授权，或评审后登记）：\n${added.join('\n')}`,
  );
  assert.deepEqual(
    missing,
    [],
    `以下登记的裸端点已不再裸奔（已补守卫或下线），请从 NAKED_WRITE_ALLOWLIST 移除，让清单收敛：\n${missing.join('\n')}`,
  );
});

test('显式公开写端点清单只减不增：新增匿名可写端点必须经安全评审', () => {
  const { pub } = scan();
  const { added, missing } = diff(PUBLIC_WRITE_ALLOWLIST, pub);
  assert.deepEqual(
    added,
    [],
    `发现未登记的 @Public 写端点（匿名/设备可写，需确认设备凭据/loopback/限流等保护并评审登记）：\n${added.join('\n')}`,
  );
  assert.deepEqual(
    missing,
    [],
    `以下登记的公开写端点已不再公开，请从 PUBLIC_WRITE_ALLOWLIST 移除：\n${missing.join('\n')}`,
  );
});
