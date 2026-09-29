import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany } from '@mi/contracts';
import { collapseSavedCards } from './SavedCardsPage';

describe('saved card collection', () => {
  it('keeps the better-evidenced copy when the same company is saved from multiple decks', () => {
    const data = buildDataset();
    const card = data.cards.find(
      (candidate) =>
        candidate.cardType === 'company' &&
        candidate.companyId != null &&
        data.metrics.some((metric) => metric.companyId === candidate.companyId),
    )!;
    const company = data.companies.find((candidate) => candidate.id === card.companyId)!;
    const metrics = data.metrics.filter((metric) => metric.companyId === company.id);
    const weak: CardWithCompany = {
      card: { ...card, id: 'saved_weak' },
      company,
      metrics: metrics.map((metric) => ({
        ...metric,
        confidence: 'estimated' as const,
        source: null,
        citations: [],
      })),
      viceClaims: [],
    };
    const strong: CardWithCompany = {
      ...weak,
      card: { ...card, id: 'saved_strong', deckId: 'another_deck' },
      metrics: metrics.map((metric) => ({
        ...metric,
        confidence: 'verified' as const,
        source: 'https://example.com/source',
        citations: [{ title: 'Primary source', url: 'https://example.com/source' }],
      })),
    };

    expect(collapseSavedCards([weak, strong])).toEqual([strong]);
  });
});
