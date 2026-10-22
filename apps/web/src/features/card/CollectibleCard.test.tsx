import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { clampForChrome } from '@/lib/brand';
import { CollectibleCard } from './CollectibleCard';

vi.mock('./Logo', () => ({
  Logo: ({ onPalette }: { onPalette?: (colors: string[]) => void }) => (
    <>
      <button type="button" onClick={() => onPalette?.(['#cf5b31'])}>
        resolve logo color
      </button>
      <button type="button" onClick={() => onPalette?.(['#0064a0', '#e31837', '#2a9d4b'])}>
        resolve three logo colors
      </button>
    </>
  ),
}));

const data = buildDataset();
const companyCard = data.cards.find(
  (card) => card.cardType === 'company' && card.companyId === 'cmp_gracewear-global',
)!;
const hydrated = {
  card: companyCard,
  company: data.companies.find((company) => company.id === companyCard.companyId)!,
  metrics: data.metrics.filter((metric) => metric.companyId === companyCard.companyId),
  viceClaims: [],
};

/** A company with no researched brand theme: only its logo can colour the frame. */
const unthemed = { ...hydrated, company: { ...hydrated.company, brandTheme: null } };
const themed = (primary: string, secondary: string) => ({
  ...hydrated,
  company: { ...hydrated.company, brandTheme: { primary, secondary, accent: '#f59e0b', text: '#111111', background: '#ffffff', fontFamily: null, source: 'scraped' as const } },
});

