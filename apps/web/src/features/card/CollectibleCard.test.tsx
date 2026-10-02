import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { CollectibleCard } from './CollectibleCard';

vi.mock('./Logo', () => ({
  Logo: ({ onColor }: { onColor?: (hex: string) => void }) => (
    <button type="button" onClick={() => onColor?.('#cf5b31')}>
      resolve logo color
    </button>
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
});
