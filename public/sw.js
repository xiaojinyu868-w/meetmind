// MeetMind Service Worker retirement worker.
//
// 过去的 App Shell 离线回退会在部署/网络短抖时把在线应用误导到
// /offline.html，并造成旧 bundle 与新服务端不一致的 Server Action 报错。
// MeetMind 当前是实时在线学习产品，不再注册离线 App Shell。

const CACHE_PREFIX = 'meetmind-';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          .filter((name) => name.startsWith(CACHE_PREFIX))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.registration.unregister()),
  );
});
