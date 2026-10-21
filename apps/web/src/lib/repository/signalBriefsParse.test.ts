import { describe, expect, it } from 'vitest';
import { migrateSnapshot } from '@mi/research';
import { parseResearchSnapshot } from './browserResearchStore';

const brief = (cardId: string) => ({
  cardId, cardType: 'vice', builtAt: '2026-10-01T00:00:00.000Z', lead: 'Lead.',
  points: [{ text: 'A sourced point.', sources: [{ title: 'News', url: 'https://news.example/a' }] }],
  sources: [{ title: 'News', url: 'https://news.example/a' }], cost: { estUsd: null, calls: null, searches: null },
});

describe('signal briefs in a loaded workspace', () => {
  it('a workspace without the field loads, and bad briefs are dropped without refusing the workspace', () => {
    const base = migrateSnapshot(null).snapshot;
    expect(parseResearchSnapshot(JSON.stringify(base)).signalBriefs).toBeUndefined();
    const hostile = `{"card_a": ${JSON.stringify(brief('card_a'))}, "card_b": {"cardId": 7}, "__proto__": ${JSON.stringify(brief('__proto__'))}}`;
    const loaded = parseResearchSnapshot(`${JSON.stringify(base).slice(0, -1)},"signalBriefs":${hostile}}`);
    expect(Object.keys(loaded.signalBriefs ?? {})).toEqual(['card_a']);
    expect(parseResearchSnapshot(JSON.stringify({ ...base, signalBriefs: 'nope' })).signalBriefs).toEqual({});
  });
});
