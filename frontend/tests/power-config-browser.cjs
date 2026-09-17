const assert = require('node:assert/strict');

exports.verifyPowerConfiguration = async function (page, appBase, { api, admin, operator, backend, nodeFetch }) {
  assert.equal(new URL(backend).hostname, '127.0.0.1');
  const base = '/power-circuits/configuration';
  const code = 'browser-power-' + Date.now();
  const created = await api(base, 'POST', { code, name: 'Synthetic power', floor: 'TEST', relayChannel: null }, admin, true);
  const endpoint = base + '/' + created.id;
  const request = (body, headers = { Authorization: `Bearer ${admin}` }) => nodeFetch(backend + endpoint, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await request({ name: 'denied', expectedRevision: 1 }, {})).status, 401);
  assert.equal((await request({ name: 'denied', expectedRevision: 1 }, { 'X-Client-Token': operator })).status, 403);
  for (const body of [{ name: 'missing version' }, { expectedRevision: 1, relayChannel: 0 }, { expectedRevision: 1, reading: { on: false } }]) {
    assert.equal((await request(body)).status, 400);
  }
  const commands = [];
  const detect = request => { if (/\/power-circuits\/(?:\d+\/(?:on|off)|sequencer\/)/.test(request.url())) commands.push(request.url()); };
  page.on('request', detect);
  try {
    await page.goto(appBase + '/admin/power-circuits');
    await page.getByPlaceholder('搜索名称 / code / 继电器').fill(code);
    const row = page.locator('.el-table__row').filter({ hasText: code });
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    const drawer = page.locator('.el-drawer'), name = drawer.getByPlaceholder('e.g. 一层总闸');
    await name.fill('Power editor saved');
    const saved = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'PUT');
    await drawer.getByRole('button', { name: '保存', exact: true }).click();
    const savedResponse = await saved;
    assert.equal(savedResponse.status(), 200); assert.equal(savedResponse.request().postDataJSON().relayChannel, null);
    await page.getByText('电源配置已保存，未下发通断电命令', { exact: true }).waitFor();
    await row.getByRole('button', { name: '编辑', exact: true }).click();
    const current = await api(endpoint, 'GET', undefined, admin, true);
    await api(endpoint, 'PUT', { name: 'Second admin version', expectedRevision: current.configRevision }, admin, true);
    await name.fill('Keep power draft');
    const conflict = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() === 'PUT');
    await drawer.getByRole('button', { name: '保存', exact: true }).click();
    assert.equal((await conflict).status(), 409);
    await drawer.getByRole('alert').waitFor();
    assert.equal(await name.inputValue(), 'Keep power draft');
    assert.equal(await drawer.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
    await drawer.getByRole('button', { name: '重新读取', exact: true }).click();
    await page.locator('.el-message-box').getByRole('button', { name: '重新读取', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('input[placeholder="e.g. 一层总闸"]')?.value === 'Second admin version');
    await drawer.getByRole('button', { name: '取消', exact: true }).click();
    await row.locator('.el-switch__core').click();
    await page.getByText('启用配置已更新，未下发设备命令', { exact: true }).waitFor();
    assert.equal((await api(endpoint, 'GET', undefined, admin, true)).enabled, false);
    await row.getByRole('button', { name: '删除', exact: true }).click();
    await page.locator('.el-message-box').getByRole('button', { name: '删除', exact: true }).click();
    await page.getByText('配置已删除', { exact: true }).waitFor();
    assert.equal((await nodeFetch(backend + endpoint, { headers: { Authorization: `Bearer ${admin}` } })).status, 404);

    // The production power page uses synthetic telemetry in this test; never read serial hardware.
    const renameRow = await api(base, 'POST', { code: code + '-inline', name: 'Synthetic inline power', floor: 'TEST' }, admin, true);
    const telemetry = route => route.fulfill({ json: { data: [{ ...renameRow, isBreaker: false,
      reading: { on: true, current: 1, voltage: 220, power: 220, energy: 0, powerFactor: 1, lastReadAt: new Date().toISOString() } }] } });
    const pattern = /\/api\/power-circuits(?:\?.*)?$/;
    await page.route(pattern, telemetry);
    try {
      await page.goto(appBase + '/power');
      await page.getByText('Synthetic inline power', { exact: true }).click();
      await page.locator('.rename-input').fill('Inline saved');
      const renamed = page.waitForResponse(r => r.url().endsWith(base + '/' + renameRow.id) && r.request().method() === 'PUT');
      await page.locator('.rename-input').press('Enter'); assert.equal((await renamed).status(), 200);
      await page.getByText('Inline saved', { exact: true }).waitFor();
      assert.equal((await api(base + '/' + renameRow.id, 'GET', undefined, admin, true)).name, 'Inline saved');
    } finally { await page.goto(appBase + '/admin'); await page.unroute(pattern, telemetry); }
    assert.deepEqual(commands, []);
    console.log('PASS power configuration actual API/browser: strict roles/DTO, nullable addressing, versioned editor conflict/reload, metadata toggle/delete, inline rename and zero switching commands (synthetic telemetry)');
  } finally { page.off('request', detect); }
};
