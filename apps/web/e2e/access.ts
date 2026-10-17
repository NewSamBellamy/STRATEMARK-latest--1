import type { Page } from '@playwright/test';

/**
 * Unlock the private-preview access gate before the app boots.
 *
 * The preview lock (lib/access.ts + RequireAuth) only auto-bypasses under
 * vitest (`MODE === 'test'`). Playwright drives the REAL production preview
 * build, so without this every spec lands on the access-code screen — which
 * is exactly what broke CI after the lock shipped.
 *
 * Seeding the profile via `addInitScript` (runs before any app code) keeps
 * the gate itself under test in production mode: if the storage contract in
 * `lib/access.ts` ever changes, these specs fail loudly instead of silently
 * skipping the lock. Retire this helper when Google sign-in replaces the
 * codes.
 */
export async function unlockPreview(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        'mi.access.v1',
        JSON.stringify({ name: 'E2E', kind: 'test', unlockedAt: new Date().toISOString() }),
      );
    } catch {
      /* opaque origin in embed specs — those assert on the gate-free path */
    }
  });
}
