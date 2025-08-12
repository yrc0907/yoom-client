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

// Background Sync：尝试续传队列中的分片（仅示例）
self.addEventListener('sync', (event) => {
  if (event.tag === 'uploader-sync') {
    event.waitUntil((async () => {
      try {
        const db = await new Promise((res, rej) => {
          const req = indexedDB.open('uploader', 1);
          req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' }); };
          req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error);
        });
        const items = await new Promise((res, rej) => {
          const tx = db.transaction('queue', 'readonly'); const st = tx.objectStore('queue');
          const all = st.getAll(); all.onsuccess = () => res(all.result || []); all.onerror = () => rej(all.error);
        });
        for (const it of items) {
          // 简化：这里只演示从 OPFS 读取失败分片并重试 PUT
          if (it.opfsPath && it.url) {
            try {

              const root = await navigator.storage.getDirectory();
              const [_, dirName, fileName] = it.opfsPath.split('/');
              const uploader = await root.getDirectoryHandle(dirName);
              const dir = await uploader.getDirectoryHandle(fileName.split('/')[0]);
              const fh = await dir.getFileHandle(fileName.split('/')[1]);
              const file = await fh.getFile();
              // SW 环境不支持 duplex，直接用 Blob 作为请求体
              await fetch(it.url, { method: 'PUT', body: file });
              // 成功后从队列移除
              await new Promise((res2, rej2) => {
                const tx = db.transaction('queue', 'readwrite'); const st = tx.objectStore('queue'); st.delete(it.id); tx.oncomplete = () => res2(); tx.onerror = () => rej2(tx.error);
              });
            } catch { }
          }
        }
      } catch { }
    })());
  }
});