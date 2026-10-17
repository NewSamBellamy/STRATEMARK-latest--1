import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

test('compare: the cards you pick show up as thumbnails in a chat that starts at once, and open', async ({ page }) => {
  await page.goto('/#/history');
  await page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first().click();
  await expect(page.getByTestId('card-grid')).toBeVisible();

  await page.getByRole('button', { name: 'Compare' }).click();
  const grid = page.getByTestId('card-grid');
  await grid.locator('[data-card-id]').nth(0).click();
  await grid.locator('[data-card-id]').nth(1).click();
  await page.getByRole('button', { name: /Ask about these/ }).click();

  const panel = page.getByRole('dialog', { name: 'AI Research' });
  const strip = panel.getByLabel('Cards in this conversation');
  await expect(strip).toBeVisible();
  await expect(strip.getByRole('button', { name: /^Open the .+ card$/ })).toHaveCount(2);
  // The comparison question went out on its own: the conversation is already under way.
  await expect(panel.getByText(/Compare these 2 head-to-head/).first()).toBeVisible();

  await strip.getByRole('button', { name: /^Open the .+ card$/ }).first().click();
  await expect(page.getByRole('dialog', { name: /Inspect .+ card/i })).toBeVisible();
});

test('the Ask orb is there on every page, drags to a new place and is still there after a reload', async ({ page }) => {
  await page.goto('/#/history');
  const orb = page.getByRole('button', { name: 'Ask Stratemark' });
  await expect(orb).toBeVisible();
  const before = await orb.boundingBox();
  expect(before).not.toBeNull();

  await page.mouse.move(before!.x + 26, before!.y + 26);
  await page.mouse.down();
  await page.mouse.move(60, 160, { steps: 8 });
  await page.mouse.up();
  // It lands on the left edge and does not open the chat.
  await expect(page.getByRole('dialog', { name: 'AI Research' })).toBeHidden();
  await page.waitForTimeout(500); // it eases onto the edge
  const moved = await orb.boundingBox();
  expect(moved!.x).toBeLessThan(60);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Ask Stratemark' })).toBeVisible();
  await page.waitForTimeout(500);
  const again = await page.getByRole('button', { name: 'Ask Stratemark' }).boundingBox();
  expect(Math.abs(again!.x - moved!.x)).toBeLessThan(2);
  expect(Math.abs(again!.y - moved!.y)).toBeLessThan(2);

  await page.getByRole('button', { name: 'Ask Stratemark' }).click();
  await expect(page.getByRole('dialog', { name: 'AI Research' })).toBeVisible();
  await expect(page.getByText(/I've been through everything in/)).toBeVisible();
});
