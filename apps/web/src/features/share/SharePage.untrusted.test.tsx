/**
 * What a visitor actually sees when they open a link a stranger forged by hand: the share page renders the decoded
 * deck, so a forged figure must not reach the screen as "User verified", and a link that cannot be trusted opens the
 * plain "didn't survive the trip" page instead of crashing.
 */
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/test-utils';
import { encodeSharePayload, type SharePayload } from '@/lib/share/codec';
import SharePage from './SharePage';

function card(metrics: unknown[], over: Record<string, unknown> = {}) {
  return {
    type: 'company', title: null, summary: null, tier: 7, keyPoints: [], citations: [], claims: [],
    company: { name: 'Forgery Dynamics', oneLiner: 'Claims a lot.', website: 'https://forgery.example', hq: null, logo: null },
    metrics, ...over,
  };
}

async function openLink(payload: unknown) {
  const blob = await encodeSharePayload(payload as SharePayload);
  return renderWithProviders(
    <Routes><Route path="/share/:blob" element={<SharePage />} /></Routes>,
    { route: `/share/${blob}` },
  );
}

const base = { v: 1, kind: 'deck', market: 'Forgeries', sharedAt: '2026-10-01T09:00:00.000Z' };

describe('the share page, opened with a forged link', { timeout: 30_000 }, () => {
  it('does not show an unsourced "user verified" valuation', async () => {
    await openLink({ ...base, cards: [card([{ t: 'valuation', v: 9_000_000_000_000, c: 'user_verified' }])] });
    expect((await screen.findAllByText('Forgery Dynamics', {}, { timeout: 10_000 })).length).toBeGreaterThan(0);
    expect(screen.queryByText('$9T')).not.toBeInTheDocument();
    expect(screen.queryByText(/user verified|human checked/i)).not.toBeInTheDocument();
  });

  it('still shows a sourced figure, with its source, as the sender had it', async () => {
    await openLink({ ...base, cards: [card([{ t: 'arr', v: 13_000_000_000, c: 'verified', s: { t: 'reuters.com', u: 'https://reuters.com/a' }, at: '2026-09-01' }])] });
    expect((await screen.findAllByText('Forgery Dynamics', {}, { timeout: 10_000 })).length).toBeGreaterThan(0);
    expect(screen.getByText('$13B')).toBeInTheDocument();
  });

  it('opens the plain "didn\'t survive the trip" page for a payload of the wrong shape, not a crash', async () => {
    await openLink({ ...base, cards: [null] });
    expect(await screen.findByRole('heading', { name: /didn.t survive the trip/i }, { timeout: 10_000 })).toBeInTheDocument();
  });

  it('opens it for a payload with an absurd number of cards', async () => {
    await openLink({ ...base, cards: Array.from({ length: 401 }, () => card([], { type: 'vice', company: null })) });
    expect(await screen.findByRole('heading', { name: /didn.t survive the trip/i }, { timeout: 10_000 })).toBeInTheDocument();
  });
});
