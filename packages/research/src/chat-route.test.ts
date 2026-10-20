import { describe, expect, it } from 'vitest';
import { fitPassages, passageIsRelevant, resolveMemoryAnswer, routeChat, type StoredPassage } from './chat-route';

const two = [{}, {}];
const base = { question: 'How much has Acme raised?', hasFreshFlag: false, storedPassages: two, isGreeting: false };

describe('routeChat', () => {
  it('answers a greeting without searching, whatever is stored', () => {
    expect(routeChat({ ...base, question: 'hey', isGreeting: true })).toBe('greeting');
    expect(routeChat({ ...base, question: 'hey', isGreeting: true, storedPassages: [], hasFreshFlag: true })).toBe('greeting');
  });
  it('goes fresh when the question asks for something recent', () => {
    for (const q of ['latest news on Acme', 'What happened today?', 'anything this week', 'check again', 'what is it doing right now', 'did they just announce something']) {
      expect(routeChat({ ...base, question: q })).toBe('fresh');
    }
  });
  it('goes fresh when asked to search again, or when fewer than two passages were found', () => {
    expect(routeChat({ ...base, hasFreshFlag: true })).toBe('fresh');
    expect(routeChat({ ...base, storedPassages: [{}] })).toBe('fresh');
    expect(routeChat({ ...base, storedPassages: [] })).toBe('fresh');
  });
  it('answers from memory otherwise', () => {
    expect(routeChat(base)).toBe('memory');
    expect(routeChat({ ...base, storedPassages: 3 })).toBe('memory');
  });
});

const P: StoredPassage[] = [
  { id: 'A1', label: 'Acme, funding', text: 'Acme raised $40M in a Series B in 2025.', citations: [{ url: 'https://stored.example/a1', title: 'One' }] },
  { id: 'A2', label: 'Acme, team', text: 'Acme has 120 employees.', citations: [{ url: 'https://stored.example/a2', title: 'Two' }] },
];

describe('resolveMemoryAnswer', () => {
  it('cites only the stored passages it names, and never a URL the model wrote', () => {
    const out = resolveMemoryAnswer({ answerable: true, answer: 'Acme raised $40M ([x](https://evil.example/x)) see https://evil.example/y.', passageIds: ['A1'] }, P)!;
    expect(out.citations.map((c) => c.url)).toEqual(['https://stored.example/a1']);
    expect(out.text).not.toContain('evil.example');
    expect(out.text).toContain('$40M');
  });
  it('ignores an id the model made up', () => {
    expect(resolveMemoryAnswer({ answerable: true, answer: 'Acme raised $40M.', passageIds: ['Z9'] }, P)).toBeNull();
  });
  it('removes a figure the named passages do not state', () => {
    const out = resolveMemoryAnswer({ answerable: true, answer: 'Acme raised $40M in 2025. Its revenue is $900M.', passageIds: ['A1'] }, P)!;
    expect(out.text).toContain('$40M');
    expect(out.text).not.toContain('$900M');
    expect(out.removed).toBe(1);
  });
  it('does not let a figure from an unnamed passage through', () => {
    const out = resolveMemoryAnswer({ answerable: true, answer: 'Acme raised $40M. It has 120 employees.', passageIds: ['A1'] }, P)!;
    expect(out.text).not.toContain('120');
  });
  it('is null when not answerable, empty, or nothing survives', () => {
    expect(resolveMemoryAnswer({ answerable: false, answer: 'x', passageIds: ['A1'] }, P)).toBeNull();
    expect(resolveMemoryAnswer({ answerable: true, answer: '', passageIds: ['A1'] }, P)).toBeNull();
    expect(resolveMemoryAnswer({ answerable: true, answer: 'Revenue is $900M.', passageIds: ['A1'] }, P)).toBeNull();
    expect(resolveMemoryAnswer(undefined, P)).toBeNull();
  });
});

describe('fitPassages and relevance', () => {
  it('stays within the character budget', () => {
    const big = Array.from({ length: 10 }, (_, i): StoredPassage => ({ id: `A${i}`, label: 'l', text: 'x'.repeat(2000), citations: [] }));
    const { block, used } = fitPassages(big, 6000);
    expect(block.length).toBeLessThanOrEqual(6100);
    expect(used.length).toBeLessThan(10);
  });
  it('matches a passage that shares a word with the question', () => {
    expect(passageIsRelevant('Acme funding?', P[0]!)).toBe(true);
    expect(passageIsRelevant('weather in Paris', P[0]!)).toBe(false);
  });
});
