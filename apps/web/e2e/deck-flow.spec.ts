import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

// Abort external requests (fonts, example.com iframes) so runs are hermetic,
// and clear the private-preview gate before the app boots.
test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

test('full journey: markets → deck → 2-level split → card reader → dashboard', async ({ page }) => {
  await page.goto('/#/history');

  // All decks → open the seeded zero-state deck (a REAL researched deck —
  // Frontier AI Ecosystem — ships as the sample so first launch shows the
  // finished product, not a fabricated demo).
  await page
    .getByRole('button', { name: /Frontier AI Ecosystem/ })
    .first()
    .click();
  await expect(page.getByTestId('card-grid')).toBeVisible();

  // Level 1 → tier grouping. The sample deck spans tiers 5-8, so the highest
  // (Market Defining) and the lowest present (Breakout) are the ones
  // guaranteed to render — not every tier label exists in every deck.
  await page.getByRole('button', { name: /group by tier/i }).click();
  await expect(page.getByText('Market Defining').first()).toBeVisible();
  await expect(page.getByText('Breakout').first()).toBeVisible();

  // Open a card → reader → dashboard.
  await page
    .getByRole('button', { name: /OpenAI/ })
    .first()
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('tab', { name: 'Company stage' }).click();
  await expect(dialog.getByRole('heading', { name: 'Company stage' })).toBeVisible();
  await dialog.getByRole('link', { name: /explore research/i }).click();

  // Dashboard tabs.
  await expect(page.getByText('At a glance')).toBeVisible();
  await page.getByRole('link', { name: 'Metrics', exact: true }).click();
  await expect(page.getByText('ARR')).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('link', { name: 'Team & Org Chart' }).click();
  await expect(page.locator('.react-flow')).toBeVisible();
});

test('new deck flow without a key shows the honest gate — never fabricates research', async ({
  page,
}) => {
  // Product law: research runs on your own Gemini key or it doesn't run at
  // all. A prior "demo mode" silently fabricated a sample deck for whatever
  // the user typed — removed as a fabrication path. This test now pins the
  // CURRENT, correct behavior: an honest gate, never invented figures.
  await page.goto('/#/');
  await page.getByPlaceholder('Describe a market…').fill('Vegan sneaker brands');
  await page.getByRole('button', { name: 'Research this market' }).click();
  await expect(page.getByText('Gemini API Key Required')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add your key in Settings' })).toBeVisible();
});
