import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import { renderWithProviders } from '@/test/test-utils';
import { CollectibleCard } from './CollectibleCard';

const dataset = buildDataset();
const card = dataset.cards.find((c) => c.cardType === 'company' && c.companyId === 'cmp_gracewear-global')!;
const data = {
  card,
  company: dataset.companies.find((c) => c.id === card.companyId)!,
  metrics: dataset.metrics.filter((m) => m.companyId === card.companyId),
  viceClaims: [],
};

describe('card frame skin', () => {
  it('is the dual-tone split unless the place the card lives asks for another', () => {
    renderWithProviders(<CollectibleCard data={data} />);
    expect(screen.getByTestId('collectible-card-front')).toHaveClass('collectible--skin-split');
  });

  it.each(['foil', 'embossed', 'acrylic'] as const)('takes the %s skin when asked', (skin) => {
    renderWithProviders(<CollectibleCard data={data} skin={skin} />);
    const front = screen.getByTestId('collectible-card-front');
    expect(front).toHaveClass(`collectible--skin-${skin}`);
    expect(front).not.toHaveClass('collectible--skin-split');
  });
});
