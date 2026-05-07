// Vitest 专用于 server/ 目录的 CommonJS 纯函数单测
// server.js 是 CommonJS 风格，我们不强行迁到 TS；但用 vitest 跑它的抽出模块。
// 运行: npx vitest run --config vitest.server.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.test.{js,ts}'],
    exclude: ['node_modules', '.next/**'],
  },
});
