import { defineConfig, devices } from '@playwright/test';

const E2E_HOST = 'localhost';
const E2E_PORT = Number(process.env.E2E_PORT ?? 3011);
const E2E_BASE_URL = `http://${E2E_HOST}:${E2E_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  reporter: [['list']],
  fullyParallel: false,
  globalTimeout: 6 * 60_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: `npx next dev -p ${E2E_PORT} -H ${E2E_HOST}`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
