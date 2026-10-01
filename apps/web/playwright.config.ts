import { defineConfig, devices } from '@playwright/test';

const previewUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:4173';
const previewPort = new URL(previewUrl).port || '4173';
const previewHost = new URL(previewUrl).hostname.replace(/^\[|\]$/g, '');

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
  // Own the server under test. Reusing this common port can silently test an
  // unrelated local app and turn the whole suite into misleading evidence.
  webServer: {
    command: `pnpm run build && pnpm exec vite preview --host "${previewHost}" --port ${previewPort} --strictPort`,
    url: previewUrl,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
