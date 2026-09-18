const assert = require('node:assert/strict');

// Synthetic loopback only. No LED commands, player changes or production photos.
exports.verifySystemBrandingApi = async ({ api, admin, operator, backend, nodeFetch }) => {
  assert.equal(new URL(backend).hostname, '127.0.0.1');
  const endpoint = '/system-branding', before = await api(endpoint, 'GET');
  const request = (path, body, headers = { Authorization: `Bearer ${admin}` }) => nodeFetch(backend + path, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  for (const path of [endpoint, endpoint + '/welcome', endpoint + '/editor', endpoint + '/welcome/editor']) {
    assert.equal((await request(path, { welcomeGuest: 'denied', expectedRevision: before.configRevision }, {})).status, 401);
    assert.equal((await request(path, { welcomeGuest: 'denied', expectedRevision: before.configRevision }, { 'X-Client-Token': operator })).status, 403);
  }
  for (const body of [{ welcomeGuest: 'missing version' }, { expectedRevision: before.configRevision, operator: 'forged' }, { expectedRevision: before.configRevision, logoUrl: 'javascript:alert(1)' }]) {
    assert.equal((await request(endpoint + '/editor', body)).status, 400);
  }
  assert.equal((await request(endpoint + '/welcome/editor', { expectedRevision: before.configRevision, systemName: 'out of scope' })).status, 400);
  const saved = await api(endpoint + '/editor', 'PUT', { systemName: 'Synthetic branding', expectedRevision: before.configRevision }, admin, true);
  assert.equal(saved.configRevision, before.configRevision + 1);
  const stale = await request(endpoint + '/welcome/editor', { welcomeGuest: 'stale', expectedRevision: before.configRevision });
  assert.equal(stale.status, 409); assert.equal((await stale.json()).code, 'SYSTEM_BRANDING_REVISION_CONFLICT');
  assert.equal((await api(endpoint + '/editor', 'PUT', { systemName: saved.systemName, expectedRevision: saved.configRevision }, admin, true)).configRevision, saved.configRevision);

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRfkAAAAASUVORK5CYII=', 'base64');
  const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'welcome-contract.png');
  form.append('remark', 'welcome-photo');
  const uploaded = await nodeFetch(backend + '/media/upload', { method: 'POST', body: form, headers: { Authorization: `Bearer ${admin}`, 'X-Upload-Size': String(png.length) } });
  assert.equal(uploaded.status, 201);
  const photo = (await uploaded.json()).data;
  const bound = await api(endpoint + '/welcome/editor', 'PUT', { welcomeBgMediaId: photo.id, welcomePhotoMediaId: photo.id, expectedRevision: saved.configRevision }, admin, true);
  assert.equal(bound.configRevision, saved.configRevision + 1);
  for (const route of [bound.welcomeBgUrl, bound.welcomePhotoUrl]) {
    const response = await nodeFetch(new URL(route, backend).href);
    assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  }
  assert.equal((await nodeFetch(backend + '/media/' + photo.id + '/file')).status, 401);
  const rejected = await nodeFetch(backend + '/media/' + photo.id, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } });
  assert.equal(rejected.status, 409); assert.equal((await rejected.json()).code, 'MEDIA_BOUND_TO_WELCOME');
  await api(endpoint + '/editor', 'PUT', {
    systemName: before.systemName, welcomeBgMediaId: before.welcomeBgMediaId, welcomePhotoMediaId: before.welcomePhotoMediaId, expectedRevision: bound.configRevision,
  }, admin, true);
  for (const route of ['/welcome-background/file', '/welcome-photo/file']) assert.equal((await nodeFetch(backend + endpoint + route)).status, 404);
  await api('/media/' + photo.id, 'DELETE', undefined, admin, true);
  console.log('PASS system branding actual HTTP: 400/401/403, CAS409, no-op, restricted current-image public routes, bound deletion409 and unbound cleanup');
};
