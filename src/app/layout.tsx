import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { getMessages } from 'next-intl/server';
import { NextIntlClientProvider } from 'next-intl';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { SWRProvider } from '@/lib/swr';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';
import { getUserLocale } from '@/lib/services/locale-service';

// 优化字体加载：display: swap 避免阻塞渲染
const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  preload: true,
});

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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getUserLocale();
  const messages = await getMessages({ locale });
  
  return {
    title: messages.metadata.title as string,
    description: messages.metadata.description as string,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getUserLocale();
  const messages = await getMessages({ locale });

  return (
    <html lang={locale}>
      <head>
        {/* 预加载登录页海报图，确保快速显示 */}
        <link 
          rel="preload" 
          href="/videos/poster.jpg" 
          as="image"
          type="image/jpeg"
        />
      </head>
      <body className={inter.className}>
        <NextIntlClientProvider messages={messages} locale={locale}>
          <AuthProvider>
            <SWRProvider>
              <AnalyticsProvider>
                {children}
              </AnalyticsProvider>
            </SWRProvider>
          </AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
