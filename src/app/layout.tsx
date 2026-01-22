import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { SWRProvider } from '@/lib/swr';

const inter = Inter({ subsets: ['latin'] });

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
        {/* 预加载 demo 音频文件，加速复习页面加载 */}
        <link 
          rel="preload" 
          href="/demo-audio.mp3" 
          as="audio" 
          type="audio/mpeg"
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
