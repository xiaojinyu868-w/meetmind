/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === 'production';
const devDistDir = process.env.NEXT_DEV_DIST_DIR || '.next-dev';
const ignoreBuildLint = process.env.NEXT_IGNORE_BUILD_LINT === '1';
const ignoreTypeErrors = process.env.NEXT_IGNORE_TYPE_ERRORS === '1';
const configuredBuildCpus = Number.parseInt(process.env.NEXT_BUILD_CPUS || (isProduction ? '1' : ''), 10);

const nextConfig = {
  // 生产构建可指定旁路目录（scripts/deploy.sh 用 .next-staging 构建后原子切换到 .next），
  // 运行时 server.js 固定读 .next，所以这里只影响 build。
  distDir: isProduction ? (process.env.NEXT_DIST_DIR || '.next') : devDistDir,
  // 2026-09-08 构建 trace 实测：1810s 里 1643s 是 node-file-trace-plugin——为每条路由追踪运行时
  // 文件依赖（teach/fenshen 路由各 21MB .nft.json，hanzi-writer-data 9000 个文件全被扫）。
  // 追踪只服务于 output:'standalone'；本仓库 PM2 直接跑仓库目录 + 完整 node_modules，追踪零价值。
  outputFileTracing: false,
  eslint: {
    ignoreDuringBuilds: ignoreBuildLint,
  },
  typescript: {
    ignoreBuildErrors: ignoreTypeErrors,
  },
  // 允许上传大文件 (500MB)
  experimental: {
    ...(Number.isFinite(configuredBuildCpus) && configuredBuildCpus > 0
      ? { cpus: configuredBuildCpus }
      : {}),
    // 2026-09-08 构建提速：有自定义 webpack 配置时 Next 14 默认关闭 build worker，
    // client / server / edge 三套编译在同一个 5GB 堆里串行跑，顶着上限疯狂 GC（实测 29 分钟）。
    // 显式打开后各编译器独立进程、独立堆，配合 Makefile 里放宽的堆与 cpus。
    webpackBuildWorker: true,
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
  // M7-fix6: logger.ts 引了 pino + pino-pretty + async_hooks（Node 专属），
  // 但被 src/lib/config.ts 间接导入到 client bundle。告诉 webpack 这些是
  // server-only fallback，client 不要尝试解析。
  webpack: (config, { isServer }) => {
    // teach-engine vendor 树（OpenMAIC）内部用 ESM 风格 '.js' 后缀 import 同目录
    // .ts 文件，webpack 默认解析不了——extensionAlias 把 '.js' 映射回 '.ts'
    config.resolve = config.resolve || {};
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      '.js': ['.ts', '.js'],
    };
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        async_hooks: false,
        pino: false,
        'pino-pretty': false,
        'thread-stream': false,
        'sonic-boom': false,
      };
      // NEXT_BUNDLE_ATTRIBUTION=1（make bundle-report）：模块 id 用源码路径、关掉 scope hoisting，
      // 产物里每个模块边界都能归到文件——首屏 JS 体积才有账可查。只用于旁路分析构建，不进线上产物
      if (process.env.NEXT_BUNDLE_ATTRIBUTION === '1') {
        config.optimization = config.optimization || {};
        config.optimization.moduleIds = 'named';
        config.optimization.concatenateModules = false;
      }
    }
    return config;
  },
};

module.exports = nextConfig;
