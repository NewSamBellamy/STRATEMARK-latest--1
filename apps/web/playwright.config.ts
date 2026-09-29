import { defineConfig, devices } from '@playwright/test';

const previewUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const previewPort = new URL(previewUrl).port || '4173';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: previewUrl,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Reuses the running preview if present; otherwise builds + serves the app.
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
