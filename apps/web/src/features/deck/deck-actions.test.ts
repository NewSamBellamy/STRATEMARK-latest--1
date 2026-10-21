import { describe, expect, it } from 'vitest';
import { deckActionPolicy } from './deck-actions';

describe('deck action policy', () => {
  it.each(['culture', 'vice', 'insight', 'barrier'] as const)(
    'keeps %s conversational while removing entity-only actions',
    (type) => {
      expect(deckActionPolicy(type)).toEqual({
        askLabel: 'Ask about findings',
        compare: false,
        briefing: false,
      });
    },
  );

  it.each(['company', 'infrastructure', 'distribution'] as const)(
    'keeps full entity actions on %s',
    (type) => {
      expect(deckActionPolicy(type)).toEqual({ askLabel: 'Ask', compare: true, briefing: true });
    },
  );
});
