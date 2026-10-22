import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

const keys = ['mi.teamOrgView', 'mi.sentinelApiUrl', 'mi.geminiApiKey', 'mi.apiKey', 'mi.repo.v1', 'mi.theme', 'mi.searchUsage',
  'mi.targetCompanies', 'mi.ambientRest', 'mi.shares', 'mi.today.lastVisit', 'mi.groundingSpent.v1', 'mi.geminiJudgeModel',
  'mi.cloud.cache.v1', 'mi.warmStoredDecks', 'mi.usage', 'mi.today.socialRead', 'mi.researchEngine', 'mi.fillLedger.v1',
  'mi.usage.v1', 'mi.usage.month.v1', 'mi.searchProvider', 'mi.searchKey', 'mi.quotaPreset', 'mi.geminiModel', 'mi.costctl.v1',
  'mi.backgroundResearch.v1'];
const junk = ['{"a":', 'undefined', 'x'.repeat(50000)];

// A damaged research file with a key set stops the app on purpose; the person must get a copy and a way out, never a silent loss.
test('a damaged research file offers a copy, a retry and a confirmed fresh start that keeps the damaged text', async ({ page }) => {
  await page.route((u) => u.hostname !== 'localhost' && /^https?:$/.test(u.protocol), (r) => r.abort());
  await unlockPreview(page);
  const damaged = '{"markets":[{"id":"mkt_precious"';
  await page.addInitScript(([text]) => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('mi.geminiApiKey', 'FAKE-TEST-KEY');
      localStorage.setItem('mi.repo.v1', text!);
    }
  }, [damaged]);
  await page.goto('/#/');
  await expect(page.getByRole('alert')).toContainText('Your saved research is unreadable');
  expect(await page.evaluate(() => localStorage.getItem('mi.repo.v1'))).toBe(damaged);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download the damaged data/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^stratemark-damaged-research-.*\.txt$/);
  await page.getByRole('button', { name: 'Start with an empty workspace' }).click();
  await expect(page.getByText('This replaces your saved research with an empty workspace. Have you downloaded a copy?')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('mi.repo.v1'))).toBe(damaged);
  await page.getByRole('button', { name: /^Yes, start/ }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('mi.repo.v1.damaged-backup')).map((k) => localStorage.getItem(k)));
  expect(kept).toEqual([damaged]);
});

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
