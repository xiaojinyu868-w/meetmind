import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { SWRProvider } from '@/lib/swr';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';
import { NetworkStatusBanner } from '@/components/NetworkStatusBanner';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

// 优化字体加载：display: swap 避免阻塞渲染
const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: 'MeetMind - 课堂对齐的 AI 家教',
  description: '把课堂变成可回放、可定位、可追溯的时间轴记忆',
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icons/icon-192x192.svg', type: 'image/svg+xml' }],
    shortcut: ['/icons/icon-192x192.svg'],
    apple: [{ url: '/icons/icon-192x192.svg' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'MeetMind',
  },
};

// 优化移动端视口配置
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  // 适配 iOS 安全区域
  viewportFit: 'cover',
  // 主题色
  themeColor: '#FFF9F5',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="icon" href="/icons/icon-192x192.svg" type="image/svg+xml" />
        <link rel="shortcut icon" href="/icons/icon-192x192.svg" />
        {/* PWA: Apple Touch Icon */}
        <link rel="apple-touch-icon" href="/icons/icon-192x192.svg" />
      </head>
      <body className={inter.className}>
        <AuthProvider>
          <SWRProvider>
            <AnalyticsProvider>
              <NetworkStatusBanner />
              <ServiceWorkerRegister />
              {children}
              <Toaster position="top-center" richColors closeButton />
            </AnalyticsProvider>
          </SWRProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
