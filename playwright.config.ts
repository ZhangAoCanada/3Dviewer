import { defineConfig, devices } from '@playwright/test';
import { E2E_PORT, VIEWER_BASE_URL } from './tests-e2e/baseURL';

export default defineConfig({
  testDir: 'tests-e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  use: {
    baseURL: VIEWER_BASE_URL,
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
    },
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${E2E_PORT} --strictPort`,
    url: VIEWER_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
