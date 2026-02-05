import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/useAuth';
import { SWRProvider } from '@/lib/swr';
import { AnalyticsProvider } from '@/components/AnalyticsProvider';

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
        {/* 预加载登录页海报图，确保快速显示 */}
        <link 
          rel="preload" 
          href="/videos/poster.jpg" 
          as="image"
          type="image/jpeg"
        />
        {/* 自动降级脚本：检测访问受限时切换到香港服务器 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                // 已经在香港服务器，不需要降级
                if (window.location.hostname === 'hk.meetmind.online') return;
                
                // 检查是否已经手动选择过服务器
                var preferred = localStorage.getItem('preferred_server');
                if (preferred === 'main') return; // 用户明确选择主站
                if (preferred === 'hk') {
                  window.location.href = 'https://hk.meetmind.online' + window.location.pathname;
                  return;
                }
                
                // 3秒后检测页面是否正常渲染
                setTimeout(function() {
                  // 检查关键元素是否存在
                  var hasContent = document.querySelector('main, #root, [data-rendered]');
                  var bodyText = document.body ? document.body.innerText : '';
                  
                  // 如果页面空白或内容很少（可能被浏览器拦截）
                  if (!hasContent || bodyText.length < 100) {
                    console.log('[Failover] 页面渲染异常，准备切换到香港服务器');
                    localStorage.setItem('preferred_server', 'hk');
                    window.location.href = 'https://hk.meetmind.online' + window.location.pathname;
                  }
                }, 3000);
              })();
            `,
          }}
        />
      </head>
      <body className={inter.className}>
        <AuthProvider>
          <SWRProvider>
            <AnalyticsProvider>
              {children}
            </AnalyticsProvider>
          </SWRProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
