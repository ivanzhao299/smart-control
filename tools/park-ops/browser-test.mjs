import assert from 'node:assert/strict';
import { defaults } from '../../frontend/public/park-ops/ops-data-model.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = 'http://127.0.0.1:5200', errors = [], writes = [], requests = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
await context.route('http://localhost:3200/**', route => route.fulfill({ json: { data: {} } }));
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
page.on('request', r => { requests.push(r.url()); if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.url()); });
const mapState = () => page.evaluate(() => {
  const el = document.getElementById('parkMap'), rect = el.getBoundingClientRect();
  return { config: window.PARK_RUNTIME.config, rect: [rect.x, rect.y, rect.width, rect.height], textKeys: [...document.querySelectorAll('.park [data-park-text-key]')].map(x => [x.dataset.parkTextKey, x.textContent, x.style.cssText]), display: { asset: window.PARK_3D?.asset, renderScale: window.PARK_3D?.renderScale } };
});
try {
  await page.goto(`${origin}/screen/index.html?baseline=1&scene=day`);
  await page.waitForFunction(() => window.PARK_RUNTIME?.config?.buildings.length === 17 && window.PARK_3D?.ready);
  const baseline = await mapState();
  await page.waitForTimeout(16000);
  const baselineAfterSync = await mapState();
  await page.goto(`${origin}/screen/index.html?scene=day`);
  await page.waitForFunction(() => document.documentElement.dataset.opsContentReady && window.PARK_RUNTIME?.config?.buildings.length === 17 && window.PARK_3D?.ready);
  assert.deepEqual(await mapState(), baseline, 'map position, renderer and calibrated text must be identical to production baseline');
  assert.deepEqual(await page.locator('.kpi .n').allTextContents(), ['约 660', '约 68', '约 26', '171', '14.43', '19.40', '26', '约 85']);
  assert.equal(await page.locator('.page.active [data-ops-metric=annualOutput]').textContent(), '3.68 亿元');
  assert.equal(await page.locator('.page.active [data-ops-metric=annualTax]').textContent(), '2260 万元');
  assert.equal(await page.locator('.page.active [data-ops-metric=people]').textContent(), '486 人');
  await page.screenshot({ path: '/tmp/park-ops-content-overview.png' });
  await page.locator('#openOpsData').click();
  await page.locator('[name=signedTenants]').fill('27');
  await page.locator('[name=people]').fill('0');
  await page.locator('[name=companies]').fill('金湖新材料\n测试企业');
  await page.locator('[name=companies]').press('End'); await page.keyboard.press('Space'); await page.keyboard.type('ABC');
  assert.match(await page.locator('[name=companies]').inputValue(), /测试企业 ABC$/);
  assert.equal(await page.locator('.page.active').getAttribute('data-name'), '综合态势');
  await page.locator('button[type=submit]').click();
  assert.match(await page.locator('.ops-feedback').textContent(), /已保存/);
  await page.screenshot({ path: '/tmp/park-ops-content-editor.png' });
  await page.locator('[data-close]').click();
  await page.reload();
  await page.waitForFunction(() => window.PARK_OPS_BUSINESS?.snapshot.metrics.signedTenants === 27 && window.PARK_RUNTIME?.config?.buildings.length === 17);
  assert.deepEqual(await mapState(), baseline, 'saving business values must never alter calibration');
  assert.equal(await page.locator('.kpi .n').nth(6).textContent(), '27');
  await page.waitForTimeout(16000); // Existing layout sync interval is 15 seconds.
  assert.deepEqual(await mapState(), baselineAfterSync, 'layout auto-sync must behave identically to production baseline');
  assert.equal(await page.locator('.kpi .n').nth(6).textContent(), '27', 'layout auto-sync must not override business data');
  await page.locator('#openOpsData').click();
  await page.locator('[name=signedTenants]').fill('99');
  await page.locator('[data-close]').click();
  assert.equal(await page.locator('.kpi .n').nth(6).textContent(), '27', 'cancel does not apply unsaved form');
  await page.locator('#openOpsData').click();
  await page.locator('details summary').click();
  await page.locator('[name=endpoint]').fill('/api/park-ops/metrics');
  await page.locator('[data-refresh]').click();
  await page.waitForFunction(() => document.querySelector('.ops-feedback').textContent.includes('读取失败'));
  assert.equal(await page.locator('[name=signedTenants]').inputValue(), '27');
  await context.route(`${origin}/api/park-ops/metrics`, route => route.fulfill({ json: { version: 1 } }));
  await page.locator('[data-refresh]').click();
  await page.waitForFunction(() => document.querySelector('.ops-feedback').textContent.includes('数据格式错误'));
  await context.unroute(`${origin}/api/park-ops/metrics`);
  await context.route(`${origin}/api/park-ops/metrics`, route => route.fulfill({ json: { ...defaults, metrics: { ...defaults.metrics, people: 500 }, placeholderKeys: defaults.placeholderKeys.filter(k => k !== 'people') } }));
  await page.locator('[data-refresh]').click();
  await page.waitForFunction(() => document.querySelector('.ops-feedback').textContent.includes('已读取接口'));
  assert.equal(await page.locator('[name=people]').inputValue(), '500');
  assert.equal(await page.locator('[name=placeholder-people]').isChecked(), false);
  assert.equal(await page.locator('.kpi .n').nth(6).textContent(), '27', 'API read changes form only before save');
  await page.locator('[data-close]').click();
  await page.evaluate(() => localStorage.removeItem('sc.park-ops.business-preview.v1')); await page.reload();
  await page.waitForFunction(() => window.PARK_OPS_BUSINESS?.snapshot.metrics.signedTenants === 26);
  const overflows = [];
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 3612, height: 1462 }]) {
    await page.setViewportSize(viewport);
    for (let i = 0; i < 5; i++) {
      const failures = await page.locator('.page.active .ops-panel').evaluateAll(nodes => nodes.filter(x => x.scrollHeight > x.clientHeight + 4 || x.scrollWidth > x.clientWidth + 4).map(x => ({ title: x.querySelector('h3').textContent, sh: x.scrollHeight, ch: x.clientHeight })));
      if (failures.length) overflows.push({ viewport, i, failures });
      if (i === 4) { await page.locator('.page.active img').evaluateAll(async images => { await Promise.all(images.map(img => img.decode())); }); await page.screenshot({ path: `/tmp/park-ops-content-video-${viewport.width}.png` }); }
      await page.locator('#next').click();
    }
  }
  assert.deepEqual(overflows, [], 'business cards must not clip text');
  assert.equal(await page.locator('.ops-panel').filter({ hasText: '待接入' }).count(), 0);
  assert.deepEqual(errors, []); assert.deepEqual(writes, []);
  assert.equal(requests.some(url => /twin-view|camera-tour|\.mp4/.test(url)), false, 'unapproved new 3D assets must not load');
  const response = await page.request.put(`${origin}/api/system-branding/park-ops`, { data: { config: {} } });
  assert.equal(response.status(), 405, 'preview cannot write to production');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.screenshot({ path: '/tmp/park-ops-content-overview.png' });
  console.log(JSON.stringify({ result: 'PASS', mapMatchesProductionSnapshot: true, phaseCount: baseline.config.phases.length, buildingCount: baseline.config.buildings.length, viewportCases: 10, pageErrors: errors, clientWrites: writes, screenshots: ['/tmp/park-ops-content-overview.png', '/tmp/park-ops-content-editor.png'] }, null, 2));
} finally { await browser.close(); }
