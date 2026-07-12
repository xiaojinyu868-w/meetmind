import type { Metadata, Viewport } from 'next';
import { Inter, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { SWRProvider } from '@/lib/swr';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';
import { NetworkStatusBanner } from '@/components/NetworkStatusBanner';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { COPY } from '@/lib/ui/copy';

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
        {/* Preload OctoBuddy thinking.png — 课中加载态首次显示时消除白屏 */}
        <link rel="preload" as="image" href="/images/octo-buddy/thinking.png" />
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
