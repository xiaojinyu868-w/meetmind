import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  // tsconfig jsx=preserve 会让 vite import-analysis 拿到未编译 JSX；
  // 组件渲染测试（renderToStaticMarkup）需要 automatic runtime（vite8 走 oxc）
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', 'tests/**', '.next/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
