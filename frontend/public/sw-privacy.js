// Retire this application's pre-multiuser runtime caches on worker activation.
// Do not enumerate/delete unrelated origin caches.
self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.delete('api-read'),
    caches.delete('static-assets'),
  ]));
});
