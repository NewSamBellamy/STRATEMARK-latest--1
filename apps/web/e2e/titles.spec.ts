import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
  await unlockPreview(page);
});

// A row of open tabs, a bookmark and a screen reader's window list all read the title: each screen names itself.
test('every screen titles its tab, and the title follows the user from screen to screen', async ({ page }) => {
  const titles: Array<[string, string | RegExp]> = [
    ['/#/today', 'Today · Stratemark'],
    ['/#/history', 'All decks · Stratemark'],
    ['/#/saved', 'Saved cards · Stratemark'],
    ['/#/reports', 'Reports · Stratemark'],
    ['/#/beta', 'Free beta · Stratemark'],
    ['/#/markets/mkt_frontier-ai-ecosystem_s248s/opportunity', 'Opportunity · Stratemark'],
    ['/#/markets/mkt_frontier-ai-ecosystem_s248s/briefing', 'Daily briefing · Stratemark'],
    ['/#/markets/mkt_frontier-ai-ecosystem_s248s/settings', 'Deck settings · Stratemark'],
    ['/#/company/cmp_openai_5sz16/dashboard/history', 'OpenAI · History · Stratemark'],
    ['/#/company/cmp_openai_5sz16/dashboard/products_roadmap', /^OpenAI · .+ · Stratemark$/],
    ['/#/this-page-does-not-exist', 'Page not found · Stratemark'],
  ];
  for (const [path, title] of titles) {
    await page.goto(path);
    await expect(page, path).toHaveTitle(title);
  }
});

test('leaving a screen for another replaces the title, with no stale one left behind', async ({ page }) => {
  await page.goto('/#/today');
  await expect(page).toHaveTitle('Today · Stratemark');
  await page.getByText('All decks', { exact: true }).first().click();
  await expect(page).toHaveTitle('All decks · Stratemark');
  await page.getByText('Saved cards', { exact: true }).first().click();
  await expect(page).toHaveTitle('Saved cards · Stratemark');
});
