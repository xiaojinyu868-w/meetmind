/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === 'production';
const devDistDir = process.env.NEXT_DEV_DIST_DIR || '.next-dev';

const nextConfig = {
  distDir: isProduction ? '.next' : devDistDir,
  // 允许上传大文件 (500MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '500mb',
    },
  },
  // 静态资源缓存配置
  async headers() {
    return [
      // Service Worker：不缓存，每次检查更新
      {
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Content-Type',
            value: 'application/javascript; charset=utf-8',
          },
        ],
      },
      // Web App Manifest
      {
        source: '/manifest.json',
        headers: [
          {
            key: 'Content-Type',
            value: 'application/manifest+json; charset=utf-8',
          },
        ],
      },
      // 视频文件长期缓存（登录页背景等）
      {
        source: '/:path*.mp4',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // 音频文件长期缓存
      {
        source: '/:path*.mp3',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      // 其他静态资源缓存
      {
        source: '/:path*.(ico|png|jpg|jpeg|gif|svg|webp)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
    ];
  },
  // 代理到各个后端服务
  async rewrites() {
    return [
      // Open Notebook API (Docker)
      {
        source: '/api/notebook/:path*',
        destination: 'http://localhost:5055/:path*',
      },
      // Discussion API (NestJS)
      {
        source: '/api/discussion/:path*',
        destination: 'http://localhost:4000/:path*',
      },
      // LongCut API (Next.js)
      {
        source: '/api/longcut/:path*',
        destination: 'http://localhost:3000/api/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
