import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import type { CardWithCompany } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { buildCardShare, encodeSharePayload, type SharePayload } from '@/lib/share/codec';
import SharePage from './SharePage';

async function openShare(payload: SharePayload) {
  const blob = await encodeSharePayload(payload);
  const rendered = renderWithProviders(
    <Routes>
      <Route path="/share/:blob" element={<SharePage />} />
      <Route path="/new" element={<h1>New deck</h1>} />
    </Routes>,
    { route: `/share/${blob}` },
  );
  return rendered;
}

describe('shared market finding evidence', () => {
  it('shows each claim with its own source and reported period to the recipient', async () => {
    const now = new Date().toISOString();
    const finding = {
      card: {
        id: 'insight_share',
        deckId: 'deck_1',
        companyId: null,
        cardType: 'insight',
        title: 'Inference pricing shift',
        summary: 'Providers are changing inference prices.',
        tier: null,
        tierReason: null,
        citations: [],
        keyPoints: ['Unlinked note must not be shared as a fact.'],
        evidencePoints: [
          {
            text: 'Hosted inference prices fell during Q2.',
            timeWindow: 'Q2 2026',
            citations: [{ title: 'provider.example', url: 'https://provider.example/pricing' }],
          },
        ],
        createdAt: now,
      },
      company: null,
      metrics: [],
      viceClaims: [],
    } as CardWithCompany;
    const { user } = await openShare(buildCardShare(finding, 'Frontier AI'));

    await user.click(
      await screen.findByRole('button', { name: /inference pricing shift — insight card/i }),
    );
    expect(screen.getByText('AI-attributed details')).toBeInTheDocument();
    expect(screen.getAllByText('Hosted inference prices fell during Q2.')).toHaveLength(2);
    expect(screen.getByText(/AI-reported period · Q2 2026/)).toBeInTheDocument();
    expect(screen.getByText(/not been independently verified/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /provider\.example/i })).toHaveAttribute(
      'href',
      'https://provider.example/pricing',
    );
    expect(
      screen.queryByText('Unlinked note must not be shared as a fact.'),
    ).not.toBeInTheDocument();
  });

  it('keeps old v1 links readable but omits their unlinked market details', async () => {
    const payload: SharePayload = {
      v: 1,
      kind: 'card',
      market: 'Frontier AI',
      sharedAt: new Date().toISOString(),
      cards: [
        {
          type: 'insight',
          title: 'Older finding',
          summary: 'The card summary remains available.',
          tier: null,
          keyPoints: ['This older claim has no source link.'],
          citations: [],
          claims: [],
          company: null,
          metrics: [],
        },
      ],
    };
    const { user } = await openShare(payload);

    await user.click(await screen.findByRole('button', { name: /older finding — insight card/i }));
    expect(screen.getAllByText('The card summary remains available.')).toHaveLength(2);
    expect(
      screen.getByText(
        /older detail notes are omitted because this share doesn’t include claim-specific source links/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('This older claim has no source link.')).not.toBeInTheDocument();
  });
});

describe('shared research navigation', () => {
  it.each(['card', 'deck', 'briefing', 'report'] as const)(
    'opens New Deck from a shared %s',
    async (kind) => {
      const sharedAt = '2026-10-01T12:00:00.000Z';
      const payload: SharePayload = {
        v: 1,
        kind,
        market: 'Frontier AI',
        sharedAt,
        cards: [
          {
            type: 'insight',
            title: 'Shared finding',
            summary: 'Saved research snapshot.',
            tier: null,
            keyPoints: [],
            citations: [],
            claims: [],
            company: null,
            metrics: [],
          },
        ],
      };
      if (kind === 'briefing') {
        payload.briefing = { h: 'Saved briefing', at: sharedAt, w: 24, u: [], i: [] };
      }
      if (kind === 'report') {
        payload.report = {
          t: 'Saved report',
          k: 'deck',
          at: sharedAt,
          md: 'Saved research.',
          c: [],
        };
      }
      const { user } = await openShare(payload);

      const link = await screen.findByRole('link', { name: 'Research your own market' });
      expect(link).toHaveAttribute('href', '/new');
      await user.click(link);
      expect(await screen.findByRole('heading', { name: 'New deck' })).toBeInTheDocument();
    },
  );
});
