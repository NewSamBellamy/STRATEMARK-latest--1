import { describe, expect, it, vi } from 'vitest';
import { researchCompanyTeamOrg } from './company-team';
import { acceptMoves, mergeMoves, researchTeamMoves, withinTwelveMonths } from './team-moves';

const company = { id: 'cmp', name: 'Acme', websiteUrl: 'https://acme.com', oneLiner: '', logoUrl: null, hqLocation: null, brandTheme: null };
const now = new Date('2026-10-21T00:00:00Z');
const joinedUrl = 'https://news.example/acme-hires-ada';
const leftUrl = 'https://news.example/acme-cfo-leaves';
const joinedQuote = 'Ada Lovelace joined Acme as Chief Technology Officer in August 2026.';
const leftQuote = 'Acme said Grace Hopper, its Chief Financial Officer, departed the company in June 2026.';
const notes = `${joinedQuote} ${leftQuote}`;
const citations = [{ title: 'Hire', url: joinedUrl }, { title: 'Exit', url: leftUrl }];
const joined = { name: 'Ada Lovelace', role: 'Chief Technology Officer', group: 'exec', kind: 'joined', date: '2026-08', sourceUrl: joinedUrl, quote: joinedQuote };
const left = { name: 'Grace Hopper', role: 'Chief Financial Officer', group: 'exec', kind: 'departed', date: '2026-06', sourceUrl: leftUrl, quote: leftQuote };

describe('sourced team moves', () => {
  it('accepts a move with a returned URL, exact quote and a date in the last 12 months', () => {
    const [node] = acceptMoves(company, [joined], notes, citations, now);
    expect(node).toMatchObject({ name: 'Ada Lovelace', sourceUrl: joinedUrl, move: { kind: 'joined', date: '2026-08', sourceUrl: joinedUrl, supportingQuote: joinedQuote } });
  });

  it('rejects a move without a URL, with a URL the search did not return, or with a bad URL', () => {
    expect(acceptMoves(company, [{ ...joined, sourceUrl: '' }], notes, citations, now)).toEqual([]);
    expect(acceptMoves(company, [{ ...joined, sourceUrl: 'https://invented.example/x' }], notes, citations, now)).toEqual([]);
    expect(acceptMoves(company, [{ ...joined, sourceUrl: 'not a url' }], notes, [{ title: 'x', url: 'not a url' }], now)).toEqual([]);
  });

  it('rejects an unquoted, misquoted, wrong-company, wrong-kind, undated or out-of-window move', () => {
    expect(acceptMoves(company, [{ ...joined, quote: 'Ada Lovelace joined Acme as CTO last year, reports said.' }], notes, citations, now)).toEqual([]);
    expect(acceptMoves(company, [{ ...joined, kind: 'teleported' }], notes, citations, now)).toEqual([]);
    expect(acceptMoves(company, [{ ...joined, date: '' }], notes, citations, now)).toEqual([]);
    expect(acceptMoves(company, [{ ...joined, date: '2024-08' }], notes, citations, now)).toEqual([]);
    expect(acceptMoves(company, [{ ...joined, date: '2027-01' }], notes, citations, now)).toEqual([]);
    const other = 'Ada Lovelace joined Globex as Chief Technology Officer in August 2026.';
    expect(acceptMoves(company, [{ ...joined, quote: other }], other, citations, now)).toEqual([]);
  });

  it('checks the 12-month window', () => {
    expect(withinTwelveMonths('2025-10', now)).toBe(true);
    expect(withinTwelveMonths('2025-09-30', now)).toBe(false);
    expect(withinTwelveMonths('2026-11', now)).toBe(false);
    expect(withinTwelveMonths('last spring', now)).toBe(false);
  });

  it('a departed person is only ever a node carrying a departed move, including one already on the roster', () => {
    const [departed] = acceptMoves(company, [left], notes, citations, now);
    const added = mergeMoves([], [departed!]);
    expect(added).toHaveLength(1);
    expect(added[0]!.move?.kind).toBe('departed');
    const roster = [{ id: 'grace', name: 'Grace Hopper', role: 'Chief Financial Officer', group: 'exec' as const, parentId: null, bio: 'CFO.' }];
    const merged = mergeMoves(roster as never, [departed!]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.move).toMatchObject({ kind: 'departed', sourceUrl: leftUrl });
    expect(roster[0]).not.toHaveProperty('move');
  });

  it('runs one grounded and one structuring call, and keeps only the sourced moves', async () => {
    const ground = vi.fn().mockResolvedValue({ text: notes, citations, queries: [] });
    const structure = vi.fn().mockResolvedValue({ moves: [joined, { ...left, sourceUrl: '' }] });
    const result = await researchTeamMoves({ company, client: { ground, structure } as never, now });
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
    expect(result.moves.map(node => node.name)).toEqual(['Ada Lovelace']);
    expect(result.citations.map(citation => citation.url)).toEqual([joinedUrl]);
  });

  it('is off by default: the roster research makes no extra calls', async () => {
    const ground = vi.fn().mockResolvedValue({ text: '', citations: [], queries: [] });
    const structure = vi.fn();
    await researchCompanyTeamOrg({ company, client: { ground, structure } as never, originalAttempts: [] });
    expect(ground).toHaveBeenCalledTimes(1);
    expect(ground.mock.calls[0]![0]).not.toContain('last 12 months');
  });
});
