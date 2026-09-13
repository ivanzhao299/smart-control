// Real Chromium storage/service-worker smoke. No production server or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/cross-tab-identity.ts'), 'utf8');
  const moduleCode = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const worker = fs.readFileSync(path.join(__dirname, '../public/sw-privacy.js'), 'utf8');
  const pageHtml = `<!doctype html><title>Isolated privacy acceptance</title><script type="module">
    import {installCrossTabIdentitySync} from '/identity.js';
    window.invalidated = false;
    installCrossTabIdentitySync(window, () => window.localStorage, () => {
      window.invalidated = true;
      sessionStorage.setItem('invalidations', String(Number(sessionStorage.getItem('invalidations') || 0) + 1));
    }, () => {
      sessionStorage.setItem('reloads', String(Number(sessionStorage.getItem('reloads') || 0) + 1));
      window.ready = false;
      location.reload();
    });
    window.ready = true;
  </script>`;
  const server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.url === '/identity.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(moduleCode); }
    else if (req.url === '/old-sw.js') { res.setHeader('Content-Type', 'application/javascript'); res.end("self.addEventListener('install', () => self.skipWaiting());"); }
    else if (req.url === '/sw.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(worker + '\nself.skipWaiting();'); }
    else { res.setHeader('Content-Type', 'text/html'); res.end(pageHtml); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext();
    const origin = `http://127.0.0.1:${server.address().port}`;
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const first = await context.newPage(), second = await context.newPage();
    await Promise.all([first.goto(origin), second.goto(origin)]);
    await Promise.all([first.waitForFunction(() => window.ready), second.waitForFunction(() => window.ready)]);
    await first.evaluate(() => {
      localStorage.setItem('sc.client.token', 'synthetic-account-B');
      localStorage.setItem('sc.client.authServer', 'synthetic-server');
    });
    await second.waitForFunction(() => sessionStorage.getItem('reloads') === '1' && window.ready);
    assert.deepEqual(await second.evaluate(() => ({ token: localStorage.getItem('sc.client.token'), invalidations: sessionStorage.getItem('invalidations'), reloads: sessionStorage.getItem('reloads') })),
      { token: 'synthetic-account-B', invalidations: '1', reloads: '1' });
    assert.equal(await first.evaluate(() => sessionStorage.getItem('reloads')), null);
    await first.evaluate(() => localStorage.removeItem('sc.client.token'));
    await second.waitForFunction(() => sessionStorage.getItem('reloads') === '2' && window.ready);
    assert.equal(await second.evaluate(() => localStorage.getItem('sc.client.token')), null);

    await first.evaluate(async () => {
      await navigator.serviceWorker.register('/old-sw.js');
      await navigator.serviceWorker.ready;
      for (const name of ['api-read', 'static-assets', 'unrelated-test-cache']) {
        const cache = await caches.open(name); await cache.put('/cached-' + name, new Response('synthetic private data'));
      }
      await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
    });
    // Poll the resolved CacheStorage result, not a Promise's truthiness in a page predicate.
    for (let attempt = 0; attempt < 100; attempt++) {
      const names = await first.evaluate(() => caches.keys());
      if (!names.includes('api-read') && !names.includes('static-assets')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.deepEqual(await first.evaluate(() => caches.keys()), ['unrelated-test-cache']);
    console.log('PASS real Chrome: cross-tab account change/logout, single reload per batch, new login preserved, legacy API/media caches removed, unrelated cache preserved');
    const restricted = await browser.newContext({ serviceWorkers: 'block' });
    await restricted.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked for test', 'SecurityError'); } });
    });
    const restrictedPage = await restricted.newPage();
    const errors = [];
    restrictedPage.on('pageerror', error => errors.push(error.message));
    await restrictedPage.goto(origin);
    await restrictedPage.waitForFunction(() => window.ready);
    assert.deepEqual(errors, []);
    assert.equal(await restrictedPage.evaluate(() => window.invalidated), false);
    console.log('PASS real Chrome with injected storage denial: module startup succeeds without invalidation or reload');
    await restricted.close();
    await context.close();
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
