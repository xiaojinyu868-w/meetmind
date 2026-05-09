'use client';

import { useEffect } from 'react';

async function retireServiceWorkers() {
  if (!('serviceWorker' in navigator)) return;

  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ('caches' in window) {
    const cacheNames = await window.caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith('meetmind-'))
        .map((name) => window.caches.delete(name)),
    );
  }
}

export function ServiceWorkerRegister() {
  useEffect(() => {
    void retireServiceWorkers().catch(() => {});
  }, []);

  return null;
}
