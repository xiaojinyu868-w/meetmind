'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #FFF1F2 0%, #FFFFFF 50%, #FFF1F2 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <div style={{ maxWidth: '400px', width: '100%', textAlign: 'center' }}>
            {/* 错误图标 */}
            <div style={{
              width: '96px',
              height: '96px',
              margin: '0 auto 32px',
              background: 'linear-gradient(135deg, #F43F5E 0%, #E11D48 100%)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 10px 40px -10px rgba(244,63,94,0.5)',
            }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            {/* 标题 */}
            <h1 style={{
              fontSize: '24px',
              fontWeight: 'bold',
              color: '#1F2937',
              marginBottom: '12px',
            }}>
              系统错误
            </h1>

            {/* 描述 */}
            <p style={{
              color: '#6B7280',
              marginBottom: '32px',
              lineHeight: '1.6',
            }}>
              抱歉，系统遇到了严重错误。<br />
              请刷新页面重试。
            </p>

            {/* 重试按钮 */}
            <button
              onClick={reset}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '14px 28px',
                background: 'linear-gradient(135deg, #E11D48 0%, #F43F5E 100%)',
                color: 'white',
                fontWeight: '500',
                fontSize: '16px',
                border: 'none',
                borderRadius: '12px',
                cursor: 'pointer',
                boxShadow: '0 10px 30px -5px rgba(225,29,72,0.4)',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              刷新页面
            </button>

            {/* 联系方式 */}
            <p style={{
              marginTop: '32px',
              fontSize: '14px',
              color: '#9CA3AF',
            }}>
              如需帮助，请联系 originedu@meetmind.online
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