describe('CollectibleCard brand chrome', () => {
  it('uses neutral chrome when no verified brand color is available', () => {
    renderWithProviders(
      <CollectibleCard
        data={{
          ...hydrated,
          company: {
            ...hydrated.company,
            brandTheme: hydrated.company.brandTheme
              ? { ...hydrated.company.brandTheme, source: 'llm' }
              : null,
          },
        }}
      />,
    );

    expect(screen.getByTestId('collectible-card-front')).toHaveStyle('--card-accent: #46524e');
  });

  it('colors the card from the logo that actually rendered', async () => {
    const { user } = renderWithProviders(<CollectibleCard data={hydrated} />);

    await user.click(screen.getByText('resolve logo color'));

    // The shared brand engine keeps the hue but tempers it for readable card chrome.
    expect(screen.getByTestId('collectible-card-front')).toHaveStyle('--card-accent: #d6724e');
  });

  it('frames the card in the colours of its own logo: two-tone, with the third as the inner stripe', async () => {
    const { user } = renderWithProviders(<CollectibleCard data={unthemed} />);
    const front = screen.getByTestId('collectible-card-front');
    expect(front).not.toHaveClass('collectible--brand');

    await user.click(screen.getByText('resolve three logo colors'));

    expect(front).toHaveClass('collectible--brand');
    // Each colour is only tempered enough to read as chrome; the hues are the logo's.
    expect(front.style.getPropertyValue('--card-c1')).toBe(clampForChrome('#0064a0'));
    expect(front.style.getPropertyValue('--card-c2')).toBe(clampForChrome('#e31837'));
    expect(front.style.getPropertyValue('--card-c3')).toBe(clampForChrome('#2a9d4b'));
    expect(front).toHaveAttribute('data-brand-colors', '#0064a0 #e31837 #2a9d4b');
  });

  it('gives a one-colour logo a two-tone frame of that colour, and no stripe colour', async () => {
    const { user } = renderWithProviders(<CollectibleCard data={unthemed} />);
    await user.click(screen.getByText('resolve logo color'));
    const front = screen.getByTestId('collectible-card-front');
    expect(front).toHaveClass('collectible--brand');
    expect(front.style.getPropertyValue('--card-c2')).toMatch(/color-mix/);
    expect(front.style.getPropertyValue('--card-c3')).toBe('');
  });

  it('frames a card from its researched primary and secondary brand colours when the logo gives none', () => {
    renderWithProviders(<CollectibleCard data={themed('#0b5fff', '#ff8a00')} />);
    const front = screen.getByTestId('collectible-card-front');
    expect(front).toHaveClass('collectible--brand');
    expect(front.style.getPropertyValue('--card-c1')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(front.style.getPropertyValue('--card-c2')).toBe(clampForChrome('#ff8a00'));
    expect(front.style.getPropertyValue('--card-c2')).not.toBe(front.style.getPropertyValue('--card-c1'));
  });

  it('gives a one-colour logo the researched secondary brand colour as the second tone', async () => {
    const { user } = renderWithProviders(<CollectibleCard data={themed('#0b5fff', '#ff8a00')} />);
    await user.click(screen.getByText('resolve logo color'));
    const front = screen.getByTestId('collectible-card-front');
    expect(front.style.getPropertyValue('--card-c1')).toBe(clampForChrome('#cf5b31'));
    expect(front.style.getPropertyValue('--card-c2')).toBe(clampForChrome('#ff8a00'));
  });
});

describe('CollectibleCard illustrated defaults', () => {
  const signalCard = data.cards.find((card) => card.cardType === 'vice')!;

  it.each(['vice', 'barrier', 'culture', 'insight'] as const)(
    'keeps the %s artwork and finish consistent when research titles change',
    (cardType) => {
      const signal = {
        card: { ...signalCard, cardType, title: 'First research finding' },
        company: null,
        metrics: [],
        viceClaims: [],
      };
      const { rerender } = renderWithProviders(<CollectibleCard data={signal} />);
      const front = screen.getByTestId('collectible-card-front');
      const artwork = front.querySelector('.collectible__signal-art img');
      const source = artwork?.getAttribute('src');
      const finish = front.getAttribute('style');

      expect(artwork).not.toBeNull();
      rerender(
        <CollectibleCard
          data={{ ...signal, card: { ...signal.card, title: 'A completely different finding' } }}
        />,
      );

      expect(screen.getByText('A completely different finding')).toBeInTheDocument();
      expect(front.querySelector('.collectible__signal-art img')).toHaveAttribute('src', source);
      expect(front.getAttribute('style')).toBe(finish);
    },
  );

  it('does not repeat the signal type over the artwork', () => {
    renderWithProviders(<CollectibleCard data={{
      card: { ...signalCard, cardType: 'culture', title: 'Open source stewardship' },
      company: null,
      metrics: [],
      viceClaims: [],
    }} />);

    const front = screen.getByTestId('collectible-card-front');
    expect(front.querySelector('.collectible__art-label')).toBeNull();
    expect(front.querySelector('.collectible__eyebrow')).toHaveTextContent('Culture');
  });
});

describe('CollectibleCard ownership status', () => {
  const ownership = {
    status: 'acquired' as const, acquirer: 'PepsiCo', announcedOn: '2025-03-17', closedOn: '2025-05-27', price: null,
    citations: [{ url: 'https://www.pepsico.com/newsroom/press-releases/2025/poppi', title: 'PepsiCo' }], confidence: 'verified' as const,
  };

  it('adds the sourced ownership status to the eyebrow, beside the location', () => {
    renderWithProviders(<CollectibleCard data={{ ...hydrated, company: { ...hydrated.company, hqLocation: 'Austin, TX', ownership } }} />);
    expect(screen.getByTestId('collectible-card-front').querySelector('.collectible__eyebrow'))
      .toHaveTextContent('Austin, TX · Acquired by PepsiCo · 2025');
  });

  it('shows nothing for an unsourced or independent status', () => {
    renderWithProviders(<CollectibleCard data={{ ...hydrated, company: { ...hydrated.company, hqLocation: 'Austin, TX', ownership: { ...ownership, citations: [] } } }} />);
    expect(screen.getByTestId('collectible-card-front').querySelector('.collectible__eyebrow')).toHaveTextContent(/^Austin, TX$/);
  });
});
