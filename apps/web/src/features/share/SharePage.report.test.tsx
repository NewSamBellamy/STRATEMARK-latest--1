/** The report in a private link: a stranger can write it, and it is shown through the bounded markdown renderer. */
import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/test-utils';
import SharePage from './SharePage';

const base64Url = (text: string) => Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const linkTo = (markdown: string) => `/share/j${base64Url(JSON.stringify({
  v: 1, kind: 'report', market: null, sharedAt: '2026-10-19T10:00:00.000Z', cards: [],
  report: { t: 'Acme report', k: 'company', at: '2026-10-19T10:00:00.000Z', md: markdown, c: [] },
}))}`;

function open(markdown: string) {
  return renderWithProviders(<Routes><Route path="/share/:blob" element={<SharePage />} /></Routes>, { route: linkTo(markdown) });
}

describe('the report in a private link', () => {
  it('opens a report written to freeze the markdown parser, as plain text, at once', async () => {
    // 40,000 characters took more than seven seconds to render before; a hundred and sixty thousand never finished.
    const view = open('*a'.repeat(20_000));
    await screen.findByRole('heading', { name: 'Acme report' }, { timeout: 5_000 });
    const started = performance.now();
    await waitFor(() => expect(view.container.querySelectorAll('p.whitespace-pre-line').length).toBeGreaterThan(0));
    expect(performance.now() - started).toBeLessThan(1_500);
    expect(view.container.querySelector('em')).toBeNull();
  }, 60_000);

  it('opens a report nested past what the parser can hold, instead of failing to render', async () => {
    const view = open(`Intro.\n\n${'> '.repeat(900)}x\n\nOutro.`);
    await screen.findByRole('heading', { name: 'Acme report' });
    await waitFor(() => expect(view.container.querySelectorAll('p.whitespace-pre-line').length).toBeGreaterThan(0));
    expect(view.container.textContent).toMatch(/Intro\./);
    expect(view.container.textContent).toMatch(/Outro\./);
  });

  it('still formats an ordinary report', async () => {
    const view = open('## Findings\n\nRevenue was **steady**.\n\n- one\n- two');
    await screen.findByRole('heading', { name: 'Acme report' });
    await waitFor(() => expect(view.container.querySelector('strong')?.textContent).toBe('steady'));
    expect(view.container.querySelectorAll('li')).toHaveLength(2);
  });
});
