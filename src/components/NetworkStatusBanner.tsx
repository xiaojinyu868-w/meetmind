'use client';

import { useNetworkStatus } from '@/hooks/useNetworkStatus';

export function NetworkStatusBanner() {
  const { isOnline, wasOffline } = useNetworkStatus();

  if (isOnline && !wasOffline) return null;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[9999] text-center text-sm font-medium py-2 px-4 transition-all duration-300 ${
        isOnline
          ? 'bg-[#1C1B19] text-white'
          : 'bg-vermilion text-white'
      }`}
    >
      {isOnline ? '网络已恢复' : '网络已断开，部分功能暂不可用'}
    </div>
  );
}
