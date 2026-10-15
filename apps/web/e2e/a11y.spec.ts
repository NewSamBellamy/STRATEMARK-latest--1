import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { unlockPreview } from './access';

// Uses the zero-state seed deck (Frontier AI Ecosystem — a real researched
// deck, not fabricated demo data) so these checks run without an API key.
const PAGES: Array<[string, string, string]> = [
  ['markets', '/#/history', 'text=All decks'],
  ['deck', '/#/markets/mkt_frontier-ai-ecosystem_s248s/deck', '[data-testid="card-grid"]'],
  ['dashboard', '/#/company/cmp_openai_5sz16/dashboard/overview', 'text=Key figures'],
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
