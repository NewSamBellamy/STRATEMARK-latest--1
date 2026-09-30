import { describe, expect, it } from 'vitest';
import { researchScopeSchema } from './schemas';

describe('researchScopeSchema', () => {
  it('preserves an optional card type for scoped card research', () => {
    const scope = {
      kind: 'cards',
      deckId: 'deck_1',
      cardIds: ['insight_1'],
      cardType: 'insight',
    };

    expect(researchScopeSchema.parse(scope)).toEqual(scope);
  });

  it('continues accepting persisted scopes written before card types were included', () => {
    const scope = { kind: 'cards', deckId: 'deck_1', cardIds: ['card_1'] };

    expect(researchScopeSchema.parse(scope)).toEqual(scope);
  });
});
