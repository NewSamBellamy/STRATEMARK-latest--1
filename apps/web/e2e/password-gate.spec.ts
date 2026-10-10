import { test, expect } from '@playwright/test';

test.describe('Password Gate & Core Agent Testing Flow', () => {
  test('unlocks the private preview with access code SENTINEL-DECK-77 and accesses the agent research tool', async ({ page }) => {
    // 1. Visit root without unlocking via script so the real gate is under test
    await page.goto('/#/');

    // 2. Locate the access code input and fill in user's password
    const accessInput = page.locator('#access-code');
    await expect(accessInput).toBeVisible();
    await accessInput.fill('SENTINEL-DECK-77');

    // 3. Submit password
    await page.getByRole('button', { name: /Enter/i }).click();

    // 4. Verify successful unlock and main application interface
    await expect(page.getByPlaceholder('Describe a market…')).toBeVisible({ timeout: 10_000 });

    // 5. Verify market research input & creation flow affordances
    const searchInput = page.getByPlaceholder('Describe a market…');
    await searchInput.fill('Autonomous AI Agents 2026');

    const researchButton = page.getByRole('button', { name: 'Research this market' });
    await expect(researchButton).toBeVisible();
    await researchButton.click();

    // 6. Verify agent key requirement or execution gate
    await expect(
      page.getByText('Researching a new market needs your Gemini API key.')
        .or(page.getByText(/Researching/i)),
    ).toBeVisible();
  });
});
