import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { CARD_TYPES, isSignalCardType } from '@mi/contracts';
import { buildDataset } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { GameCard } from './GameCard';
import { contrastRatio } from '@/lib/brand';

const data = buildDataset();
const companyCard = data.cards.find(
  (c) => c.cardType === 'company' && c.companyId === 'cmp_gracewear-global',
)!;
const viceCard = data.cards.find((c) => c.cardType === 'vice')!;
const barrierCard = data.cards.find((c) => c.cardType === 'barrier')!;

function hydrate(cardId: string) {
  const card = data.cards.find((c) => c.id === cardId)!;
  const company = card.companyId ? data.companies.find((c) => c.id === card.companyId)! : null;
  const metrics = card.companyId ? data.metrics.filter((m) => m.companyId === card.companyId) : [];
  const viceClaims = data.viceClaims.filter((v) => v.cardId === card.id);
  return { card, company, metrics, viceClaims };
}

function sourcedCompany() {
  const cwc = hydrate(companyCard.id);
  return {
    ...cwc,
    // Synthetic support for existing demo values, never real research evidence.
    metrics: cwc.metrics
      .filter((m) => ['arr', 'market_cap'].includes(m.metricType))
      .map((m) => ({
        ...m,
        confidence: 'verified' as const,
        source: `https://fixtures.invalid/${m.metricType}`,
        citations: [
          {
            title: `Synthetic ${m.metricType} source`,
            url: `https://fixtures.invalid/${m.metricType}`,
          },
        ],
        capturedAt: '2026-10-01T12:00:00Z',
      })),
  };
}

