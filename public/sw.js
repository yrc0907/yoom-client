const CACHE_NAME = 'preview-cache-v1';
const MATCHES = [
  /\/api\/s3\/proxy\?key=/,
  /\/previews\//,
  /\/uploads\/posters\//,
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = request.url;
  if (request.method !== 'GET') return;
  if (!MATCHES.some((re) => re.test(url))) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            cache.put(request, res.clone());
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
}); 