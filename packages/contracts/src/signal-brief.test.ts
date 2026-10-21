import { describe, expect, it } from 'vitest';
import { researchThreadSchema, signalBriefPointSchema, signalBriefSchema } from './schemas';

const source = { title: 'Reuters', url: 'https://www.reuters.com/a' };
const brief = {
  cardId: 'crd_1',
  cardType: 'vice',
  builtAt: '2026-10-20T10:00:00.000Z',
  lead: 'A regulator fined the company in 2024.',
  points: [{ text: 'The fine was announced in March 2024.', sources: [source] }],
  sources: [source],
  cost: { estUsd: 0.05, calls: 2, searches: 1 },
};

describe('a signal card brief', () => {
  it('round-trips, and a card type the app does not have does not parse', () => {
    expect(signalBriefSchema.parse(brief)).toEqual(brief);
    expect(signalBriefSchema.safeParse({ ...brief, cardType: 'poem' }).success).toBe(false);
  });

  it('never holds a point without a source, an empty point, or more than eight points', () => {
    expect(signalBriefPointSchema.safeParse({ text: 'A claim.', sources: [] }).success).toBe(false);
    expect(signalBriefPointSchema.safeParse({ text: '', sources: [source] }).success).toBe(false);
    const nine = Array.from({ length: 9 }, (_, i) => ({ text: `Point ${i}.`, sources: [source] }));
    expect(signalBriefSchema.safeParse({ ...brief, points: nine }).success).toBe(false);
  });

  it('keeps an unknown cost as null, never zero', () => {
    const unknown = signalBriefSchema.parse({ ...brief, cost: { estUsd: null, calls: null, searches: null } });
    expect(unknown.cost).toEqual({ estUsd: null, calls: null, searches: null });
    expect(signalBriefSchema.safeParse({ ...brief, cost: { estUsd: Number.POSITIVE_INFINITY, calls: 1, searches: 1 } }).success).toBe(false);
  });
});

describe('a conversation message', () => {
  const thread = (origin?: unknown) => ({
    id: 'thr_1',
    scope: { kind: 'cards', deckId: 'deck_1', cardIds: ['crd_1'] },
    title: 'About the fine',
    messages: [{ id: 'm1', role: 'assistant', text: 'It was announced in March.', citations: [source], at: '2026-10-20T10:00:00.000Z', ...(origin === undefined ? {} : { origin }) }],
    reportId: null,
    createdAt: '2026-10-20T10:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
  });

  it('may say whether it came from research on file or a fresh search, and older messages without it still parse', () => {
    expect(researchThreadSchema.parse(thread('memory')).messages[0]!.origin).toBe('memory');
    expect(researchThreadSchema.parse(thread('fresh')).messages[0]!.origin).toBe('fresh');
    expect(researchThreadSchema.parse(thread()).messages[0]!.origin).toBeUndefined();
    expect(researchThreadSchema.safeParse(thread('guess')).success).toBe(false);
  });
});
