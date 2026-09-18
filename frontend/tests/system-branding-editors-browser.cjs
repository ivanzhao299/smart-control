// Exercises the actual three frontend editors against only the disposable
// loopback backend. It intentionally makes no player/device request.
const assert = require('node:assert/strict');

exports.verifySystemBrandingEditors = async ({ page, appBase, api, admin, backend, nodeFetch }) => {
  assert.equal(new URL(backend).hostname, '127.0.0.1');

  // 1. The admin brand editor has a strict baseline, preserves a conflict draft,
  // and only allows a post-conflict write after an explicit fresh read.
  await page.goto(appBase + '/admin/system-branding');
  const systemName = page.locator('.system-branding-admin input[maxlength="80"]').first();
  await systemName.waitFor();
  await page.waitForFunction(() => !document.querySelector('.system-branding-admin form')?.hasAttribute('disabled'));
  await systemName.fill('Synthetic browser brand first');
  const firstBrandSave = page.waitForResponse(r => new URL(r.url()).pathname === '/api/system-branding/editor' && r.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await firstBrandSave).status(), 200);

  const freshBrand = await api('/system-branding', 'GET');
  await api('/system-branding/editor', 'PUT', {
    systemName: 'Synthetic browser brand concurrent',
    expectedRevision: freshBrand.configRevision,
  }, admin, true);
  await systemName.fill('Keep branding conflict draft');
  const brandConflict = page.waitForResponse(r => new URL(r.url()).pathname === '/api/system-branding/editor' && r.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  assert.equal((await brandConflict).status(), 409);
  await page.getByRole('alert').filter({ hasText: '当前品牌配置尚未核实，保存已锁定' }).waitFor();
  assert.equal(await systemName.inputValue(), 'Keep branding conflict draft');
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '刷新核对', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.system-branding-admin input[maxlength="80"]')?.value === 'Synthetic browser brand concurrent');
  assert.equal(await page.getByRole('button', { name: '保存', exact: true }).isDisabled(), false);

  // 2. The LED welcome editor uses the narrow strict endpoint. Its conflict
  // leaves the operator's text visible and locks saving until a deliberate read.
  await page.goto(appBase + '/led');
  const editWelcome = page.getByRole('button', { name: '编辑欢迎页', exact: true });
  await editWelcome.waitFor();
  await editWelcome.click();
  const welcomeTitle = page.getByPlaceholder('热烈欢迎', { exact: true });
  await welcomeTitle.waitFor();
  await welcomeTitle.fill('Welcome first');
  const firstWelcomeSave = page.waitForResponse(r => new URL(r.url()).pathname === '/api/system-branding/welcome/editor' && r.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存并生效', exact: true }).click();
  const welcomeResponse = await firstWelcomeSave;
  assert.equal(welcomeResponse.status(), 200);
  assert.ok(welcomeResponse.request().postDataJSON().expectedRevision > 0);
  await page.locator('.we-box').waitFor({ state: 'detached' });

  await editWelcome.click();
  await welcomeTitle.waitFor();
  const freshWelcome = await api('/system-branding', 'GET');
  await api('/system-branding/welcome/editor', 'PUT', {
    welcomeTitle: 'Welcome remote',
    expectedRevision: freshWelcome.configRevision,
  }, admin, true);
  await welcomeTitle.fill('Keep conflict');
  const welcomeConflict = page.waitForResponse(r => new URL(r.url()).pathname === '/api/system-branding/welcome/editor' && r.request().method() === 'PUT');
  await page.getByRole('button', { name: '保存并生效', exact: true }).click();
  assert.equal((await welcomeConflict).status(), 409);
  await page.getByText('当前配置尚未核实，不能保存或覆盖。').waitFor();
  assert.equal(await welcomeTitle.inputValue(), 'Keep conflict');
  await page.getByRole('button', { name: '刷新核对', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[placeholder="热烈欢迎"]')?.value === 'Welcome remote');

  // 3. Media selection is an admin editor too: it takes a fresh strict
  // baseline, sends its revision to /editor, and can later clear the binding.
  // Create the image under the same named administrator that drives this page;
  // operator-private fixture media is intentionally not assumed to be visible.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfkAAAAASUVORK5CYII=', 'base64');
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'branding-editor-browser.png');
  const imageUpload = await nodeFetch(backend + '/media/upload', {
    method: 'POST', body: form,
    headers: { Authorization: `Bearer ${admin}`, 'X-Upload-Size': String(png.length) },
  });
  assert.equal(imageUpload.status, 201);
  const uploadedImage = (await imageUpload.json()).data;
  await api('/media/' + uploadedImage.id, 'PUT', { visibility: 'shared' }, admin, true);
  await page.goto(appBase + '/media');
  // The user's last-selected grid/list preference is persisted, so select the
  // visible filename rather than coupling this acceptance case to one view.
  const imageName = page.getByText(uploadedImage.originalName, { exact: true }).first();
  await imageName.waitFor();
  await imageName.click();
  const bindWelcome = page.getByRole('button', { name: '设为欢迎页', exact: true });
  await bindWelcome.waitFor();
  const bindResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/system-branding/editor' && r.request().method() === 'PUT');
  await bindWelcome.click();
  const binding = await bindResponse;
  assert.equal(binding.status(), 200);
  const bindingPayload = binding.request().postDataJSON();
  assert.equal(bindingPayload.welcomeMediaId, uploadedImage.id);
  assert.ok(bindingPayload.expectedRevision > 0);
  await page.getByRole('button', { name: '取消欢迎页', exact: true }).waitFor();
  const clearResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/system-branding/editor' && r.request().method() === 'PUT');
  await page.getByRole('button', { name: '取消欢迎页', exact: true }).click();
  assert.equal((await clearResponse).status(), 200);
  assert.equal((await api('/system-branding', 'GET')).welcomeMediaId, null);

  console.log('PASS system branding editors browser: strict baselines, 409 drafts, explicit reload and media bind/clear');
};
