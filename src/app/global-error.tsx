'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('全局错误:', error);
  }, [error]);

  return (
    <html lang="zh-CN">
      <body>
        <div style={{
          minHeight: '100vh',
          background: 'linear-gradient(to bottom right, #fff1f2, #fffbeb)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1rem',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}>
          <div style={{
            maxWidth: '28rem',
            width: '100%',
            background: 'white',
            borderRadius: '1rem',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
            padding: '2rem',
            textAlign: 'center',
          }}>
            {/* 错误图标 */}
            <div style={{
              width: '5rem',
              height: '5rem',
              margin: '0 auto 1.5rem',
              background: '#fee2e2',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
            </div>

            {/* 标题 */}
            <h1 style={{
              fontSize: '1.5rem',
              fontWeight: 'bold',
              color: '#111827',
              marginBottom: '0.5rem',
            }}>
              服务暂时不可用
            </h1>
            
            {/* 描述 */}
            <p style={{
              color: '#6b7280',
              marginBottom: '1.5rem',
            }}>
              抱歉，系统遇到了严重问题。我们正在紧急修复中。
            </p>

            {/* 操作按钮 */}
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}>
              <button
                onClick={reset}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: 'linear-gradient(135deg, #f43f5e, #fb7185)',
                  color: 'white',
                  fontWeight: '500',
                  borderRadius: '0.75rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem',
                }}
              >
                重试
              </button>
              <a
                href="/"
                style={{
                  padding: '0.75rem 1.5rem',
                  background: '#f3f4f6',
                  color: '#374151',
                  fontWeight: '500',
                  borderRadius: '0.75rem',
                  textDecoration: 'none',
                  fontSize: '1rem',
                }}
              >
                返回首页
              </a>
            </div>

            {/* 联系方式 */}
            <p style={{
              marginTop: '1.5rem',
              fontSize: '0.875rem',
              color: '#9ca3af',
            }}>
              如需帮助，请联系 originedu@meetmind.online
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
