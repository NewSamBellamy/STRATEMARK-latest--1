import { test, expect } from '@playwright/test';
import { unlockPreview } from './access';

/** Public repository sample only; isolated browser storage, no real key/run. */
test('G00 public-sample baseline: library, deck, reader and company workspace', async ({
  page,
}, testInfo) => {
  const researchAttempts: string[] = [];
  const blockedOrigins = new Set<string>();
  const startupErrors: string[] = [];
  page.on('pageerror', (error) => startupErrors.push(error.message.slice(0, 500)));
  page.on('console', (message) => {
    if (message.type() === 'error') startupErrors.push(message.text().slice(0, 500));
  });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const local = url.origin === new URL(testInfo.project.use.baseURL!).origin;
    if (local || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
    blockedOrigins.add(url.origin);
    if (/generativelanguage|openrouter|perplexity|firecrawl|serper/.test(url.hostname)) {
      researchAttempts.push(url.origin);
    }
    return route.abort();
  });
  await unlockPreview(page);
  const capture = async (name: string) => {
    const path = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true, animations: 'disabled' });
    await testInfo.attach(name, { path, contentType: 'image/png' });
  };

  await page.goto('/#/history');
  const sample = page.getByRole('button', { name: /Frontier AI Ecosystem/ }).first();
  try {
    await expect(sample).toBeVisible();
  } catch (error) {
    await testInfo.attach('public-sample-startup', {
      body: JSON.stringify({ startupErrors, blockedExternalOrigins: [...blockedOrigins] }),
      contentType: 'application/json',
    });
    throw error;
  }
  await capture('01-library-public-sample');
  await sample.click();
  await expect(page.getByTestId('card-grid')).toBeVisible();
  await capture('02-deck-public-sample');
  await page
    .getByRole('button', { name: /OpenAI/ })
    .first()
    .click();
  const reader = page.getByRole('dialog');
  await expect(reader).toBeVisible();
  await capture('03-reader-public-sample');
  await reader.getByRole('link', { name: /explore research/i }).click();
  await expect(page.getByText('Company brief', { exact: true })).toBeVisible();
  await capture('04-company-public-sample');
  await page.reload();
  await expect(page.getByText('Company brief', { exact: true })).toBeVisible();
  expect(researchAttempts).toEqual([]);
  await testInfo.attach('network-boundary', {
    body: JSON.stringify({
      researchAttempts,
      blockedExternalOrigins: [...blockedOrigins],
      scope: 'Public sample, no configured key; NOT live research or packaged desktop proof',
    }),
    contentType: 'application/json',
  });
});
