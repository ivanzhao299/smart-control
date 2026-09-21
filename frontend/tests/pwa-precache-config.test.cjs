const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const config = fs.readFileSync(path.resolve(__dirname, '../vite.config.ts'), 'utf8');

test('PWA icons have one precache source of truth', () => {
  assert.doesNotMatch(config, /includeAssets\s*:/);
  assert.match(config, /globPatterns:\s*\['\*\*\/\*\.\{[^}]*svg[^}]*png[^}]*\}'\]/);
  assert.match(config, /manifestTransforms:/);
  assert.match(config, /Duplicate PWA precache URL/);
  assert.match(config, /icons\/pwa-192x192\.png/);
  assert.match(config, /icons\/pwa-512x512\.png/);
});

test('the generated service worker has no duplicate precache URLs when a build exists', () => {
  const serviceWorker = path.resolve(__dirname, '../dist/sw.js');
  if (!fs.existsSync(serviceWorker)) return;
  const source = fs.readFileSync(serviceWorker, 'utf8');
  const urls = [...source.matchAll(/\burl:"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(urls.length > 0, 'expected a generated Workbox precache');
  assert.equal(new Set(urls).size, urls.length);
});
