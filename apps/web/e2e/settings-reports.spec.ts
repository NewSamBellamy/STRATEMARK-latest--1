import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

test('Settings: every section opens and says what it holds, and the key field never shows a key it was not given', async ({ page }) => {
  await page.goto('/#/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const section = (name: string) => page.getByRole('button', { name, exact: true });
  // General: where the key goes, what it is for, and a free key's speed against a paid one.
  await expect(page.getByRole('heading', { name: 'Google AI Studio API key' })).toBeVisible();
  const keyField = page.locator('input[type="password"]');
  await expect(keyField).toHaveValue('');
  await expect(page.getByText(/stored in this browser and sent only to Google/)).toBeVisible();
  await expect(page.locator('option', { hasText: 'Free key (slower, about 10 searches a minute)' })).toHaveCount(1);
  await expect(page.locator('option', { hasText: 'Paid key (faster, about 60 searches a minute)' })).toHaveCount(1);
  await section('Engine').click();
  await expect(page.getByRole('heading', { name: 'Research engine' })).toBeVisible();
  await expect(page.getByText('Grounded search ✓')).toBeVisible();
  await section('Data controls').click();
  await expect(page.getByRole('heading', { name: 'Data safety' })).toBeVisible();
  await expect(page.getByText(/saved only in this browser/)).toBeVisible();
  await section('Usage').click();
  await expect(page.getByRole('heading', { name: 'Usage', exact: true })).toBeVisible();
  await expect(page.getByText('This month on your key')).toBeVisible();
  await expect(page.getByText(/Estimates from published list prices, counted locally/)).toBeVisible();
  await expect(page.getByText('Monthly spending cap')).toBeVisible();
  // No pricing, plans or payment anywhere in Settings for now.
  await expect(page.getByRole('button', { name: /Builder profile|billing|pricing/i })).toHaveCount(0);
  await expect(page.getByText(/Easy install|Stratemark Pro|Coming soon/)).toHaveCount(0);
});

test('Reports: the saved report is listed, opens, and is sourced like the deck it came from', async ({ page }) => {
  await page.goto('/#/reports');
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await page.getByText('Frontier AI Ecosystem — Market Report').first().click();
  await expect(page).toHaveURL(/#\/reports\/rpt_/);
  await expect(page.getByText('STRATEMARK · MARKET REPORT')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Executive summary' })).toBeVisible();
  // The table carries Unknown where no sourced figure exists, never a guess.
  await expect(page.getByText('Unknown').first()).toBeVisible();
  await expect(page.getByText(/Generated .* · \d+ sources/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Share & export/i })).toBeVisible();
});

test('Saved cards, All decks and Beta open, and an unknown address says so instead of showing a blank page', async ({ page }) => {
  await page.goto('/#/saved');
  await expect(page.getByRole('heading', { name: 'Saved Cards' })).toBeVisible();
  await page.goto('/#/history');
  await expect(page.getByRole('heading', { name: 'All decks' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first()).toBeVisible();
  await page.goto('/#/beta');
  await expect(page.getByRole('heading', { name: /honest feedback, not your data/ })).toBeVisible();
  await expect(page.getByText(/Export everything, any time/)).toBeVisible();
  await page.goto('/#/this-page-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});
