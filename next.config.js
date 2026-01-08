/** @type {import('next').NextConfig} */
const nextConfig = {
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