describe('GameCard', () => {
  it('shows the company identity while a logo lookup is still unresolved', () => {
    const cwc = hydrate(companyCard.id);
    // jsdom image probes do not resolve this synthetic, non-routable URL.
    renderWithProviders(
      <GameCard
        data={{
          ...cwc,
          company: { ...cwc.company!, logoUrl: 'https://fixture.invalid/logo.svg' },
        }}
      />,
    );
    expect(screen.getByLabelText(`${cwc.company!.name} monogram`)).toBeVisible();
  });

  it.each(['#FFFFFF', '#F6F3EF', '#FFFF00', '#00FF00', '#FF5A00', '#000000', '#123456'])(
    'keeps an offline identity readable for a %s brand without changing its palette',
    (primary) => {
      const cwc = hydrate(companyCard.id);
      renderWithProviders(
        <GameCard
          data={{
            ...cwc,
            company: {
              ...cwc.company!,
              websiteUrl: null,
              logoUrl: null,
              brandTheme: { ...cwc.company!.brandTheme!, primary, source: 'manual' },
            },
          }}
        />,
      );
      const front = screen.getByTestId('collectible-card-front');
      const ink = front.style.getPropertyValue('--card-mark-ink');
      expect(contrastRatio(ink, '#d2d0c8')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ink, '#fffdfa')).toBeGreaterThanOrEqual(4.5);
      expect(front.style.getPropertyValue('--card-accent')).toBe(primary);
      const mark = screen.getByLabelText(`${cwc.company!.name} monogram`).querySelector('span');
      expect(mark?.style.color).toBe('var(--card-mark-ink, #1c2b28)');
    },
  );

  it('shows identity and exact missing-research status without unsupported figures or rank', () => {
    const cwc = hydrate(companyCard.id);
    renderWithProviders(<GameCard data={cwc} />);
    expect(screen.getAllByText('GraceWear Global').length).toBeGreaterThan(0);
    expect(screen.getByText(cwc.company!.oneLiner)).toBeInTheDocument();
    const front = screen.getByTestId('collectible-card-front');
    const footer = front.querySelector('.collectible__footer')!;
    expect(Array.from(footer.children, (child) => child.textContent)).toEqual([
      'Research needed',
      'No source links saved',
    ]);
    expect(front.querySelector('.collectible__metrics')).toBeNull();
    expect(within(front).queryByText('ARR')).not.toBeInTheDocument();
    expect(
      within(front).queryByText(/T[1-8]\b|Scale unverified|Very Strong|Very Weak/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/FIELD NOTE/i)).not.toBeInTheDocument();
    // HQ shown.
    expect(screen.getByText(/Los Angeles/)).toBeInTheDocument();
  });

  it('shows supported facts with source status while keeping the stored tier off the face', () => {
    const cwc = sourcedCompany();
    expect(cwc.card.tier).toBe(8);
    renderWithProviders(<GameCard data={cwc} />);
    const front = screen.getByTestId('collectible-card-front');
    expect(within(front).getByText('ARR')).toBeVisible();
    expect(within(front).getByText('$6.2B')).toBeVisible();
    expect(within(front).getByText('Market Cap')).toBeVisible();
    expect(within(front).getByText('$120B')).toBeVisible();
    expect(within(front).getAllByText('Sourced')).toHaveLength(2);
    expect(
      Array.from(
        front.querySelector('.collectible__footer')!.children,
        (child) => child.textContent,
      ),
    ).toEqual(['Source links saved', '2 source links · Recorded Oct 1, 2026']);
    expect(
      within(front).queryByText(/T[1-8]\b|Scale unverified|Market Defining|Very Strong|Very Weak/),
    ).not.toBeInTheDocument();
  });

  it('labels unreviewed link leads and a metric record date without implying captured pages', () => {
    const cwc = sourcedCompany();
    renderWithProviders(
      <GameCard
        data={{
          ...cwc,
          card: {
            ...cwc.card,
            citations: Array.from({ length: 39 }, (_, index) => ({
              title: `Unreviewed lead ${index}`,
              url: `https://fixtures.invalid/lead-${index}`,
            })),
          },
          metrics: cwc.metrics.map((metric) => ({
            ...metric,
            confidence: 'unknown',
            value: null,
            source: null,
            citations: [],
          })),
        }}
      />,
    );
    const front = screen.getByTestId('collectible-card-front');
    const footer = front.querySelector('.collectible__footer')!;
    expect(Array.from(footer.children, (child) => child.textContent)).toEqual([
      'Source links saved',
      '39 source links · Recorded Oct 1, 2026',
    ]);
    expect(footer.textContent).not.toMatch(/\bsources\b|Captured/);
    expect(front.querySelector('.collectible__metrics')).toBeNull();
  });

  it.each(['unsourced', 'estimated', 'unknown', 'invalid'] as const)(
    'keeps %s figures off the face without treating a source link as verification',
    (state) => {
      const cwc = sourcedCompany();
      const arr = cwc.metrics.find((m) => m.metricType === 'arr')!;
      renderWithProviders(
        <GameCard
          data={{
            ...cwc,
            metrics: [
              {
                ...arr,
                confidence:
                  state === 'estimated'
                    ? 'estimated'
                    : state === 'unknown'
                      ? 'unknown'
                      : 'verified',
                value: state === 'invalid' ? -Math.abs(arr.value!) : arr.value,
                source: state === 'unsourced' ? 'Synthetic prose attribution only' : arr.source,
                citations: state === 'unsourced' ? [] : arr.citations,
              },
            ],
          }}
        />,
      );
      const front = screen.getByTestId('collectible-card-front');
      expect(front.querySelector('.collectible__metrics')).toBeNull();
      expect(within(front).queryByText('ARR')).toBeNull();
      expect(within(front).queryByText(/\$6\.2B|Sourced|Estimated|Unknown/)).toBeNull();
      expect(
        within(front).getByText(state === 'unsourced' ? 'Research needed' : 'Source links saved'),
      ).toBeVisible();
    },
  );

  it('never renders a fabricated YoY growth arrow (no-fabrication rule)', () => {
    // The card used to paint `fakeYoY` percentages invented from the metric's
    // own digits. Growth indicators are banned until real history exists.
    renderWithProviders(<GameCard data={sourcedCompany()} />);
    expect(screen.queryByText(/%\s*YoY/i)).not.toBeInTheDocument();
    // Supported facts retain confidence; excluded estimates never receive a face chip.
    expect(screen.getAllByText('Sourced')).toHaveLength(2);
    expect(screen.queryByText('Estimated')).not.toBeInTheDocument();
  });

  it('opens research on click while retaining a single front, with no flip interaction', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithProviders(
      <GameCard data={hydrate(companyCard.id)} onOpen={onOpen} />,
    );
    const front = screen.getByTestId('collectible-card-front');
    await user.click(screen.getByRole('button', { name: /GraceWear Global/ }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.getAllByTestId('collectible-card-front')).toEqual([front]);
    expect(front).toBeVisible();
    expect(screen.queryByTestId('collectible-card-back')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /flip|turn card|show back/i }),
    ).not.toBeInTheDocument();
  });

  it('does not treat the generic placeholder theme as a company brand', () => {
    const cwc = hydrate(companyCard.id);
    renderWithProviders(
      <GameCard
        data={{
          ...cwc,
          company: {
            ...cwc.company!,
            brandTheme: {
              primary: '#4f46e5',
              secondary: '#a5b4fc',
              accent: '#f59e0b',
              text: '#0f172a',
              background: '#ffffff',
              fontFamily: null,
              source: 'default',
            },
          },
        }}
      />,
    );
    expect(screen.getByTestId('collectible-card-front')).not.toHaveStyle('--card-accent: #4f46e5');
  });
  it('does not pass off a model-guessed palette as the company brand', () => {
    const cwc = hydrate(companyCard.id);
    renderWithProviders(
      <GameCard
        data={{
          ...cwc,
          company: {
            ...cwc.company!,
            brandTheme: { ...cwc.company!.brandTheme!, source: 'llm' },
          },
        }}
      />,
    );
    expect(screen.getByTestId('collectible-card-front')).not.toHaveStyle('--card-accent: #111827');
  });

  it('keeps save and share controls outside the card-opening button', async () => {
    const onOpen = vi.fn();
    const onShare = vi.fn();
    const { user } = renderWithProviders(
      <GameCard data={hydrate(companyCard.id)} onOpen={onOpen} onShare={onShare} />,
    );
    const inspect = screen.getByRole('button', { name: /GraceWear Global/ });
    expect(inspect.querySelector('button')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Share card' }));
    expect(onShare).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows a sourced-risk indicator on a Vice card', () => {
    renderWithProviders(<GameCard data={hydrate(viceCard.id)} />);
    expect(screen.getByText(/risk finding/i)).toBeInTheDocument();
    expect(
      screen.getByTestId('collectible-card-front').querySelector('.collectible__metrics'),
    ).toBeNull();
  });

  it('renders a non-company Barrier card with its title, no metrics', () => {
    const cwc = hydrate(barrierCard.id);
    renderWithProviders(<GameCard data={cwc} />);
    expect(screen.getByText(cwc.card.title!)).toBeInTheDocument();
    expect(screen.queryByText('ARR')).not.toBeInTheDocument();
  });

  it.each(CARD_TYPES.filter(isSignalCardType))(
    'never lends associated company facts to a %s finding',
    (cardType) => {
      const cwc = sourcedCompany();
      renderWithProviders(
        <GameCard
          data={{
            ...cwc,
            card: {
              ...cwc.card,
              cardType,
              title: 'Synthetic finding headline',
              citations: [
                { title: 'Synthetic finding source', url: 'https://fixtures.invalid/finding' },
              ],
            },
          }}
        />,
      );
      const front = screen.getByTestId('collectible-card-front');
      expect(within(front).getByText('Synthetic finding headline')).toBeVisible();
      expect(front.querySelector('.collectible__metrics')).toBeNull();
      expect(within(front).queryByText(/ARR|Market Cap|\$6\.2B|\$120B|T8\b/)).toBeNull();
      expect(within(front).getByText('1 source link')).toBeVisible();
    },
  );
});
