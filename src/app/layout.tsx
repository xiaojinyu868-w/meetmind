import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { SWRProvider } from '@/lib/swr';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';
import { NetworkStatusBanner } from '@/components/NetworkStatusBanner';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { COPY } from '@/lib/ui/copy';
import { AdminLensProvider } from '@/components/admin/AdminLensProvider';

export const metadata: Metadata = {
  title: `MeetMind - ${COPY.identity.tagline}`,
  description: COPY.identity.subtagline,
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
  // 主题色：v7 米白纸感
  themeColor: '#FAF7F2',
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
        {/* Preload OctoBuddy thinking.png — 课中加载态首次显示时消除白屏 */}
        <link rel="preload" as="image" href="/images/octo-buddy/thinking.png" />
      </head>
      <body>
        <AuthProvider>
          <AdminLensProvider>
            <SWRProvider>
              <AnalyticsProvider>
                <NetworkStatusBanner />
                <ServiceWorkerRegister />
                {children}
                <Toaster position="top-center" richColors closeButton />
              </AnalyticsProvider>
            </SWRProvider>
          </AdminLensProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
