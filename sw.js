/* 操作系统刷题 PWA —— Service Worker
 * install 时预缓存外壳与全部 15 章题目，首访后完全离线可用。
 * 策略：
 *  - data/ 下的题库 JSON：network-first（你修改题库后刷新立即生效；离线时回退缓存）
 *  - 其他同源静态资源：cache-first（网络回退并回填缓存）
 * 注意：若你同时改动了 index.html/js/css 且刷新后没变化，把下方 CACHE_VERSION 加 1 即可。
 */
const CACHE_VERSION = 'os-v3';
const CHAPTER_COUNT = 15;

const CORE_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './manifest.webmanifest',
  './data/chapters.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];
const PRECACHE = CORE_ASSETS.concat(
  Array.from({ length: CHAPTER_COUNT }, (_, i) => `./data/ch${i}.json`)
);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(PRECACHE.map(async (url) => {
      try { await cache.add(url); } catch (e) { console.warn('预缓存失败:', url, e); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// 题库：网络优先，保证手动改题后刷新可见；离线/弱网（1.5s 内无响应）回退缓存
async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req);
  if (navigator.onLine === false && cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const fresh = await fetch(req, { signal: controller.signal });
    clearTimeout(timer);
    if (fresh && fresh.status === 200) cache.put(req, fresh.clone());
    return fresh;
  } catch (e) {
    clearTimeout(timer);
    if (cached) return cached;
    throw e;
  }
}

// 外壳：缓存优先
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.status === 200 && fresh.type === 'basic') {
      const cache = await caches.open(CACHE_VERSION);
      cache.put(req, fresh.clone());
    }
    return fresh;
  } catch (e) {
    if (req.mode === 'navigate') {
      const fallback = await caches.match('./index.html');
      if (fallback) return fallback;
    }
    throw e;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(req));
  } else {
    event.respondWith(cacheFirst(req));
  }
});
