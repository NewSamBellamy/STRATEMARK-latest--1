import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CARD_TYPES, isSignalCardType, type CardWithCompany } from '@mi/contracts';
import { CardCompositionPage } from './CardCompositionPage';
import { CollectibleCard } from './CollectibleCard';
import { buildCardView } from './card-view';

function fixture(): CardWithCompany {
  return {
    card: {
      id: 'synthetic-card',
      deckId: 'synthetic-deck',
      companyId: 'synthetic-company',
      cardType: 'company',
      title: 'Synthetic finding headline',
      summary: 'Synthetic market context.',
      tier: 8,
      tierReason: null,
      citations: [],
      keyPoints: [],
      createdAt: '2026-10-01T12:00:00Z',
    },
    company: {
      id: 'synthetic-company',
      name: 'Synthetic company',
      oneLiner: 'Synthetic purpose.',
      hqLocation: null,
      logoUrl: null,
      websiteUrl: null,
      brandTheme: null,
    },
    metrics: [
      {
        id: 'synthetic-metric',
        companyId: 'synthetic-company',
        metricType: 'arr',
        value: 99,
        confidence: 'verified',
        source: 'https://fixtures.invalid/metric',
        citations: [{ title: 'Synthetic metric source', url: 'https://fixtures.invalid/metric' }],
        methodNote: null,
        capturedAt: '2026-10-01T12:00:00Z',
      },
    ],
    viceClaims: [],
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('R0 card composition', () => {
  it('renders all seven wire types plus edge cases without providers or image requests', () => {
    const fetch = vi.fn();
    const image = vi.fn();
    const xhr = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('Image', image);
    vi.stubGlobal('XMLHttpRequest', xhr);
    const { container } = render(<CardCompositionPage />);
    const faces = screen.getAllByTestId('collectible-card-front');
    expect(faces).toHaveLength(9);
    expect(new Set(faces.map((face) => face.dataset.cardType))).toEqual(new Set(CARD_TYPES));
    expect(container.textContent).toContain('SYNTHETIC FIXTURES ONLY');
    expect(container.textContent).toContain('Owner aesthetic approval is pending');
    expect(container.querySelector('svg, img, canvas')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(image).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview Offline intake may be a useful wedge' }),
    );
    expect(screen.getByText('Observation versus interpretation')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Evidence' }));
    expect(
      screen.getByText('SYNTHETIC · Offline intake may be a useful wedge source note'),
    ).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    expect(image).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
  });

  it.each(CARD_TYPES.filter(isSignalCardType))(
    'uses a %s headline and own support, never associated entity metrics',
    (type) => {
      const entity = fixture();
      const data = {
        ...entity,
        card: {
          ...entity.card,
          cardType: type,
          citations: [{ title: 'Synthetic story source', url: 'https://fixtures.invalid/story' }],
        },
      };
      // Even a caller supplying an entity view cannot put company numbers on a finding.
      const { container } = render(<CollectibleCard data={data} view={buildCardView(entity)} />);
      expect(screen.getByText('Synthetic finding headline')).toBeVisible();
      expect(container.querySelector('.collectible__metrics, .collectible__art')).toBeNull();
      expect(screen.getByText('1 source')).toBeVisible();
      expect(screen.queryByText(/T8|Scale unverified/)).toBeNull();
      if (type === 'culture') {
        expect(screen.getByText('Community')).toBeVisible();
        expect(container.textContent).not.toContain('Culture');
        expect(data.card.cardType).toBe('culture');
      }
    },
  );

  it('retains supplied entity facts while replacing rank with honest research status', () => {
    render(<CollectibleCard data={fixture()} />);
    expect(screen.getByText('ARR')).toBeVisible();
    expect(screen.getByText('$99')).toBeVisible();
    expect(screen.getByText('Source links saved')).toBeVisible();
    expect(screen.queryByText(/T8|Scale unverified/)).toBeNull();
  });

  it('does not use company sources to promote an unsourced Vice allegation', () => {
    const data = fixture();
    data.card.cardType = 'vice';
    data.card.title = 'Unsupported adverse headline';
    render(<CollectibleCard data={data} />);
    expect(screen.getByText('Risk finding needs review')).toBeVisible();
    expect(screen.getByText('Research needed')).toBeVisible();
    expect(screen.queryByText('Unsupported adverse headline')).toBeNull();
    expect(screen.queryByText('Synthetic market context.')).toBeNull();
  });

  it('keeps legacy evidence explicitly unreviewed', () => {
    const data = { ...fixture(), evidenceState: 'legacy_unreviewed' as const };
    render(<CollectibleCard data={data} />);
    expect(screen.getByText('Unreviewed')).toBeVisible();
    expect(screen.getByText('Not revalidated')).toBeVisible();
    expect(screen.queryByText('Source links saved')).toBeNull();
    expect(screen.queryByText('ARR')).toBeNull();
  });
});
