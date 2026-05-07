// MeetMind Service Worker v2
// 策略：App Shell 缓存 + 网络优先 + 离线回退
//
// v2 (M7-fix8): bump CACHE_NAME 强制老 v1 缓存失效——修复生产看到的老 bundle 问题。
// 新增：跳过 Range 请求（206）/ 非 basic 响应的 cache.put，避免浏览器
// "Failed to execute 'put' on 'Cache': Partial response" 报错。

const CACHE_NAME = 'meetmind-v2';
const OFFLINE_URL = '/offline.html';

// App Shell：预缓存的核心静态资源
const PRECACHE_ASSETS = [
  '/offline.html',
  '/icons/icon-192x192.svg',
  '/icons/icon-512x512.svg',
  '/manifest.json',
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  // 跳过等待，立即激活
  self.skipWaiting();
});

// 激活：清理旧缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  // 立即接管所有页面
  self.clients.claim();
});

// 请求拦截
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 只处理同源请求
  if (url.origin !== location.origin) return;

  // 跳过 API 请求和 WebSocket — 不缓存动态数据
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/webpack-hmr') ||
    request.method !== 'GET'
  ) {
    return;
  }

  // 静态资源（JS/CSS/图片/字体）：缓存优先，网络回退
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.match(/\.(svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|eot)$/)
  ) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          // 缓存成功的响应
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        });
      })
    );
    return;
  }

  // 页面导航：网络优先，离线回退
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match(OFFLINE_URL);
      })
    );
    return;
  }

  // 其他 GET 请求：网络优先，缓存回退
  event.respondWith(
    fetch(request)
      .then((response) => {
        // M7-fix8: 只缓存可以安全 put 进 Cache 的响应：
        //   - status=200（不是 206 Partial）
        //   - type=basic/default（不是 opaque / error）
        //   - 不是 Range 请求（视频流 Range 返回 206，put 会抛错）
        const cacheable =
          response.ok &&
          response.status === 200 &&
          (response.type === 'basic' || response.type === 'default') &&
          !request.headers.has('range');
        if (cacheable) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone).catch(() => {
              /* silent — 某些响应仍然不可缓存，吞掉避免 Promise 泄漏 */
            });
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(request);
      })
  );
});
