const assert = require('node:assert/strict');

// Synthetic matrix transport only: never forward a DSP command to a real device.
exports.verifyAudioMatrix = async function verifyAudioMatrix(page, appBase) {
  const writes = [];
  let reads = 0;
  let hardwareOn = false;
  const reply = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data }) });
  const liveHandler = route => {
    reads += 1;
    const matrix = Array.from({ length: 8 }, () => Array(8).fill(false));
    matrix[0][0] = hardwareOn;
    return reply(route, { ok: true, data: { matrix } });
  };
  const writeHandler = route => { writes.push({ route, body: route.request().postDataJSON() }); };
  await page.route('**/api/audio/matrix/live', liveHandler);
  await page.route('**/api/audio/matrix', writeHandler);
  const waitForWrites = async count => {
    for (let attempt = 0; attempt < 100 && writes.length < count; attempt++) await page.waitForTimeout(20);
    assert.equal(writes.length, count, 'Expected exactly one synthetic write per drained intent');
  };
  try {
    await page.goto(appBase + '/audio');
    await page.getByRole('button', { name: '音源矩阵', exact: true }).click();
    await page.locator('.mx-cell').first().waitFor();
    const configuredRows = await page.locator('.mx-rowhead').count();
    const configuredColumns = await page.locator('.mx-colhead').count();
    assert.ok(configuredRows > 0 && configuredColumns > 0);
    assert.equal(await page.locator('.mx-cell').count(), configuredRows * configuredColumns);
    assert.ok(reads > 0);
    const cell = page.locator('.mx-cell').first();
    await cell.click(); await waitForWrites(1);
    assert.deepEqual(writes[0].body, { out: 0, input: 0, on: true });
    await cell.click();
    hardwareOn = true;
    await reply(writes[0].route, { ok: true });
    await waitForWrites(2);
    assert.deepEqual(writes[1].body, { out: 0, input: 0, on: false });
    await reply(writes[1].route, { ok: false, error: 'synthetic acknowledgement failure' });
    await page.getByText('路由 OUT1←IN1 失败: synthetic acknowledgement failure', { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.mx-cell')?.classList.contains('on'));
    // A third request is in flight when leaving; its queued follow-up must never be sent.
    await cell.click(); await waitForWrites(3); await cell.click();
    await page.getByRole('button', { name: '返回首页', exact: true }).click();
    await page.waitForURL(url => !url.pathname.endsWith('/audio'));
    const readsAtLeave = reads;
    hardwareOn = false;
    await reply(writes[2].route, { ok: true });
    await page.waitForTimeout(1500);
    assert.equal(writes.length, 3, 'Deactivated page must drop queued commands');
    assert.equal(reads, readsAtLeave, 'Late completion must not schedule reconciliation while away');
    await page.locator('.v2-nav-item').filter({ hasText: '音响' }).click();
    await page.waitForURL(url => url.pathname.endsWith('/audio'));
    await page.locator('.mx-cell').first().waitFor();
    await page.waitForFunction(() => !document.querySelector('.mx-cell')?.classList.contains('on'));
    assert.ok(reads > readsAtLeave, 'Returning to the cached page reads current device state');
    assert.equal(writes.length, 3, 'Returning must not replay an old click');
    await page.getByRole('button', { name: '返回首页', exact: true }).click();
    await page.waitForURL(url => !url.pathname.endsWith('/audio'));
    console.log('PASS audio matrix browser: coalesced clicks, last-confirmed rollback, no post-leave query/queued write, fresh read on return (synthetic DSP)');
  } finally {
    await page.unroute('**/api/audio/matrix/live', liveHandler);
    await page.unroute('**/api/audio/matrix', writeHandler);
  }
};
