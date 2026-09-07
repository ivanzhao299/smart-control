// Requires a disposable MOCK backend on 127.0.0.1:33291, never production.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const backend = 'http://127.0.0.1:33291/api';
async function api(route, method, body, token, admin = false) {
  const response = await fetch(backend + route, { method, redirect: 'error', headers: {
    'Content-Type': 'application/json', ...(token ? admin ? { Authorization: `Bearer ${token}` } : { 'X-Client-Token': token } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${route}: HTTP ${response.status}`);
  return (await response.json()).data;
}
(async () => {
  assert.equal(process.env.SC_DISPOSABLE_BACKEND, 'yes', 'Explicit disposable backend confirmation required');
  assert.ok(process.env.SC_SMOKE_ADMIN_PASSWORD, 'Synthetic backend admin password required');
  const admin = (await api('/admin/auth/login', 'POST', { password: process.env.SC_SMOKE_ADMIN_PASSWORD })).token;
  const nonce = crypto.randomBytes(5).toString('hex');
  const accounts = {};
  for (const role of ['operator', 'otherOperator', 'viewer', 'admin']) {
    const username = `browser_${role}_${nonce}`, password = crypto.randomBytes(20).toString('hex');
    await api('/users', 'POST', { username, password, role: role === 'otherOperator' ? 'operator' : role }, admin, true);
    accounts[role] = { ...await api('/client-auth/login', 'POST', { username, password }), username, password };
  }
  const privateName = 'Private-' + nonce, sharedName = 'Shared-' + nonce;
  await api('/media/webpage', 'POST', { name: privateName, url: 'https://example.test/private' }, accounts.operator.token);
  const shared = await api('/media/webpage', 'POST', { name: sharedName, url: 'https://example.test/shared' }, admin, true);
  await api('/media/' + shared.id, 'PUT', { visibility: 'shared' }, admin, true);
  const uploadName = `private-upload-${nonce}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfkAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), uploadName);
  const uploaded = await fetch(backend + '/media/upload', { method: 'POST', body: form,
    headers: { 'X-Client-Token': accounts.operator.token, 'X-Upload-Size': String(png.length) } });
  assert.ok(uploaded.ok, `private upload: HTTP ${uploaded.status}`);
  const asset = (await uploaded.json()).data;
  const usage = await api('/media/storage/me', 'GET', undefined, accounts.operator.token);
  assert.equal(Number(usage.usedBytes), png.length);
  assert.equal(Number(usage.reservedBytes), 0);
  const preview = await api('/media/' + asset.id + '/access', 'POST', { variant: 'file' }, accounts.operator.token);
  assert.ok(preview.url.startsWith(`/api/media/${asset.id}/stream?`));
  const previewUrl = new URL(preview.url, backend).href;
  const complete = await fetch(previewUrl);
  assert.equal(complete.status, 200);
  assert.equal(complete.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await complete.arrayBuffer()), png);
  const partial = await fetch(previewUrl, { headers: { Range: 'bytes=2-6' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 2-6/${png.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), png.subarray(2, 7));
  const unsatisfied = await fetch(previewUrl, { headers: { Range: 'bytes=99999-' } });
  assert.equal(unsatisfied.status, 416);
  assert.equal((await unsatisfied.arrayBuffer()).byteLength, 0);
  const ownerDirect = await fetch(backend + '/media/' + asset.id + '/file', {
    headers: { 'X-Client-Token': accounts.operator.token, Range: 'bytes=2-6' },
  });
  assert.equal(ownerDirect.status, 206);
  assert.equal(ownerDirect.headers.get('content-range'), `bytes 2-6/${png.length}`);
  assert.deepEqual(Buffer.from(await ownerDirect.arrayBuffer()), png.subarray(2, 7));
  const anonymous = await fetch(backend + '/media/' + asset.id + '/file');
  assert.equal(anonymous.status, 401);
  await anonymous.arrayBuffer();
  for (const role of ['otherOperator', 'viewer']) {
    const visible = await api('/media', 'GET', undefined, accounts[role].token);
    assert.equal(visible.items.some(item => item.id === asset.id), false);
    const directFile = await fetch(backend + '/media/' + asset.id + '/file', { headers: { 'X-Client-Token': accounts[role].token } });
    assert.ok([403, 404].includes(directFile.status), 'Other accounts must not download private bytes');
    await directFile.arrayBuffer();
    for (const method of ['PUT', 'DELETE']) {
      const denied = await fetch(backend + '/media/' + asset.id, { method,
        headers: { 'X-Client-Token': accounts[role].token, 'Content-Type': 'application/json' },
        body: method === 'PUT' ? JSON.stringify({ originalName: 'not-permitted.png' }) : undefined });
      assert.ok([403, 404].includes(denied.status), `${role} ${method} private media must be denied: HTTP ${denied.status}`);
    }
  }
  console.log('PASS real multipart private upload, quota release, second-user isolation and denied mutations');
  const root = path.resolve(__dirname, '../dist');
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const upstream = http.request('http://127.0.0.1:33291' + req.url, { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
    }
    const requestPath = decodeURIComponent(req.url.split('?')[0]).replace(/^\/control\//, '/');
    let file = path.resolve(root, '.' + requestPath);
    if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html');
    const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const role of ['operator', 'otherOperator', 'viewer', 'admin']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(origin + '/client-login?redirect=/media');
      await page.getByPlaceholder('用户名（旧版访问密码可留空）').fill(accounts[role].username);
      await page.getByPlaceholder('密码', { exact: true }).fill(accounts[role].password);
      await page.getByPlaceholder('服务器地址 (e.g. http://192.168.124.11:3200)').fill(origin);
      await page.locator('button[type="submit"]').click();
      await page.getByText(sharedName, { exact: true }).first().waitFor();
      if (role === 'operator' || role === 'admin') {
        await page.getByText(privateName, { exact: true }).first().waitFor();
        await page.getByText(uploadName, { exact: true }).first().waitFor();
        assert.equal(await page.getByText('上传文件', { exact: true }).count(), 1);
      } else {
        assert.equal(await page.getByText(privateName, { exact: true }).count(), 0);
        assert.equal(await page.getByText(uploadName, { exact: true }).count(), 0);
        assert.equal(await page.getByText('上传文件', { exact: true }).count(), role === 'viewer' ? 0 : 1);
      }
      if (role === 'viewer') {
        assert.equal(await page.locator('button[title="删除"]').count(), 0);
        assert.equal(await page.locator('button[title="推送到"]').count(), 0);
      }
      if (role === 'admin') await page.getByText('管理员内容管理', { exact: true }).waitFor();
      else assert.equal(await page.getByText('管理员内容管理', { exact: true }).count(), 0);
      console.log(`PASS built application: ${role} media visibility and controls at 390px`);
      await context.close();
    }
    const owner = await api('/client-auth/me', 'GET', undefined, accounts.operator.token);
    await api('/users/' + owner.userId, 'PUT', { enabled: false }, admin, true);
    const revoked = await fetch(previewUrl);
    assert.equal(revoked.status, 401, 'Previously issued preview must reject a disabled owner');
    await revoked.arrayBuffer();
    console.log('PASS real HTTP private bytes, range/416, anonymous/other-user denial and preview revocation');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
