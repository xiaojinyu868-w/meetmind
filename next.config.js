/** @type {import('next').NextConfig} */
const nextConfig = {
  // 静态资源缓存配置
  async headers() {
    return [
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
