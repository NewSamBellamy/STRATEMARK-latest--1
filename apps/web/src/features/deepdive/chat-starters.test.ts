import { describe, expect, it } from 'vitest';
import type { ResearchScope } from '@mi/contracts';
import { getConversationStarters } from './chat-starters';

describe('getConversationStarters', () => {
  it('keeps multi-card research focused on comparison', () => {
    const scope: ResearchScope = {
      kind: 'cards',
      deckId: 'deck_1',
      cardIds: ['card_1', 'card_2'],
    };

    expect(getConversationStarters(scope)[0]).toMatch(/compare/i);
  });

  it('asks evidence and falsification questions for a single market insight', () => {
    const scope: ResearchScope = {
      kind: 'cards',
      deckId: 'deck_1',
      cardIds: ['insight_1'],
      cardType: 'insight',
      subject: 'Inference pricing is falling',
    };

    expect(getConversationStarters(scope)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/evidence/i),
        expect.stringMatching(/weaken|misleading|reject/i),
      ]),
    );
  });

  it('asks about the mechanism and change signals for a single barrier', () => {
    const scope: ResearchScope = {
      kind: 'cards',
      deckId: 'deck_1',
      cardIds: ['barrier_1'],
      cardType: 'barrier',
      subject: 'Compute access',
    };

    expect(getConversationStarters(scope)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/barrier/i),
        expect.stringMatching(/overcome|weaken|changing/i),
      ]),
    );
  });

  it('does not mistake a single company card for a comparison set', () => {
    const scope: ResearchScope = {
      kind: 'cards',
      deckId: 'deck_1',
      cardIds: ['company_1'],
      cardType: 'company',
      subject: 'Example Co',
    };

    expect(getConversationStarters(scope)[0]).toContain('Example Co');
    expect(getConversationStarters(scope)[0]).not.toMatch(/compare/i);
  });
});
