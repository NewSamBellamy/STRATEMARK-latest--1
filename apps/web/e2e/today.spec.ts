import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

test('adding a company to Today from its card opens its card and updates on Today', async ({ page }) => {
  await page.goto('/#/history');
  await page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first().click();
  await expect(page.getByTestId('card-grid')).toBeVisible();

  // The Today button sits next to the card's bookmark.
  const add = page.getByRole('button', { name: 'Add OpenAI to Today' });
  await add.click();
  await expect(page.getByRole('button', { name: /^Following OpenAI on Today/ })).toBeVisible();

  await page.getByRole('link', { name: 'Today' }).first().click();
  const rail = page.getByRole('navigation', { name: 'Companies on Today' });
  await rail.getByRole('button', { name: /OpenAI/ }).click();

  await expect(page.getByLabel('OpenAI card')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'OpenAI today' })).toBeVisible();
  await expect(page.getByRole('button', { name: /View full report/ })).toBeVisible();
  // The demo's stored news is older than two months, and the page says so instead of padding the list.
  await expect(page.getByText('Nothing dated in the last two months yet.')).toBeVisible();
});
