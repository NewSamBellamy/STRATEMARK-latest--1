import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

// A row that opens a story or a product is a list item whose headline is the real button: a row that is itself
// role="button" cannot hold the source link inside it (axe: nested-interactive, list).
test('a news story opens from the keyboard, and from a click on the row', async ({ page }) => {
  await page.goto('/#/company/cmp_openai_5sz16/dashboard/live_intel');
  const headline = page.locator('ul.panel > li').first().getByRole('button').first();
  await expect(headline).toBeVisible();
  await headline.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The whole row still works for the mouse, and opens once, not twice.
  await page.locator('ul.panel > li').first().click({ position: { x: 6, y: 6 } });
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('a product opens from the keyboard', async ({ page }) => {
  await page.goto('/#/company/cmp_openai_5sz16/dashboard/products_roadmap');
  const name = page.locator('ul.grid > li').first().getByRole('button').first();
  await expect(name).toBeVisible();
  await name.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
});
