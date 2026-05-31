import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { SWRProvider } from '@/lib/swr';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';
import { NetworkStatusBanner } from '@/components/NetworkStatusBanner';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';

/**
 * v7 字体三件套：
 * - Inter         · 正文（紧排 'palt' 中英混排立刻 +30% 高级感）
 * - Instrument Serif · 仪式字（标题里偶尔的 italic em，老学院感）
 * - JetBrains Mono   · 引用资产化（[MM:SS] / [资料 N] 专用）
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  variable: '--font-inter',
  weight: ['300', '400', '500', '600', '700', '800'],
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-instrument-serif',
  weight: ['400'],
  style: ['normal', 'italic'],
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  preload: false,
  variable: '--font-jetbrains-mono',
  weight: ['400', '500', '600'],
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
  // 主题色：v7 米白纸感
  themeColor: '#FAF7F2',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`${inter.variable} ${instrumentSerif.variable} ${jetBrainsMono.variable}`}
    >
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
