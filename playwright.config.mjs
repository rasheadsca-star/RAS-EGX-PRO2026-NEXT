import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['line']],
  use: {
    baseURL: process.env.EGX_TEST_BASE_URL || 'http://127.0.0.1:4173',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 1000 }
  },
  projects: [
    { name: 'chromium-desktop', use: { browserName: 'chromium' } },
    { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true } }
  ]
});
