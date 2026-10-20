import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CardWithCompany } from '@mi/contracts';
import { SignalFinding } from './SignalFinding';

const claim = (id: string, claimText: string, sourceUrl: string) => ({
  id, cardId: 'crd_vice', claimText, sourceTitle: 'Source', sourceUrl, capturedAt: '2026-10-01T00:00:00.000Z',
});

function riskCard(viceClaims: ReturnType<typeof claim>[]): CardWithCompany {
  return {
    card: { id: 'crd_vice', deckId: 'd', companyId: 'co', cardType: 'vice', title: null, summary: null, tier: null, tierReason: null, citations: [], keyPoints: [], createdAt: '2026-10-01T00:00:00.000Z' },
    company: { id: 'co', name: 'Acme Robotics', oneLiner: 'Warehouse robots.', logoUrl: null, hqLocation: null, websiteUrl: null, brandTheme: null },
    metrics: [],
    viceClaims,
  } as unknown as CardWithCompany;
}

describe('the signal reader never draws an allegation that has no clickable source (Rule 9)', () => {
  it('shows the sourced claim and neither the unsourced one nor the script-linked one', () => {
    render(<SignalFinding
      data={riskCard([
        claim('v1', 'An unsourced rumour about the company.', ''),
        claim('v2', 'A script link is not a source.', 'javascript:alert(1)'),
        claim('v3', 'A regulator opened a documented inquiry.', 'https://regulator.example.gov/filing'),
      ])}
      citations={[{ url: 'https://regulator.example.gov/filing', title: 'Regulator' }]}
    />);
    expect(screen.getByText('A regulator opened a documented inquiry.')).toBeInTheDocument();
    expect(screen.queryByText(/unsourced rumour/)).toBeNull();
    expect(screen.queryByText(/script link/)).toBeNull();
  });

  it('shows no findings at all for a risk whose claims are all unsourced', () => {
    render(<SignalFinding data={riskCard([claim('v1', 'An unsourced rumour about the company.', '')])} citations={[]} />);
    expect(screen.queryByText(/unsourced rumour/)).toBeNull();
  });
});
