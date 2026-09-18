const assert = require('node:assert/strict');

// Only the caller's fresh loopback database; no physical hardware category or adapter operation.
exports.verifyBrandReferenceIntegrity = async function (page, appBase, { api, admin, operator, backend, nodeFetch }) {
  assert.equal(new URL(backend).hostname, '127.0.0.1');
  const key = 'synthetic-brand-' + Date.now();
  const hardware = await api('/hardware', 'POST', {
    code: key, name: key, category: 'other', model: 'local-test', vendor: key,
  }, admin, true);
  await api('/drivers', 'POST', {
    kind: key, displayName: key, vendor: key, category: 'custom', protocol: 'custom', capabilities: [],
  }, admin, true);
  const brand = (await api('/brands', 'GET', undefined, admin, true)).find(row => row.name === key);
  assert.ok(brand);
  assert.equal(brand.hardwareCount, 1); assert.equal(brand.driverCount, 1);
  const endpoint = '/brands/' + brand.id;
  const editorEndpoint = '/brands/editor/' + brand.id;
  const editorRequest = (body, headers = { Authorization: `Bearer ${admin}` }) => nodeFetch(backend + editorEndpoint, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  const request = (method, body, headers = { Authorization: `Bearer ${admin}` }) => nodeFetch(backend + endpoint, {
    method, headers: { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await request('PUT', { displayName: 'denied' }, {})).status, 401);
  assert.equal((await request('PUT', { displayName: 'denied' }, { 'X-Client-Token': operator })).status, 403);
  assert.equal((await request('PUT', { name: key + '-broken' })).status, 409);
  assert.equal((await request('DELETE')).status, 409);
  for (const name of ['', '   ', null]) assert.equal((await request('PUT', { name })).status, 400);
  assert.equal((await editorRequest({ displayName: 'denied', expectedRevision: brand.configRevision }, {})).status, 401);
  assert.equal((await editorRequest({ displayName: 'denied', expectedRevision: brand.configRevision }, { 'X-Client-Token': operator })).status, 403);
  for (const body of [{ displayName: 'missing version' }, { expectedRevision: 1, enabled: null }, { expectedRevision: 1, operator: 'forged' }, { expectedRevision: 1, website: 'javascript:alert(1)' }]) {
    assert.equal((await editorRequest(body)).status, 400);
  }

  await page.goto(appBase + '/admin/brands');
  await page.getByPlaceholder('搜索品牌 / 国家').fill(key);
  const row = page.locator('.el-table__row').filter({ hasText: key });
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  const drawer = page.locator('.el-drawer');
  assert.equal(await drawer.getByPlaceholder('跟硬件清单 vendor 字段一致, e.g. 诺瓦 NovaStar').isDisabled(), true);
  await drawer.getByPlaceholder('给用户看的友好名 (可选)').fill('Preserved reference display');
  const saved = page.waitForResponse(response => response.url().endsWith(editorEndpoint) && response.request().method() === 'PUT');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await saved).status(), 200);
  await page.getByText('品牌配置已保存', { exact: true }).waitFor();
  const maintained = await api(endpoint, 'GET', undefined, admin, true);
  assert.equal(maintained.name, key); assert.equal(maintained.displayName, 'Preserved reference display');
  assert.equal(maintained.hardwareCount, 1); assert.equal(maintained.driverCount, 1);
  assert.equal(maintained.configRevision, brand.configRevision + 1);

  // Real second-writer conflict must preserve the drawer draft and stop retries.
  await row.getByRole('button', { name: '编辑', exact: true }).click();
  const second = await api(editorEndpoint, 'PUT', { displayName: 'Second administrator', expectedRevision: maintained.configRevision }, admin, true);
  await drawer.getByPlaceholder('给用户看的友好名 (可选)').fill('Keep conflicted brand draft');
  const conflict = page.waitForResponse(response => response.url().endsWith(editorEndpoint) && response.request().method() === 'PUT');
  await drawer.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await conflict).status(), 409);
  await page.locator('.el-alert').filter({ hasText: '请重新读取品牌配置' }).waitFor();
  assert.equal(await drawer.getByPlaceholder('给用户看的友好名 (可选)').inputValue(), 'Keep conflicted brand draft');
  assert.equal(await drawer.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await drawer.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.locator('.el-message-box').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await drawer.getByPlaceholder('给用户看的友好名 (可选)').inputValue(), 'Keep conflicted brand draft');
  await drawer.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.locator('.el-message-box').getByRole('button', { name: '重新读取', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[placeholder="给用户看的友好名 (可选)"]')?.value === 'Second administrator');
  assert.equal((await api(endpoint, 'GET', undefined, admin, true)).configRevision, second.configRevision);
  // A read failure also retains draft and disables further saves.
  const listPattern = /\/api\/brands(?:\?.*)?$/;
  const unavailable = route => route.fulfill({ status: 503, json: { message: 'synthetic offline' } });
  await page.route(listPattern, unavailable);
  try {
    await drawer.getByPlaceholder('给用户看的友好名 (可选)').fill('Keep offline draft');
    await drawer.getByRole('button', { name: '重新读取', exact: true }).click();
    await page.locator('.el-message-box').getByRole('button', { name: '重新读取', exact: true }).click();
    await page.locator('.el-message--error').filter({ hasText: '读取失败' }).waitFor();
    assert.equal(await drawer.getByPlaceholder('给用户看的友好名 (可选)').inputValue(), 'Keep offline draft');
    assert.equal(await drawer.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  } finally { await page.unroute(listPattern, unavailable); }
  await drawer.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '刷新', exact: true }).click();

  // A duplicate referencing write must not leave a phantom automatically-created brand.
  const duplicate = await nodeFetch(backend + '/hardware', {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: key, name: key, category: 'other', model: 'local-test', vendor: key + '-phantom' }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await api('/brands', 'GET', undefined, admin, true)).some(row => row.name === key + '-phantom'), false);

  // Exercise real HTTP concurrency, including the existing operation/audit log services.
  const concurrentHardware = [], concurrentDrivers = [];
  await Promise.all(Array.from({ length: 3 }, async (_, index) => {
    const code = key + '-parallel-' + index;
    const [created] = await Promise.all([
      api('/hardware', 'POST', { code, name: code, category: 'other', model: 'test', vendor: key }, admin, true),
      api('/drivers', 'POST', { kind: code, displayName: code, vendor: key, category: 'custom', protocol: 'custom', capabilities: [] }, admin, true),
      api(endpoint, 'PUT', { remark: 'Concurrent metadata ' + index }, admin, true),
    ]);
    concurrentHardware.push(created.id); concurrentDrivers.push(code);
  }));
  const concurrentBrand = await api(endpoint, 'GET', undefined, admin, true);
  assert.equal(concurrentBrand.hardwareCount, 4); assert.equal(concurrentBrand.driverCount, 4);
  await Promise.all([
    ...concurrentHardware.map(id => api('/hardware/' + id, 'DELETE', undefined, admin, true)),
    ...concurrentDrivers.map(kind => api('/drivers/' + kind, 'DELETE', undefined, admin, true)),
  ]);
  await api('/hardware/' + hardware.id, 'DELETE', undefined, admin, true);
  assert.equal((await request('DELETE')).status, 409);
  await api('/drivers/' + encodeURIComponent(key), 'DELETE', undefined, admin, true);
  await api(endpoint, 'PUT', { name: key + '-unreferenced' }, admin, true);
  await api(endpoint, 'DELETE', undefined, admin, true);
  assert.equal((await request('GET')).status, 404);
  console.log('PASS brand reference actual API/browser: authenticated metadata editing, linked rename/delete rejected, duplicate rollback and cleanup without device I/O');
};
