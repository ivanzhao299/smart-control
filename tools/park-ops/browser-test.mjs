import assert from 'node:assert/strict';
import { defaults } from '../../frontend/public/park-ops/ops-data-model.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.OPS_PREVIEW_ORIGIN || 'http://127.0.0.1:5200', errors = [], writes = [], requests = [];
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Mutation tests are permitted only on the local read-only preview server');
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
  assert.deepEqual(await page.locator('.ops-plan [data-ops-metric]').allTextContents(), ['约 660 亩', '约 68 万㎡', '约 26 亿元']);
  assert.equal(await page.locator('.kpis [data-ops-metric=annualOutput]').textContent(), '3.68 亿元');
  assert.equal(await page.locator('.kpis [data-ops-metric=annualTax]').textContent(), '2260 万元');
  assert.equal(await page.locator('.kpis [data-ops-metric=people]').textContent(), '486 人');
  assert.equal(await page.locator('.page.active .ops-donut').count(), 1);
  assert.equal(await page.locator('.page.active .ops-events li').count(), 6);
  await page.screenshot({ path: '/tmp/park-ops-content-overview.png' });
  await page.locator('#openOpsData').click();
  await page.locator('[name=signedTenants]').fill('27');
  await page.locator('[name=people]').fill('0');
  await page.locator('[name=industryManufacturing]').fill('30');
  await page.locator('[name=industryEquipment]').fill('20');
  await page.locator('[name=workPending]').fill('7');
  await page.locator('[name=workOrderEvents]').fill('测试照明工单 · 园区道路 · 处理中');
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
  assert.equal(await page.locator('.kpis [data-ops-metric=signedTenants]').textContent(), '27 家');
  assert.equal(await page.locator('.page.active [data-ops-metric=workPending]').textContent(), '7 项');
  assert.match(await page.locator('.ops-donut').getAttribute('style'), /#63d9ff 0% 30%/);
  assert.match(await page.locator('.page.active .ops-events').first().textContent(), /测试照明工单/);
  await page.waitForTimeout(16000); // Existing layout sync interval is 15 seconds.
  assert.deepEqual(await mapState(), baselineAfterSync, 'layout auto-sync must behave identically to production baseline');
  assert.equal(await page.locator('.kpis [data-ops-metric=signedTenants]').textContent(), '27 家', 'layout auto-sync must not override business data');
  await page.locator('#openOpsData').click();
  await page.locator('[name=signedTenants]').fill('99');
  await page.locator('[data-close]').click();
  assert.equal(await page.locator('.kpis [data-ops-metric=signedTenants]').textContent(), '27 家', 'cancel does not apply unsaved form');
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
  assert.equal(await page.locator('.kpis [data-ops-metric=signedTenants]').textContent(), '27 家', 'API read changes form only before save');
  await page.locator('[data-close]').click();
  await page.evaluate(() => localStorage.removeItem('sc.park-ops.business-preview.v1')); await page.reload();
  await page.waitForFunction(() => window.PARK_OPS_BUSINESS?.snapshot.metrics.signedTenants === 26);
  const overflows = [];
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 3612, height: 1462 }]) {
    await page.setViewportSize(viewport);
    const alignment = await page.evaluate(() => {
      const plan = document.querySelector('.ops-plan').getBoundingClientRect();
      const left = document.querySelector('.grid-main .left > .panel').getBoundingClientRect();
      return { left: Math.abs(plan.left - left.left), width: Math.abs(plan.width - left.width) };
    });
    assert.ok(alignment.left < 1 && alignment.width < 1, 'planning card must align with the left column');
    for (let i = 0; i < 5; i++) {
      const failures = await page.locator('.page.active .ops-panel, .kpi').evaluateAll(nodes => nodes.filter(x => x.scrollHeight > x.clientHeight + 4 || x.scrollWidth > x.clientWidth + 4).map(x => ({ title: x.querySelector('h3, .l').textContent, sh: x.scrollHeight, ch: x.clientHeight })));
      if (failures.length) overflows.push({ viewport, i, failures });
      if (i === 0) await page.screenshot({ path: `/tmp/park-ops-rich-overview-${viewport.width}.png` });
      if (i === 1 || i === 2) { assert.equal(await page.locator('.page.active .ops-bars i').count(), 6); await page.screenshot({ path: `/tmp/park-ops-rich-page-${i}-${viewport.width}.png` }); }
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
  // Match the production player sandbox exactly; no allow-same-origin/CORS waiver.
  const embedded = await context.newPage();
  await embedded.goto(`${origin}/screen/ops-images/sources.html`);
  await embedded.evaluate(() => { const f = document.createElement('iframe'); f.sandbox = 'allow-scripts allow-forms'; f.src = '/screen/index.html'; document.body.replaceChildren(f); });
  await embedded.waitForSelector('iframe');
  const frame = await embedded.locator('iframe').elementHandle().then(h => h.contentFrame());
  await frame.waitForFunction(() => !!window.PARK_OPS_BUSINESS);
  assert.equal(await frame.locator('.ops-plan [data-ops-metric]').first().textContent(), '约 660 亩');
  assert.equal(await frame.locator('.kpis [data-ops-metric=annualOutput]').textContent(), '3.68 亿元');
  assert.equal(await frame.locator('.kpis [data-ops-metric=annualTax]').textContent(), '2260 万元');
  await embedded.close();
  console.log(JSON.stringify({ result: 'PASS', mapMatchesProductionSnapshot: true, phaseCount: baseline.config.phases.length, buildingCount: baseline.config.buildings.length, viewportCases: 10, pageErrors: errors, clientWrites: writes, screenshots: ['/tmp/park-ops-content-overview.png', '/tmp/park-ops-content-editor.png'] }, null, 2));
} finally { await browser.close(); }
