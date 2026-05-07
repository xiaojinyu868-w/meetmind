// Eval harness 专用 vitest config
// 与 vitest.config.ts 并行，仅跑 tests/eval/**/*.test.ts。
// 运行: npx vitest run --config vitest.eval.config.ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/eval/**/*.test.ts'],
    exclude: ['node_modules', '.next/**'],
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@eval': path.resolve(__dirname, 'tests/eval'),
    },
  },
});
