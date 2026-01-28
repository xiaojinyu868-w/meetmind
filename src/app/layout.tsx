import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { SWRProvider } from '@/lib/swr';

// 优化字体加载：display: swap 避免阻塞渲染
const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  preload: true,
});

export const metadata: Metadata = {
  title: 'MeetMind - 课堂对齐的 AI 家教',
  description: '把课堂变成可回放、可定位、可追溯的时间轴记忆',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
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
        <AuthProvider>
          <SWRProvider>
            {children}
          </SWRProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
