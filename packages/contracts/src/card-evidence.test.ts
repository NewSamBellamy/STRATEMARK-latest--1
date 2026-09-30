import { describe, expect, it } from 'vitest';
import { cardSchema } from './schemas';

const baseCard = {
  id: 'card_signal',
  deckId: 'deck_1',
  companyId: null,
  cardType: 'insight',
  title: 'Inference pricing shift',
  summary: 'Providers are changing inference prices.',
  tier: null,
  tierReason: null,
  citations: [],
  keyPoints: [],
  createdAt: '2026-09-29T10:00:00.000Z',
};

describe('card evidence points', () => {
  it('preserves claim-linked citations and the explicitly reported period', () => {
    const evidencePoint = {
      text: 'Hosted inference prices fell during the second quarter.',
      citations: [
        {
          title: 'Provider pricing announcement',
          url: 'https://provider.example/pricing',
        },
      ],
      timeWindow: null,
    };

    expect(
      cardSchema.parse({ ...baseCard, evidencePoints: [evidencePoint] }).evidencePoints,
    ).toEqual([evidencePoint]);
  });

  it('keeps older cards readable without inventing per-claim provenance', () => {
    const parsed = cardSchema.parse({ ...baseCard, keyPoints: ['Unlinked historical note'] });

    expect(parsed.keyPoints).toEqual(['Unlinked historical note']);
    expect(parsed.evidencePoints).toBeUndefined();
  });
});
