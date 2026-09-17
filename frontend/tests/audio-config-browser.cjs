const assert = require('node:assert/strict');

exports.verifyAudioConfigEditor = async function verifyAudioConfigEditor(page, appBase, { api, admin, operator, backend, nodeFetch }) {
  const initial = (await api('/audio-config/inputs?includeDisabled=1', 'GET', undefined, admin, true))[0];
  assert.ok(initial.configRevision >= 1);
  const request = (route, body, headers = { Authorization: `Bearer ${admin}` }) => nodeFetch(backend + route, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const inputPath = `/audio-config/inputs/${initial.id}`;
  assert.equal((await request(inputPath, { name: 'unauthorized' }, {})).status, 401);
  assert.equal((await request(inputPath, { name: 'not admin' }, { 'X-Client-Token': operator })).status, 403);
  assert.equal((await request(inputPath, { desiredGainDb: 12, expectedRevision: initial.configRevision })).status, 400);
  assert.equal((await request(inputPath, { enabled: 'false', expectedRevision: initial.configRevision })).status, 400);

  const scene = (await api('/audio-config/scenes', 'GET', undefined, admin, true))[0];
  await api(`/audio-config/scenes/${scene.id}`, 'PUT', { hint: 'synthetic concurrent revision', expectedRevision: scene.configRevision }, admin, true);
  const audition = await nodeFetch(backend + `/audio/scene/apply/${scene.presetNum}`, { method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: scene.configRevision }) });
  assert.equal(audition.status, 409, 'Stale audition must be rejected before reaching the adapter');

  await page.goto(appBase + '/admin/audio-config');
  const block = page.locator('.audio-config > .block').filter({ has: page.getByText('输入源 (8 路 · 接音源/话筒/播放器)', { exact: true }) });
  const row = block.locator('.el-table__row').first(), name = row.locator('input').first();
  const save = row.getByRole('button', { name: '保存', exact: true });
  await name.waitFor();
  await name.fill('Synthetic input editor');
  const saved = page.waitForResponse(response => response.url().endsWith(inputPath) && response.request().method() === 'PUT');
  await save.click(); const result = await saved;
  assert.equal(result.status(), 200); assert.equal(result.request().postDataJSON().expectedRevision, initial.configRevision);
  await page.getByText('已保存 IN1: Synthetic input editor', { exact: true }).waitFor();
  const updated = (await api('/audio-config/inputs?includeDisabled=1', 'GET', undefined, admin, true)).find(item => item.id === initial.id);
  await api(inputPath, 'PUT', { name: 'Synthetic second admin', expectedRevision: updated.configRevision }, admin, true);
  await name.fill('Keep audio draft');
  const conflict = page.waitForResponse(response => response.url().endsWith(inputPath) && response.request().method() === 'PUT');
  await save.click(); assert.equal((await conflict).status(), 409);
  await page.getByRole('alert').filter({ hasText: '尚未取得可保存的最新版本' }).waitFor();
  assert.equal(await name.inputValue(), 'Keep audio draft'); assert.equal(await save.isDisabled(), true);
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.getByRole('button', { name: '重新载入', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.audio-config input')].some(input => input.value === 'Synthetic second admin'));
  assert.equal(await save.isDisabled(), false);
  const failRead = route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic catalog offline"}' });
  await page.route('**/api/audio-config/inputs?includeDisabled=1', failRead);
  try {
    await name.fill('Offline draft retained');
    await page.getByRole('button', { name: '刷新', exact: true }).click();
    await page.getByRole('button', { name: '重新载入', exact: true }).click();
    await page.getByText(/读取失败，已暂停保存/).waitFor();
    assert.equal(await save.isDisabled(), true); assert.equal(await name.inputValue(), 'Offline draft retained');
  } finally { await page.unroute('**/api/audio-config/inputs?includeDisabled=1', failRead); }
  console.log('PASS audio config real API/browser: strict DTOs, admin-only writes, versioned save, stale audition rejection, conflict draft preservation and explicit fresh reload');
};
