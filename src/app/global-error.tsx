'use client';

/**
 * v7 全局错误（root layout 都崩了的情况）：
 * 此处不能用任何 v7 工具类（globals.css 可能没加载），全部 inline style。
 * 但仍然遵守 v7 配色：米白 + 朱批红 + 墨松绿。
 */

export default function GlobalError({
  error: _error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#FAF7F2',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
          fontFeatureSettings: '"palt"',
          letterSpacing: '-0.011em',
          color: '#1C1B19',
        }}
      >
        {/* 极淡光晕 */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse 50% 40% at 50% 30%, rgba(181,72,60,0.10), transparent 60%)',
          }}
          aria-hidden
        />

        <div style={{ position: 'relative', maxWidth: '440px', width: '100%', textAlign: 'center' }}>
          {/* Octo · surprised */}
          <div
            style={{
              width: '112px',
              height: '112px',
              margin: '0 auto 32px',
              display: 'grid',
              placeItems: 'center',
              position: 'relative',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: '-8px',
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(181,72,60,0.2) 0%, transparent 65%)',
                animation: 'globe-breath 3.6s ease-in-out infinite',
              }}
              aria-hidden
            />
            {/* root layout 都崩了的情况，next/image 也可能挂。这里有意保留 raw <img> */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/octo-buddy/surprised.png"
              alt=""
              aria-hidden
              style={{
                position: 'relative',
                width: '96px',
                height: '96px',
                objectFit: 'contain',
                filter: 'drop-shadow(0 8px 24px rgba(45,79,62,0.18))',
              }}
            />
          </div>

          {/* 标签 */}
          <p
            style={{
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#B5483C',
              marginBottom: '12px',
            }}
          >
            CRITICAL ERROR · 系统层崩了
          </p>

          {/* 标题 */}
          <h1
            style={{
              fontSize: '28px',
              fontWeight: 600,
              color: '#1C1B19',
              marginBottom: '14px',
              letterSpacing: '-0.024em',
              lineHeight: 1.2,
            }}
          >
            Octo 自己都晕了
          </h1>

          {/* 描述 */}
          <p
            style={{
              color: '#5C5A55',
              marginBottom: '32px',
              lineHeight: 1.7,
              fontSize: '15px',
            }}
          >
            系统层遇到了严重错误，刷新页面通常能恢复。
            <br />
            你的笔记和录音都没丢。
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
              background: '#1C1B19',
              color: '#FFFFFF',
              fontWeight: 500,
              fontSize: '15px',
              border: 'none',
              borderRadius: '10px',
              cursor: 'pointer',
              transition: 'all 0.15s cubic-bezier(0.16,1,0.3,1)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = '#000';
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = '#1C1B19';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            刷新页面
          </button>

          {/* 联系方式 */}
          <p
            style={{
              marginTop: '32px',
              fontSize: '13px',
              color: '#8E8B82',
            }}
          >
            如需帮助，请联系{' '}
            <span style={{ fontFamily: 'ui-monospace, monospace', color: '#2D4F3E' }}>
              originedu@meetmind.online
            </span>
          </p>
        </div>

        <style>{`
          @keyframes globe-breath {
            0%, 100% { transform: scale(0.92); opacity: 0.5; }
            50%      { transform: scale(1.08); opacity: 0.9; }
          }
        `}</style>
      </body>
    </html>
  );
}
