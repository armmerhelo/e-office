const CACHE_NAME = 'eoffice-static-v3';
self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(['/offline.html','/favicon.ico'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('eoffice-static-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    if (event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
        return;
    }
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin || /\.(php)$/.test(url.pathname) || /\/(api|file_document|e-sign)\//.test(url.pathname)) return;
    if (['/offline.html','/favicon.ico'].includes(url.pathname)) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request)));
});
