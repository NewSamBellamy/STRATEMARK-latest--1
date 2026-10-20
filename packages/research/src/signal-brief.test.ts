/**
 * The signal brief engine (signal-brief.ts): every point stands on a source the SEARCH attributed, numbers must be in the
 * answer, nothing is padded, and a build is at most one grounded call and one structure call.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Card, Company } from '@mi/contracts';
import { NOTHING_MORE_DOCUMENTED, numbersStated, researchSignalBrief, signalBriefOutSchema } from './signal-brief';
import type { LlmClient, ProviderGrounding } from './types';

const ACME: Company = { id: 'acme', name: 'Acme Robotics', oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl: 'https://acme.example', brandTheme: null };
const BETA: Company = { id: 'beta', name: 'Beta Capital', oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl: 'https://beta.example', brandTheme: null };
const NEWS = 'https://news.example/acme-fine';
const REG = 'https://regulator.example/acme-order';

const FINE = 'Acme Robotics was fined $2 million by a safety regulator in March 2024 after a warehouse robot injured a worker.';
const APPEAL = 'Acme Robotics said it would appeal the ruling and review its training program for operators.';
const LICENCE = 'Operators of warehouse robots must obtain a state licence before deploying machines near human workers.';

const card = (cardType: Card['cardType'], companyId: string | null): Card => ({
  id: `card_${cardType}`, deckId: 'deck', companyId, cardType, title: 'A finding', summary: null, tier: null, tierReason: null,
  citations: [], keyPoints: [], createdAt: '2026-10-01T00:00:00.000Z',
});

function fake(answer: string, supports: Array<{ text: string; url: string; title: string }>, raw: unknown) {
  const citations = [...new Map(supports.map((s) => [s.url, { title: s.title, url: s.url }])).values()];
  const grounding: ProviderGrounding = {
    provider: 'google-search', answerText: answer,
    supports: supports.map((s, i) => ({ supportIndex: i, text: s.text, sources: [{ chunkIndex: i, url: s.url, title: s.title }] })),
  };
  const ground = vi.fn(async () => ({ text: answer, queries: [], citations, grounding }));
  const structure = vi.fn(async (_p: string, schema: ZodType<unknown>) => schema.parse(raw));
  const client: LlmClient = { ground, structure: structure as unknown as LlmClient['structure'] };
  return { client, ground, structure };
}

const args = (cardType: Card['cardType'], company: Company | null, client: LlmClient) => ({
  card: card(cardType, company?.id ?? null), company, roster: [ACME, BETA], marketName: 'Robotics',
  finding: { headline: 'A finding', details: [] }, client,
});

describe('researchSignalBrief', () => {
  it('a vice point the search did not attribute to a source is dropped; the attributed one stays', async () => {
    const { client, ground, structure } = fake(`${FINE} ${APPEAL}`, [{ text: FINE, url: NEWS, title: 'News Example' }], {
      lead: 'Acme Robotics was fined over a worker injury.',
      points: [{ text: FINE, sourceIndex: 1 }, { text: APPEAL, sourceIndex: 1 }],
    });
    const brief = await researchSignalBrief(args('vice', ACME, client));
    expect(brief.points.map((p) => p.text)).toEqual([FINE]);
    expect(brief.points[0]!.sources.map((s) => s.url)).toEqual([NEWS]);
    expect(brief.sources.map((s) => s.url)).toEqual([NEWS]);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
  });

  it('a source number the model writes is not trusted when the search attached that source to something else', async () => {
    const { client } = fake(`${FINE} ${LICENCE}`, [{ text: FINE, url: NEWS, title: 'News Example' }, { text: LICENCE, url: REG, title: 'Regulator' }], {
      lead: '', points: [{ text: LICENCE, sourceIndex: 1 }],
    });
    const brief = await researchSignalBrief(args('barrier', null, client));
    // The sentence is backed by its own attribution (the regulator), never by the news source the model named.
    expect(brief.points[0]!.sources.map((s) => s.url)).toEqual([REG]);
  });

  it('a point with a number the answer does not state is dropped', async () => {
    const wrong = FINE.replace('$2 million', '$9 million');
    const { client } = fake(FINE, [{ text: FINE, url: NEWS, title: 'News Example' }], {
      lead: '', points: [{ text: wrong, sourceIndex: 1 }, { text: FINE.replace('2024', '2019'), sourceIndex: 1 }],
    });
    const brief = await researchSignalBrief(args('vice', ACME, client));
    expect(brief.points).toEqual([]);
    expect(brief.lead).toBe(NOTHING_MORE_DOCUMENTED);
  });

  it('a barrier is sourced from the search with no company scope, and two points say the brief is thin', async () => {
    const { client } = fake(`${LICENCE} ${FINE}`, [{ text: LICENCE, url: REG, title: 'Regulator' }, { text: FINE, url: NEWS, title: 'News Example' }], {
      lead: LICENCE, points: [{ text: LICENCE, sourceIndex: 1 }, { text: FINE, sourceIndex: 2 }],
    });
    const brief = await researchSignalBrief(args('barrier', null, client));
    expect(brief.points).toHaveLength(2);
    expect(brief.lead).toMatch(/^Only 2 points are documented so far: /);
  });

  it('caps the points at eight and never pads', async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `Regulator number${String.fromCharCode(97 + i)} requires ${['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'][i]} licensing for operators of warehouse machines.`);
    const { client } = fake(lines.join(' '), lines.map((text, i) => ({ text, url: `https://src${i}.example/a`, title: `S${i}` })), {
      lead: '', points: lines.map((text) => ({ text, sourceIndex: null })),
    });
    const brief = await researchSignalBrief(args('insight', null, client));
    expect(brief.points.length).toBeLessThanOrEqual(8);
    expect(brief.points.length).toBeGreaterThan(0);
  });

  it('an empty brief is an honest result: no structure call is paid for when the search found nothing sourced', async () => {
    const ground = vi.fn(async () => ({ text: '', queries: [], citations: [] }));
    const structure = vi.fn();
    const client = { ground, structure } as unknown as LlmClient;
    const brief = await researchSignalBrief(args('insight', null, client));
    expect(brief.points).toEqual([]);
    expect(brief.lead).toBe(NOTHING_MORE_DOCUMENTED);
    expect(structure).not.toHaveBeenCalled();
  });

  it('records the cost as unknown, never zero, when the provider reports no usage', async () => {
    const { client } = fake(FINE, [{ text: FINE, url: NEWS, title: 'News Example' }], { lead: '', points: [{ text: FINE, sourceIndex: 1 }] });
    const brief = await researchSignalBrief(args('vice', ACME, client));
    expect(brief.cost).toEqual({ estUsd: null, calls: null, searches: null });
  });

  it('refuses an entity card, and a vice or culture card with no company, without calling the client', async () => {
    const { client, ground } = fake('x', [], { lead: '', points: [] });
    await expect(researchSignalBrief(args('company', ACME, client))).rejects.toThrow(/signal cards/);
    await expect(researchSignalBrief(args('infrastructure', ACME, client))).rejects.toThrow(/signal cards/);
    await expect(researchSignalBrief(args('culture', null, client))).rejects.toThrow(/no company/);
    expect(ground).not.toHaveBeenCalled();
  });

  it('a culture point about a rival company is not backed by a sentence about the rival', async () => {
    const rival = 'Beta Capital donated three hundred laptops to the local school district last spring.';
    const own = 'Acme Robotics donated three hundred laptops to the local school district last spring.';
    const { client } = fake(`${rival} ${own}`, [{ text: rival, url: 'https://beta-news.example/a', title: 'Beta News' }], {
      lead: '', points: [{ text: own, sourceIndex: 1 }],
    });
    const brief = await researchSignalBrief(args('culture', ACME, client));
    expect(brief.points).toEqual([]);
  });
});

describe('numbersStated', () => {
  it('needs the same figure and unit in the answer; plain text always passes', () => {
    expect(numbersStated('It was fined $2 million in March 2024.', FINE)).toBe(true);
    expect(numbersStated('It was fined $2 billion in March 2024.', FINE)).toBe(false);
    expect(numbersStated('It was fined in 2019.', FINE)).toBe(false);
    expect(numbersStated('The company changed course.', FINE)).toBe(true);
  });
});

describe('signalBriefOutSchema', () => {
  it('tolerates a malformed model reply', () => {
    expect(signalBriefOutSchema.parse({ lead: 3, points: ['x', { text: 'ok', sourceIndex: 'a' }, null] })).toEqual({ lead: '', points: [{ text: 'ok', sourceIndex: null }] });
  });
});
