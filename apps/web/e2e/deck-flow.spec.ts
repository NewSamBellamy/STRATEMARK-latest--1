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

  // Compare requires a real multi-card selection and never fabricates an
  // answer when the local BYOK engine is not connected.
  await page.getByRole('button', { name: 'Compare' }).click();
  await page
    .getByRole('button', { name: /OpenAI/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: 'Ask about these' })).toBeDisabled();
  await page
    .getByRole('button', { name: /Anthropic/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Ask about these' }).click();
  await expect(page.getByText(/No answer will be generated without your key/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /Connect Gemini/i })).toBeVisible();
  await expect(page.getByText(/Research Insight for/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close AI panel' }).click();

  // Level 1 → company-stage grouping. Recorded stages only appear when the
  // evidence supports them; unsupported rankings stay in an explicit section.
  await page.getByRole('button', { name: /group by stage/i }).click();
  await expect(page.getByText('Category Leader').first()).toBeVisible();
  await expect(page.getByText('Breakout').first()).toBeVisible();
  await expect(page.getByTestId('unverified-stage')).toContainText('OpenAI');

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
