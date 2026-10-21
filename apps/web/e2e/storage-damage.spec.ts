import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

const keys = ['mi.teamOrgView', 'mi.sentinelApiUrl', 'mi.geminiApiKey', 'mi.apiKey', 'mi.repo.v1', 'mi.theme', 'mi.searchUsage',
  'mi.targetCompanies', 'mi.ambientRest', 'mi.shares', 'mi.today.lastVisit', 'mi.groundingSpent.v1', 'mi.geminiJudgeModel',
  'mi.cloud.cache.v1', 'mi.warmStoredDecks', 'mi.usage', 'mi.today.socialRead', 'mi.researchEngine', 'mi.fillLedger.v1',
  'mi.usage.v1', 'mi.usage.month.v1', 'mi.searchProvider', 'mi.searchKey', 'mi.quotaPreset', 'mi.geminiModel', 'mi.costctl.v1',
  'mi.backgroundResearch.v1'];
const junk = ['{"a":', 'undefined', 'x'.repeat(50000)];

// Each app storage key damaged on its own, then a reload: the demo still opens its first screen and nothing throws.
// (Several keys damaged together, and a damaged research file with a key set, are covered in robustness.spec.ts.)
test('every app storage key, damaged on its own, still lets the app open', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route((u) => u.hostname !== 'localhost' && /^https?:$/.test(u.protocol), (r) => r.abort());
  await unlockPreview(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/');
  await expect(page.getByPlaceholder('Describe a market…')).toBeVisible();
  const broken: string[] = [];
  for (const key of keys) {
    for (const value of junk) {
      await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [key, value]);
      await page.reload();
      const alive = await expect(page.getByPlaceholder('Describe a market…')).toBeVisible({ timeout: 8000 }).then(() => true, () => false);
      if (!alive) broken.push(`${key} = ${value.slice(0, 12)}`);
      await page.evaluate((k) => localStorage.removeItem(k!), key);
    }
  }
  expect(broken).toEqual([]);
  expect(errors).toEqual([]);
});
