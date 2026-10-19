import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { unlockPreview } from './access';

// Uses the zero-state seed deck (Frontier AI Ecosystem — a real researched
// deck, not fabricated demo data) so these checks run without an API key.
const PAGES: Array<[string, string, string]> = [
  ['markets', '/#/history', 'text=All decks'],
  ['deck', '/#/markets/mkt_frontier-ai-ecosystem_s248s/deck', '[data-testid="card-grid"]'],
  ['dashboard', '/#/company/cmp_openai_5sz16/dashboard/overview', 'text=Key figures'],
  // The screens the first three do not reach: every top-level screen and every dashboard tab, on the same seed deck.
  ['today', '/#/today', 'h1:has-text("Today")'],
  ['saved cards', '/#/saved', 'h1:has-text("Saved Cards")'],
  ['reports', '/#/reports', 'h1:has-text("Reports")'],
  ['settings', '/#/settings', 'h1:has-text("Settings"), h2:has-text("Settings")'],
  ['settings: engine', '/#/settings/engine', 'text=Research engine'],
  ['settings: data', '/#/settings/data', 'text=Data safety'],
  ['beta', '/#/beta', 'text=We want your honest feedback'],
  ['opportunity', '/#/markets/mkt_frontier-ai-ecosystem_s248s/opportunity', 'text=where the gap is'],
  ['briefing', '/#/markets/mkt_frontier-ai-ecosystem_s248s/briefing', 'h1:has-text("Daily Briefing")'],
  ['deck settings', '/#/markets/mkt_frontier-ai-ecosystem_s248s/settings', 'text=Deck settings'],
  ['dashboard: history', '/#/company/cmp_openai_5sz16/dashboard/history', 'h1:has-text("OpenAI")'],
  ['dashboard: products', '/#/company/cmp_openai_5sz16/dashboard/products_roadmap', 'h1:has-text("OpenAI")'],
  ['dashboard: live intel', '/#/company/cmp_openai_5sz16/dashboard/live_intel', 'h1:has-text("OpenAI")'],
  ['dashboard: mission', '/#/company/cmp_openai_5sz16/dashboard/mission_governance', 'h1:has-text("OpenAI")'],
  ['dashboard: research', '/#/company/cmp_openai_5sz16/dashboard/research', 'h1:has-text("OpenAI")'],
];

for (const [name, path, waitFor] of PAGES) {
  test(`accessibility: ${name} has no serious/critical violations`, async ({ page }) => {
    await page.route(/fonts\.(googleapis|gstatic)\.com|example\.com/, (route) => route.abort());
    await unlockPreview(page);
    await page.goto(path);
    await page.waitForSelector(waitFor, { timeout: 10_000 });
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    const seriousOrCritical = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    // Surface any offenders in the failure message.
    expect(
      seriousOrCritical,
      seriousOrCritical.map((v) => `${v.id}: ${v.help}`).join('\n'),
    ).toEqual([]);
  });
}
