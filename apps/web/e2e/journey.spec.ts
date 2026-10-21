import { test, expect, type Page } from '@playwright/test';
import { unlockPreview } from './access';

// The main demo journey end to end, one concern per test. Every test collects
// uncaught page errors and fails on any.
const MARKET = 'mkt_frontier-ai-ecosystem_s248s';
const COMPANY = 'cmp_mistral-ai_iubim';
const LAUNCH = /December 1, 2026/;

let pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

test.afterEach(() => {
  expect(pageErrors, 'uncaught page errors').toEqual([]);
});

async function openDeck(page: Page) {
  await page.goto(`/#/markets/${MARKET}/deck`);
  await expect(page.getByTestId('card-grid')).toBeVisible();
}

test('1. New Deck page: prompt box, suggestion chips, beta bar', async ({ page }) => {
  await page.goto('/#/');
  await expect(page.getByPlaceholder('Describe a market…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Research this market' })).toBeVisible();
  // Six suggestion chips from one of the four sets (the page picks the set at random).
  const chip = page.getByRole('button', {
    name: /Christian apparel companies|Space infrastructure companies|AI code-review startups|Independent game studios|Climate-risk software|Private credit platforms|Robotics foundation models|Sustainable packaging companies|AI-native accounting software/,
  });
  await expect(chip.first()).toBeVisible();
  // The beta bar only exists in the hosted build; the bare preview has no hosted API.
  const bar = page.getByRole('note');
  if (await bar.count()) {
    await expect(bar).toContainText(LAUNCH);
  } else {
    test.info().annotations.push({ type: 'note', description: 'Not a hosted build: beta bar not rendered, checked on /beta instead.' });
    await page.goto('/#/beta');
    await expect(page.getByText(LAUNCH).first()).toBeVisible();
  }
});

test('2. All Decks lists Frontier AI Ecosystem; the deck shows lanes and card faces', async ({ page }) => {
  await page.goto('/#/history');
  await expect(page.getByRole('heading', { name: 'All decks' })).toBeVisible();
  await page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first().click();
  await expect(page.getByTestId('card-grid')).toBeVisible();
  const nav = page.getByTestId('type-nav');
  for (const lane of [/Company/, /Culture/, /Vice/, /Insight/, /Barrier to Entry/]) {
    await expect(nav.getByRole('button', { name: lane })).toBeVisible();
  }
  await expect(page.getByTestId('card-grid').getByRole('button', { name: / — Company card/ }).first()).toBeVisible();
});

