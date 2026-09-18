// Requires a disposable MOCK backend on 127.0.0.1:33291, never production.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { WebSocket } = require('../../backend/node_modules/ws');
const { verifyAudioMatrix } = require('./audio-matrix-browser.cjs');
const { verifyAudioConfigEditor } = require('./audio-config-browser.cjs');
const { verifyParkOpsLayout } = require('./park-ops-layout-browser.cjs');
const { verifyPowerConfiguration } = require('./power-config-browser.cjs');
const { verifyBrandReferenceIntegrity } = require('./brand-reference-browser.cjs');
const { verifySystemBrandingApi } = require('./system-branding-api.cjs');
const backend = 'http://127.0.0.1:33291/api';
function nodeFetch(url, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('Connection', 'close');
  return fetch(url, { ...init, headers });
}
async function api(route, method, body, token, admin = false) {
  const response = await nodeFetch(backend + route, { method, redirect: 'error', headers: {
    'Content-Type': 'application/json', ...(token ? admin ? { Authorization: `Bearer ${token}` } : { 'X-Client-Token': token } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${route}: HTTP ${response.status}`);
  return (await response.json()).data;
}
(async () => {
  assert.equal(process.env.SC_DISPOSABLE_BACKEND, 'yes', 'Explicit disposable backend confirmation required');
  assert.ok(process.env.SC_SMOKE_ADMIN_USERNAME, 'Synthetic named administrator required');
  assert.ok(process.env.SC_SMOKE_ADMIN_PASSWORD, 'Synthetic backend admin password required');
  const admin = (await api('/admin/auth/login', 'POST', {
    username: process.env.SC_SMOKE_ADMIN_USERNAME,
    password: process.env.SC_SMOKE_ADMIN_PASSWORD,
  })).token;
  const originalVideoBinding = await api('/video-binding', 'GET', undefined, admin, true);
  const toggledAiBox = originalVideoBinding.aiBoxEnabled === false;
  await api('/video-binding/ai/box', 'PUT', {
    enabled: toggledAiBox,
    expectedRevision: originalVideoBinding.revision,
  }, admin, true);
  const staleVideoWrite = await nodeFetch(backend + '/video-binding/layout', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      columns: originalVideoBinding.displayLayout.columns,
      channelIds: originalVideoBinding.displayLayout.channelIds,
      expectedRevision: originalVideoBinding.revision,
    }),
  });
  assert.equal(staleVideoWrite.status, 409);
  assert.equal((await staleVideoWrite.json()).code, 'VIDEO_BINDING_REVISION_CONFLICT');
  const changedVideoBinding = await api('/video-binding', 'GET', undefined, admin, true);
  assert.equal(changedVideoBinding.revision, originalVideoBinding.revision + 1);
  assert.equal(changedVideoBinding.aiBoxEnabled, toggledAiBox);
  await api('/video-binding/ai/box', 'PUT', {
    enabled: originalVideoBinding.aiBoxEnabled !== false,
    expectedRevision: changedVideoBinding.revision,
  }, admin, true);
  const restoredVideoBinding = await api('/video-binding', 'GET', undefined, admin, true);
  assert.equal(restoredVideoBinding.revision, originalVideoBinding.revision + 2);
  assert.equal(restoredVideoBinding.aiBoxEnabled, originalVideoBinding.aiBoxEnabled !== false);
  await api('/video-binding/ai/box', 'PUT', {
    enabled: restoredVideoBinding.aiBoxEnabled,
    expectedRevision: restoredVideoBinding.revision,
  }, admin, true);
  const noOpVideoBinding = await api('/video-binding', 'GET', undefined, admin, true);
  assert.equal(noOpVideoBinding.revision, restoredVideoBinding.revision);
  console.log('PASS video-binding revision conflict, reversible write and no-op suppression through real API');
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
  for (const slot of [1, 2, 3]) {
    await api('/playback/playlist/' + slot, 'POST', { mediaId: shared.id, title: `Historical-list-${slot}-${nonce}` }, admin, true);
  }
  const uploadName = `private-upload-${nonce}.png`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfkAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), uploadName);
  const uploaded = await nodeFetch(backend + '/media/upload', { method: 'POST', body: form,
    headers: { 'X-Client-Token': accounts.operator.token, 'X-Upload-Size': String(png.length) } });
  assert.ok(uploaded.ok, `private upload: HTTP ${uploaded.status}`);
  const asset = (await uploaded.json()).data;
  const usage = await api('/media/storage/me', 'GET', undefined, accounts.operator.token);
  assert.equal(Number(usage.usedBytes), png.length);
  assert.equal(Number(usage.reservedBytes), 0);
  const preview = await api('/media/' + asset.id + '/access', 'POST', { variant: 'file' }, accounts.operator.token);
  assert.ok(preview.url.startsWith(`/api/media/${asset.id}/stream?`));
  const previewUrl = new URL(preview.url, backend).href;
  const complete = await nodeFetch(previewUrl);
  assert.equal(complete.status, 200);
  assert.equal(complete.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await complete.arrayBuffer()), png);
  const partial = await nodeFetch(previewUrl, { headers: { Range: 'bytes=2-6' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 2-6/${png.length}`);
  assert.deepEqual(Buffer.from(await partial.arrayBuffer()), png.subarray(2, 7));
  const unsatisfied = await nodeFetch(previewUrl, { headers: { Range: 'bytes=99999-' } });
  assert.equal(unsatisfied.status, 416);
  assert.equal((await unsatisfied.arrayBuffer()).byteLength, 0);
  const ownerDirect = await nodeFetch(backend + '/media/' + asset.id + '/file', {
    headers: { 'X-Client-Token': accounts.operator.token, Range: 'bytes=2-6' },
  });
  assert.equal(ownerDirect.status, 206);
  assert.equal(ownerDirect.headers.get('content-range'), `bytes 2-6/${png.length}`);
  assert.deepEqual(Buffer.from(await ownerDirect.arrayBuffer()), png.subarray(2, 7));
  const anonymous = await nodeFetch(backend + '/media/' + asset.id + '/file');
  assert.equal(anonymous.status, 401);
  await anonymous.arrayBuffer();
  for (const role of ['otherOperator', 'viewer']) {
    const visible = await api('/media', 'GET', undefined, accounts[role].token);
    assert.equal(visible.items.some(item => item.id === asset.id), false);
    const directFile = await nodeFetch(backend + '/media/' + asset.id + '/file', { headers: { 'X-Client-Token': accounts[role].token } });
    assert.ok([403, 404].includes(directFile.status), 'Other accounts must not download private bytes');
    await directFile.arrayBuffer();
    for (const method of ['PUT', 'DELETE']) {
      const denied = await nodeFetch(backend + '/media/' + asset.id, { method,
        headers: { 'X-Client-Token': accounts[role].token, 'Content-Type': 'application/json' },
        body: method === 'PUT' ? JSON.stringify({ originalName: 'not-permitted.png' }) : undefined });
      assert.ok([403, 404].includes(denied.status), `${role} ${method} private media must be denied: HTTP ${denied.status}`);
    }
  }
  console.log('PASS real multipart private upload, quota release, second-user isolation and denied mutations');
  const root = path.resolve(__dirname, '../dist');
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const upstream = http.request('http://127.0.0.1:33291' + req.url, {
        method: req.method,
        headers: { ...req.headers, connection: 'close' },
      }, response => {
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
    const appBase = `${origin}/control`;
    assert.ok(process.env.SC_SMOKE_PLAYER_TOKEN, 'Synthetic device credential required');
    const kiosk = await browser.newContext({ serviceWorkers: 'block' });
    const playerSockets = [];
    const socketAttempts = [];
    const playerHellos = new Map();
    const playerChanges = new Map();
    const helloCount = slot => playerHellos.get(slot) || 0;
    const changeCount = slot => playerChanges.get(slot) || 0;
    await kiosk.routeWebSocket('**/*', socket => {
      socketAttempts.push(socket.url());
      if (socket.url() !== 'ws://localhost:3200/ws/status') { socket.close(); return; }
      // Playwright connectToServer() cannot rewrite the destination URL. Bridge
      // explicitly to the isolated backend; never connect to real port 3200.
      const upstream = new WebSocket('ws://127.0.0.1:33291/ws/status');
      const pending = [];
      upstream.on('open', () => pending.splice(0).forEach(message => upstream.send(message)));
      upstream.on('error', () => socket.close());
      upstream.on('close', () => socket.close());
      socket.onClose(() => upstream.close());
      let device = false;
      let deviceSlot = null;
      socket.onMessage(message => {
        const parsed = JSON.parse(String(message));
        if (parsed.event === 'authenticate_player') {
          device = true;
          deviceSlot = Number(parsed.data?.slot);
        }
        if (device && !playerSockets.some(pair => pair.socket === socket)) playerSockets.push({ socket, upstream, slot: deviceSlot });
        if (upstream.readyState === WebSocket.OPEN) upstream.send(message);
        else pending.push(message);
      });
      upstream.on('message', message => {
        const parsed = JSON.parse(String(message));
        if (device && Number.isInteger(deviceSlot) && parsed.type === 'hello') {
          playerHellos.set(deviceSlot, helloCount(deviceSlot) + 1);
        }
        if (device && Number.isInteger(deviceSlot) && parsed.type === 'playback_channel_changed') {
          playerChanges.set(deviceSlot, changeCount(deviceSlot) + 1);
        }
        socket.send(String(message));
      });
    });
    await kiosk.route('**/*', async route => {
      const url = route.request().url();
      // PlayerPage intentionally forces localhost:3200. Redirect only inside this
      // isolated test context, never touch a developer's real local backend.
      if (url.startsWith('http://localhost:3200/api/')) {
        const response = await route.fetch({ url: url.replace('http://localhost:3200/api', backend) });
        return route.fulfill({ response });
      }
      return url.startsWith(origin + '/') ? route.continue() : route.abort();
    });
    let player = await kiosk.newPage();
    await player.goto(appBase + '/player?slot=1');
    await player.locator('.device-setup').waitFor();
    assert.equal(await player.locator('input[type="checkbox"]').isChecked(), false);
    await player.locator('input[type="password"]').fill(process.env.SC_SMOKE_PLAYER_TOKEN);
    const configured = player.waitForResponse(r => r.url().endsWith('/player-device/1/state') && r.status() === 200);
    await player.getByRole('button', { name: '连接播放器' }).click();
    await configured;
    await player.close();
    player = await kiosk.newPage();
    await player.goto(appBase + '/player?slot=1');
    await player.locator('.device-setup').waitFor();
    await player.locator('input[type="password"]').fill(process.env.SC_SMOKE_PLAYER_TOKEN);
    await player.locator('input[type="checkbox"]').check();
    const remembered = player.waitForResponse(r => r.url().endsWith('/player-device/1/state') && r.status() === 200);
    await player.getByRole('button', { name: '连接播放器' }).click();
    await remembered;
    await player.close();
    player = await kiosk.newPage();
    const helloBeforeOpen = helloCount(1);
    const reconnected = player.waitForResponse(r => r.url().endsWith('/player-device/1/state') && r.status() === 200);
    await player.goto(appBase + '/player?slot=1');
    await reconnected;
    await player.locator('.device-setup').waitFor({ state: 'hidden' });
    // Real authenticated WS + real REST + rendered image. The 30s fallback is
    // unchanged, so a <2s result cannot be explained by shortening the poll.
    await player.waitForFunction(() => !localStorage.getItem('sc.client.token'));
    const helloDeadline = Date.now() + 5000;
    while (helloCount(1) <= helloBeforeOpen && Date.now() < helloDeadline) await new Promise(r => setTimeout(r, 20));
    assert.ok(helloCount(1) > helloBeforeOpen, `Dedicated device must authenticate its realtime socket (attempts: ${socketAttempts.join(', ')})`);
    const publishAt = Date.now();
    await api('/playback/channels/1/publish', 'POST', { mediaId: asset.id }, accounts.operator.token);
    await player.waitForFunction(() => {
      const img = document.querySelector('img.media-el');
      return img && img.complete && img.naturalWidth > 0;
    }, undefined, { timeout: 2000 });
    console.log(`PASS device-only publish to rendered image: ${Date.now() - publishAt}ms`);
    const replacementForm = new FormData();
    replacementForm.append('file', new Blob([png], { type: 'image/png' }), `switch-target-${nonce}.png`);
    const replacementResponse = await nodeFetch(backend + '/media/upload', { method: 'POST', body: replacementForm,
      headers: { 'X-Client-Token': accounts.operator.token, 'X-Upload-Size': String(png.length) } });
    assert.ok(replacementResponse.ok, 'Synthetic replacement upload must succeed');
    const replacementAsset = (await replacementResponse.json()).data;
    for (const mediaId of [replacementAsset.id, asset.id, replacementAsset.id]) {
      const oldSrc = await player.locator('img.media-el').getAttribute('src');
      const started = Date.now();
      await api('/playback/channels/1/publish', 'POST', { mediaId }, accounts.operator.token);
      const accepted = Date.now();
      await player.waitForFunction(previous => {
        const img = document.querySelector('img.media-el');
        return img && img.getAttribute('src') !== previous && img.complete && img.naturalWidth > 0;
      }, oldSrc, { timeout: 2000 });
      console.log(`PASS content replacement: ${Date.now() - started}ms total, ${Date.now() - accepted}ms after API success`);
    }
    // Stop while disconnected: authenticated hello must reconcile immediately.
    const beforeReconnect = helloCount(1);
    const liveSocket = playerSockets.findLast(pair => pair.slot === 1);
    liveSocket.socket.close({ code: 1001 }); liveSocket.upstream.close();
    const stopAt = Date.now();
    await api('/playback/channels/1/stop', 'POST', {}, accounts.operator.token);
    await player.locator('img.media-el').waitFor({ state: 'detached', timeout: 3000 });
    assert.ok(helloCount(1) > beforeReconnect, 'Missed change reconciled by authenticated reconnect');
    console.log(`PASS missed stop reconciled after reconnect: ${Date.now() - stopAt}ms`);
    await player.close();
    player = await kiosk.newPage();
    await player.goto(appBase + '/player?slot=2');
    await player.locator('.device-setup').waitFor();
    await player.close();
    const extraTokens = JSON.parse(process.env.SC_SMOKE_EXTRA_PLAYER_TOKENS || '{}');
    for (const slot of [2, 3]) {
      assert.ok(extraTokens[slot], 'Separate synthetic credential required for each player channel');
      player = await kiosk.newPage();
      await player.goto(appBase + '/player?slot=' + slot);
      await player.locator('.device-setup').waitFor();
      const previousHellos = helloCount(slot);
      await player.locator('input[type="password"]').fill(extraTokens[slot]);
      await player.getByRole('button', { name: '连接播放器' }).click();
      const deadline = Date.now() + 5000;
      while (helloCount(slot) <= previousHellos && Date.now() < deadline) await new Promise(r => setTimeout(r, 20));
      assert.ok(helloCount(slot) > previousHellos, `Slot ${slot} needs authenticated realtime delivery`);
      const started = Date.now();
      const previousChanges = changeCount(slot);
      await api(`/playback/channels/${slot}/publish`, 'POST', { mediaId: asset.id }, accounts.operator.token);
      try {
        await player.waitForFunction(() => {
          const img = document.querySelector('img.media-el');
          return img && img.complete && img.naturalWidth > 0;
        }, undefined, { timeout: 2000 });
      } catch (error) {
        const diagnostic = await player.evaluate(() => ({ body: document.body.innerText.slice(0, 500), url: location.href }));
        throw new Error(`Slot ${slot} did not render after ${changeCount(slot) - previousChanges} realtime changes: ${JSON.stringify(diagnostic)}`, { cause: error });
      }
      console.log(`PASS browser slot ${slot} device-only publish to rendered image: ${Date.now() - started}ms`);
      await api(`/playback/channels/${slot}/stop`, 'POST', {}, accounts.operator.token);
      await player.close();
    }
    await kiosk.close();
    console.log('PASS real kiosk window replacement: session-only expires, opt-in reconnects, channel stays isolated');
    for (const role of ['operator', 'otherOperator', 'viewer', 'admin']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      await context.addInitScript(() => {
        const schedule = window.setTimeout.bind(window);
        window.setTimeout = (handler, delay, ...args) => schedule(handler, delay === 50 ? 1000 : delay, ...args);
      });
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      const page = await context.newPage();
      await page.goto(appBase + '/client-login?redirect=/media');
      await page.getByPlaceholder('用户名', { exact: true }).fill(accounts[role].username);
      await page.getByPlaceholder('密码', { exact: true }).fill(accounts[role].password);
      await page.getByPlaceholder('服务器地址 (e.g. http://192.168.124.11:3200)').fill(origin);
      await page.waitForTimeout(1100);
      assert.ok(await page.getByPlaceholder('服务器地址 (e.g. http://192.168.124.11:3200)').evaluate(input => document.activeElement === input), `${role}: delayed autofocus must not steal server-field focus`);
      const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/client-auth/login' && response.request().method() === 'POST');
      await page.locator('button[type="submit"]').click();
      const response = await loginResponse;
      const submitted = response.request().postDataJSON();
      assert.ok(submitted.username === accounts[role].username, `${role}: login form must submit the entered username`);
      assert.ok(submitted.password === accounts[role].password, `${role}: login form must submit the entered password (server address substituted: ${submitted.password === origin})`);
      assert.equal(response.status(), 200, `${role}: browser login must succeed before checking media`);
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
      if (role === 'admin') {
        for (const [route, slot] of [['led', 1], ['projector', 2], ['audio', 3]]) {
          await page.goto(appBase + '/' + route);
          await page.getByText(`Historical-list-${slot}-${nonce}`, { exact: true }).first().waitFor();
        }
        console.log('PASS named admin at 390px sees historical shared LED, projector and music playlists');
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(appBase + '/admin');
        await page.getByRole('button', { name: '返回设备控制', exact: true }).waitFor();
        assert.equal(await page.locator('.meta .el-select').count(), 0, 'No fake local role selector');
        await page.getByRole('button', { name: '返回设备控制', exact: true }).click();
        await page.goto(appBase + '/lighting');
        await page.reload();
        try { await page.locator('.v2-zone button.v2-toggle').first().waitFor({ timeout: 10000 }); }
        catch (error) { console.log('Device UI diagnostic', page.url(), (await page.locator('body').innerText()).slice(0, 700)); throw error; }
        const command = page.waitForResponse(r => /\/api\/lighting\/zone\/\d+\/(on|off)$/.test(r.url()) && r.request().method() === 'POST');
        await page.locator('.v2-zone button.v2-toggle').first().click();
        const result = await command;
        assert.ok(result.ok(), 'Named administrator controls devices after backend navigation and reload');
        assert.equal((await result.json()).data.ok, true, 'MOCK lighting adapter actually accepted the operation');
        console.log('PASS named administrator: enter management without second password, return, reload and actual lighting control request');

        await verifyAudioMatrix(page, appBase);
        await verifyAudioConfigEditor(page, appBase, { api, admin, operator: accounts.operator.token, backend, nodeFetch });
        await verifyParkOpsLayout(context, appBase, { api, admin, operator: accounts.operator.token, backend, nodeFetch });
        await verifyPowerConfiguration(page, appBase, { api, admin, operator: accounts.operator.token, backend, nodeFetch });
        await verifyBrandReferenceIntegrity(page, appBase, { api, admin, operator: accounts.operator.token, backend, nodeFetch });
        await verifySystemBrandingApi({ api, admin, operator: accounts.operator.token, backend, nodeFetch });

        // Two editors cannot silently overwrite each other. This only writes the disposable SQLite domain.
        await page.goto(appBase + '/admin/park-ops-metrics');
        const sourceInput = page.locator('input[maxlength="200"]');
        const saveMetrics = page.getByRole('button', { name: '保存并发布到大屏', exact: true });
        await sourceInput.waitFor();
        await sourceInput.fill('Synthetic operations first editor');
        const savedMetrics = page.waitForResponse(r => r.url().endsWith('/park-ops-metrics/editor') && r.request().method() === 'PUT');
        await saveMetrics.click();
        assert.equal((await savedMetrics).status(), 200);
        await page.getByText('已发布，运营大屏约 15 秒内自动更新（或点强制刷新立即生效）。', { exact: true }).waitFor();
        const firstSnapshot = await api('/park-ops-metrics/editor', 'GET', undefined, admin, true);
        assert.ok(firstSnapshot.revision > 0);
        await api('/park-ops-metrics/editor', 'PUT', {
          document: { ...firstSnapshot.document, source: 'Synthetic concurrent administrator' },
          expectedRevision: firstSnapshot.revision,
        }, admin, true);
        await sourceInput.fill('Keep this conflicting draft');
        const conflictMetrics = page.waitForResponse(r => r.url().endsWith('/park-ops-metrics/editor') && r.request().method() === 'PUT');
        await saveMetrics.click();
        assert.equal((await conflictMetrics).status(), 409);
        await page.getByRole('alert').filter({ hasText: '尚未取得可保存的最新版本' }).waitFor();
        assert.equal(await sourceInput.inputValue(), 'Keep this conflicting draft');
        assert.equal(await saveMetrics.isDisabled(), true);
        const displayedMetrics = await api('/park-ops-metrics', 'GET');
        assert.equal(displayedMetrics.source, 'Synthetic concurrent administrator');
        assert.equal('document' in displayedMetrics, false, 'Public LED document contract remains unchanged');
        await page.getByRole('button', { name: '重新载入最新版本', exact: true }).click();
        await page.getByRole('button', { name: '重新载入', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('input[maxlength="200"]')?.value === 'Synthetic concurrent administrator');
        assert.equal(await saveMetrics.isDisabled(), false);
        await context.route('**/api/park-ops-metrics/editor', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"synthetic offline"}' }));
        await page.reload();
        await page.getByRole('alert').filter({ hasText: '尚未取得可保存的最新版本' }).waitFor();
        assert.equal(await saveMetrics.isDisabled(), true);
        console.log('PASS real operations editor: versioned save, 409 retains draft, explicit reload, failed read blocks defaults, public display contract retained');
      }
      console.log(`PASS built application: ${role} media visibility and controls at 390px`);
      await context.close();
    }
    // Reproduce the deployed regression: a compatibility-period read-only token
    // coexists with named administrator login. Returning/reloading must preserve
    // the named session while removing retired browser password storage.
    const legacy = {
      token: process.env.SC_SMOKE_LEGACY_TOKEN,
      expiresAt: process.env.SC_SMOKE_LEGACY_TOKEN_EXPIRES_AT,
    };
    assert.ok(legacy.token && legacy.expiresAt, 'Synthetic legacy read-only token required');
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    await phone.addInitScript(({ token, expiresAt, origin, password }) => {
      if (!sessionStorage.getItem('phone.initialized')) {
        sessionStorage.setItem('phone.initialized', 'yes');
        localStorage.setItem('sc.client.token', token);
        localStorage.setItem('sc.client.token.expiresAt', expiresAt);
        localStorage.setItem('sc.client.authServer', origin + '/api');
        localStorage.setItem('sc.client.savedPassword', '1234');
      }
      window.bioCalls = 0;
      window.JinhuShell = {
        platform: 'ios',
        bioInfoScoped: () => { window.bioCalls++; return JSON.stringify({ available: true, saved: true }); },
        requestBioLoginScoped: () => { window.bioCalls++; window.__jinhuBioLoginOk(password); },
        saveBioPasswordScoped: () => { window.bioCalls++; },
      };
    }, { ...legacy, origin, password: accounts.admin.password });
    const mobile = await phone.newPage();
    await mobile.goto(appBase + '/lighting');
    await mobile.waitForURL(url => url.pathname.endsWith('/client-login'));
    await mobile.getByRole('status').filter({ hasText: '尚未绑定用户' }).waitFor();
    const face = mobile.getByRole('button', { name: '面容 / 指纹登录' });
    assert.equal(await face.count(), 0, 'Face ID login is removed on iOS even with saved biometric credentials');
    assert.equal(await mobile.evaluate(() => window.bioCalls), 0, 'Do not call the retired iOS biometric bridge');
    assert.equal(await mobile.evaluate(() => localStorage.getItem('sc.client.token')), null);
    assert.equal(await mobile.evaluate(() => localStorage.getItem('sc.client.savedPassword')), null,
      'Legacy browser plaintext passwords must be purged during session migration');
    await mobile.getByPlaceholder('用户名', { exact: true }).fill(accounts.admin.username);
    await mobile.getByPlaceholder('密码', { exact: true }).fill(accounts.admin.password);
    await mobile.locator('button[type="submit"]').click();
    await mobile.waitForURL(url => url.pathname.endsWith('/lighting'));
    await mobile.reload();
    const migratedCommand = mobile.waitForResponse(r => /\/api\/lighting\/zone\/\d+\/(on|off)$/.test(r.url()) && r.request().method() === 'POST');
    await mobile.locator('.v2-zone button.v2-toggle').first().click();
    assert.equal((await (await migratedCommand).json()).data.ok, true);
    assert.equal(await mobile.evaluate(() => window.bioCalls), 0, 'Ordinary iOS login must not save biometric credentials');
    await phone.close();
    console.log('PASS 390px iOS: retired Face ID hidden, ordinary named-account login and control survive reload');
    const management = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
    await management.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    await management.addInitScript(({ token, expiresAt, origin }) => {
      if (sessionStorage.getItem('test.initialized')) return;
      sessionStorage.setItem('test.initialized', 'yes');
      localStorage.setItem('sc.client.token', token);
      localStorage.setItem('sc.client.token.expiresAt', expiresAt);
      localStorage.setItem('sc.client.authServer', origin + '/api');
      localStorage.setItem('sc.role', 'admin'); // Must not grant any authority.
    }, { ...legacy, origin });
    const control = await management.newPage();
    await control.goto(appBase + '/admin/login');
    await control.getByPlaceholder('管理员用户名', { exact: true }).fill(process.env.SC_SMOKE_ADMIN_USERNAME);
    await control.getByPlaceholder('管理员密码', { exact: true }).fill(process.env.SC_SMOKE_ADMIN_PASSWORD);
    await control.locator('button[type="submit"]').click();
    await control.getByRole('button', { name: '返回设备控制', exact: true }).click();
    await control.waitForURL(url => url.pathname.endsWith('/control/'));
    const returnState = await control.evaluate(() => ({
      hasAdmin: !!sessionStorage.getItem('sc.adminToken'),
      hasPersistedAdmin: !!localStorage.getItem('sc.adminToken.persist'),
      hasClient: !!localStorage.getItem('sc.client.token'),
    }));
    assert.deepEqual(returnState, { hasAdmin: true, hasPersistedAdmin: true, hasClient: true },
      'Returning to controls must preserve both named admin and compatibility client sessions');
    await control.goto(appBase + '/lighting');
    const lightingState = await control.evaluate(() => ({
      hasAdmin: !!sessionStorage.getItem('sc.adminToken'),
      hasPersistedAdmin: !!localStorage.getItem('sc.adminToken.persist'),
      hasClient: !!localStorage.getItem('sc.client.token'),
      adminServer: sessionStorage.getItem('sc.adminAuthServer'),
      persistedServer: JSON.parse(localStorage.getItem('sc.adminToken.persist') || 'null')?.server || null,
      clientServer: localStorage.getItem('sc.client.authServer'),
      pageApi: location.origin + '/api',
    }));
    assert.equal(lightingState.hasAdmin, true, `Direct control navigation lost admin session: ${JSON.stringify(lightingState)}`);
    assert.equal(lightingState.hasPersistedAdmin, true, `Direct control navigation lost persisted admin session: ${JSON.stringify(lightingState)}`);
    assert.equal(lightingState.hasClient, true, `Direct control navigation lost client session: ${JSON.stringify(lightingState)}`);
    assert.equal(lightingState.adminServer, lightingState.pageApi, `Admin session server drifted: ${JSON.stringify(lightingState)}`);
    assert.equal(lightingState.persistedServer, lightingState.pageApi, `Persisted admin server drifted: ${JSON.stringify(lightingState)}`);
    assert.equal(lightingState.clientServer, lightingState.pageApi, `Client session server drifted: ${JSON.stringify(lightingState)}`);
    await control.reload();
    try {
      await control.locator('.v2-zone button.v2-toggle').first().waitFor({ timeout: 10000 });
    } catch (error) {
      const pageDiagnostic = await control.evaluate(() => ({
        body: document.body.innerText.slice(0, 800),
        url: location.href,
        hasAdmin: !!sessionStorage.getItem('sc.adminToken'),
        hasClient: !!localStorage.getItem('sc.client.token'),
      }));
      throw new Error(`Named administrator could not return to lighting: ${JSON.stringify(pageDiagnostic)}`, { cause: error });
    }
    const command = control.waitForResponse(r => /\/api\/lighting\/zone\/\d+\/(on|off)$/.test(r.url()) && r.request().method() === 'POST');
    await control.locator('.v2-zone button.v2-toggle').first().click();
    const executed = await command;
    assert.ok(executed.ok(), 'Admin session must survive returning to controls and reload');
    assert.equal((await executed.json()).data.ok, true, 'Named admin reaches the MOCK lighting adapter');
    assert.ok(executed.request().headers().authorization?.startsWith('Bearer '), 'Actual device request carries restored admin credential');
    const denied = await nodeFetch(backend + '/lighting/zone/1/on', { method: 'POST', headers: { 'X-Client-Token': legacy.token } });
    assert.equal(denied.status, 403, 'Legacy-only access stays read-only');
    const viewerDenied = await nodeFetch(backend + '/lighting/zone/1/on', { method: 'POST', headers: { 'X-Client-Token': accounts.viewer.token } });
    assert.equal(viewerDenied.status, 403, 'Named viewer stays read-only');
    await control.goto(appBase + '/admin');
    await control.getByRole('button', { name: '退出登录', exact: true }).click();
    await control.getByRole('button', { name: '退出', exact: true }).click();
    await control.waitForURL(url => url.pathname.endsWith('/client-login'));
    assert.deepEqual(await control.evaluate(() => ({ admin: sessionStorage.getItem('sc.adminToken'), client: localStorage.getItem('sc.client.token') })), { admin: null, client: null });
    await management.close();
    console.log('PASS named administrator + old client session: return/reload preserves device authority; legacy/viewer remain denied');
    const owner = await api('/client-auth/me', 'GET', undefined, accounts.operator.token);
    await api('/users/' + owner.userId, 'PUT', { enabled: false }, admin, true);
    const revoked = await nodeFetch(previewUrl);
    assert.equal(revoked.status, 401, 'Previously issued preview must reject a disabled owner');
    await revoked.arrayBuffer();
    console.log('PASS real HTTP private bytes, range/416, anonymous/other-user denial and preview revocation');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections?.();
    });
  }
})().catch(error => { console.error(error?.stack || error?.message || error); process.exitCode = 1; });
