const assert = require('node:assert/strict');

// Caller provides the disposable loopback backend and an authenticated synthetic admin context.
exports.verifyParkOpsLayout = async function (context, appBase, { api, admin, operator, backend, nodeFetch }) {
  assert.equal(new URL(backend).hostname, '127.0.0.1');
  const endpoint = '/system-branding/park-ops/editor';
  const request = (body, headers = { Authorization: `Bearer ${admin}` }) => nodeFetch(backend + endpoint, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await request({ config: {}, expectedRevision: 0 }, {})).status, 401);
  assert.equal((await request({ config: {}, expectedRevision: 0 }, { 'X-Client-Token': operator })).status, 403);
  for (const body of [{ config: {}, expectedRevision: '0' }, { config: {}, expectedRevision: 0, actor: 'forged' }, { config: [] }]) {
    assert.equal((await request(body)).status, 400);
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(appBase + '/park-ops/index.html?edit=1');
    const status = page.locator('.park-editor-status'), name = page.locator('#pe-phase-name');
    const save = page.locator('#pe-save'), reload = page.locator('#pe-reload');
    await status.filter({ hasText: /已加载|尚未保存/ }).waitFor();
    assert.equal(await save.isDisabled(), false);
    await name.fill('Synthetic phase');
    const first = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'PUT');
    await save.click(); assert.equal((await first).status(), 200);
    await status.filter({ hasText: '保存成功' }).waitFor();

    let captured, release;
    const received = new Promise(resolve => { captured = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    const delayed = async route => {
      const response = await route.fetch(); captured(); await released; await route.fulfill({ response });
    };
    await page.route('**/api' + endpoint, delayed);
    try {
      await name.fill('Submitted phase'); await save.click(); await received;
      assert.equal(await save.isDisabled(), true);
      await name.fill('Continued draft'); release();
      await status.filter({ hasText: '未保存草稿' }).waitFor();
      assert.equal(await name.inputValue(), 'Continued draft');
      const current = await api('/system-branding/park-ops', 'GET');
      assert.equal(current.config.phases[0].name, 'Submitted phase');
    } finally { release(); await page.unroute('**/api' + endpoint, delayed); }

    const current = await api('/system-branding/park-ops', 'GET');
    current.config.phases[0].name = 'Another administrator';
    await api(endpoint, 'PUT', { config: current.config, expectedRevision: current.revision }, admin, true);
    const stale = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'PUT');
    await save.click(); assert.equal((await stale).status(), 409);
    await status.filter({ hasText: '草稿已保留' }).waitFor();
    assert.equal(await name.inputValue(), 'Continued draft'); assert.equal(await save.isDisabled(), true);
    page.once('dialog', dialog => dialog.dismiss()); await reload.click();
    assert.equal(await name.inputValue(), 'Continued draft');
    page.once('dialog', dialog => dialog.accept()); await reload.click();
    await status.filter({ hasText: '已加载' }).waitFor();
    assert.equal(await name.inputValue(), 'Another administrator'); assert.equal(await save.isDisabled(), false);

    const offline = route => route.fulfill({ status: 503, json: { message: 'Synthetic read outage' } });
    await page.route('**/api/system-branding/park-ops', offline);
    try {
      await name.fill('Offline retained draft');
      page.once('dialog', dialog => dialog.accept()); await reload.click();
      await status.filter({ hasText: '配置读取失败' }).waitFor();
      assert.equal(await name.inputValue(), 'Offline retained draft'); assert.equal(await save.isDisabled(), true);
    } finally { await page.unroute('**/api/system-branding/park-ops', offline); }
    assert.deepEqual(errors, []);
    console.log('PASS park layout actual API/browser: admin-only strict writes, continued typing, stale conflict, confirmed reload and failed-read draft preservation');
  } finally { await page.close(); }
};