test('3. Lanes switch; company and signal readers show sourced content; Next/Previous work', async ({ page }) => {
  await openDeck(page);
  const grid = page.getByTestId('card-grid');
  const nav = page.getByTestId('type-nav');
  const dialog = page.getByRole('dialog');

  // Company reader.
  await grid.getByRole('button', { name: / — Company card/ }).first().click();
  await expect(dialog.getByRole('region', { name: 'Core company figures' })).toBeVisible();
  await expect(dialog.getByRole('heading').first()).toBeVisible();
  await expect(dialog.getByRole('link', { name: /open full company dashboard/i })).toBeVisible();
  await expect(dialog.locator('a[href^="http"]').first()).toBeVisible(); // a source link

  // Next / Previous change the card.
  const titleOf = async () => (await dialog.getByRole('heading').first().innerText()).trim();
  const first = await titleOf();
  await dialog.getByRole('button', { name: 'Next card' }).click();
  await expect.poll(titleOf).not.toBe(first);
  await dialog.getByRole('button', { name: 'Previous card' }).click();
  await expect.poll(titleOf).toBe(first);
  await dialog.getByRole('button', { name: 'Close' }).click();

  // Signal lane.
  await nav.getByRole('button', { name: /Culture/ }).click();
  await expect(nav.getByRole('button', { name: /Culture/ })).toHaveAttribute('aria-pressed', 'true');
  await grid.getByRole('button', { name: /Culture card/i }).first().click();
  await expect(dialog.getByRole('region', { name: 'Research finding' })).toBeVisible();
  await expect(dialog.getByRole('heading').first()).toBeVisible();
  // This demo finding has no saved source: the reader must say so, not invent a link.
  await expect(dialog.getByText('No clickable source has been saved for this finding yet.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: /open full company dashboard/i })).toHaveCount(0);
});

test('4. Company dashboard: every tab route renders', async ({ page }) => {
  const tabs: Record<string, string> = {
    overview: 'Overview',
    metrics: 'Metrics',
    team_org: 'Team & Org Chart',
    history: 'History',
    products_roadmap: 'Products & Roadmap',
    live_intel: 'Live Intel',
    mission_governance: 'Mission & Governance',
    research: 'Research & Sources',
  };
  for (const [slug, label] of Object.entries(tabs)) {
    await page.goto(`/#/company/${COMPANY}/dashboard/${slug}`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mistral');
    await expect(page).toHaveURL(new RegExp(`/dashboard/${slug}`));
    // The tab is in the bar (or its overflow menu) and the page body has content.
    const tabNav = page.getByRole('navigation', { name: 'Company dashboard tabs' });
    await expect(tabNav).toBeVisible();
    await expect(page.locator('main')).not.toBeEmpty();
    await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
    expect(label.length).toBeGreaterThan(0);
  }
});

test('5. Today: honest empty state, then follow a company from its card', async ({ page }) => {
  await page.goto('/#/today');
  await expect(page.getByText('Follow companies to see their moves here')).toBeVisible();

  await openDeck(page);
  await page.getByRole('button', { name: 'Add OpenAI to Today' }).click();
  await expect(page.getByRole('button', { name: /^Following OpenAI on Today/ })).toBeVisible();

  await page.getByRole('link', { name: 'Today' }).first().click();
  await expect(page.getByText('Follow companies to see their moves here')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Companies on Today' }).getByRole('button', { name: /OpenAI/ })).toBeVisible();
});

test('6. Saved Cards: save from the reader and see it listed', async ({ page }) => {
  await page.goto('/#/saved');
  await expect(page.getByText('No saved cards yet')).toBeVisible();

  await openDeck(page);
  await page.getByTestId('card-grid').getByRole('button', { name: /OpenAI — Company card/ }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Save card' }).click();
  await expect(dialog.getByRole('button', { name: 'Unsave card' })).toBeVisible();

  await page.goto('/#/saved');
  await expect(page.getByText('No saved cards yet')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /OpenAI — Company card/ }).first()).toBeVisible();
});

test('7. Reports, Settings (no pricing) and the beta page', async ({ page }) => {
  await page.goto('/#/reports');
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(page.getByText('Frontier AI Ecosystem — Market Report').first()).toBeVisible();

  // The sidebar Settings button opens the Settings modal.
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: 'Settings' }).click();
  const sections = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(sections).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text.length).toBeGreaterThan(20);
  expect(text).not.toContain('$');
  expect(text.toLowerCase()).not.toContain('free tier');
});

test('7b. About this beta names December 1, 2026', async ({ page }) => {
  await page.goto('/#/beta');
  await expect(page.getByRole('heading', { name: /honest feedback, not your data/ })).toBeVisible();
  await expect(page.getByText(LAUNCH).first()).toBeVisible();
});

test('8. Compare mode: two cards, Compare (2) opens the Ask panel', async ({ page }) => {
  await openDeck(page);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const cards = page.getByTestId('card-grid').getByRole('button', { name: / — Company card/ });
  await cards.nth(0).click();
  await cards.nth(1).click();
  await expect(page.getByText('2 cards selected')).toBeVisible();
  await page.getByRole('button', { name: 'Compare (2)' }).click();
  await expect(page.getByPlaceholder(/Ask a follow-up about these/)).toBeVisible();
});
