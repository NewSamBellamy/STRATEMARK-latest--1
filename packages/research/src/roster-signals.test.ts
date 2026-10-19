import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Company } from '@mi/contracts';
import { companyNamed, researchRosterSignals, rosterSignalsPrompt } from './roster-signals';
import type { LlmClient, MarketPlan } from './types';

const plan: MarketPlan = { marketName: 'Meal Kit Delivery', vertical: 'Direct-to-consumer food', geography: null, notes: null, searchThemes: [] };
const company = (id: string, name: string, websiteUrl: string | null = null) => ({ id, name, oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl, brandTheme: null }) as Company;
const roster = [company('c1', 'HelloFresh SE', 'https://www.hellofresh.com'), company('c2', 'Blue Apron, Inc.'), company('c3', 'Gousto'), company('c4', 'Marley Spoon Group')];
const sources = [
  { title: 'reuters.com', url: 'https://www.reuters.com/hf-ruling' },
  { title: 'bbc.com', url: 'https://www.bbc.com/gousto-culture' },
  { title: 'ft.com', url: 'https://www.ft.com/blue-apron' },
];

/** A client whose search answered with `sources` and whose structuring step returned `out`. */
function client(out: unknown, citations = sources) {
  const structure = vi.fn(async (_prompt: string, schema: ZodType<unknown>) => schema.parse(out));
  const ground = vi.fn(async () => ({ text: 'notes', citations, queries: ['q'] }));
  return { llm: { ground, structure } as unknown as LlmClient, ground, structure };
}

describe('risk and culture cards for the companies a deck holds', () => {
  it('turns a sourced, company-named controversy into a vice card and a sourced culture note into a culture card', async () => {
    const { llm } = client({
      risks: [
        { company: 'HelloFresh SE', text: 'HelloFresh was fined by the UK advertising regulator in 2024 over misleading discount claims.', sourceIndex: 0 },
        { company: 'HelloFresh', text: 'HelloFresh settled a state attorney general inquiry into subscription cancellations in 2023.', sourceIndex: 0 },
      ],
      culture: [{ company: 'Gousto', note: 'Gousto describes a mission of making home cooking easier and has a published employee values charter.', sourceIndex: 1 }],
    });
    const { vice, culture } = await researchRosterSignals(llm, plan, 'dck_1', roster);
    expect(vice).toHaveLength(1);
    expect(vice[0]!.card).toMatchObject({ cardType: 'vice', companyId: 'c1', deckId: 'dck_1' });
    expect(vice[0]!.viceClaims.map((c) => c.claimText)).toEqual([
      'HelloFresh was fined by the UK advertising regulator in 2024 over misleading discount claims.',
      'HelloFresh settled a state attorney general inquiry into subscription cancellations in 2023.']);
    expect(vice[0]!.viceClaims[0]!.sourceUrl).toBe('https://www.reuters.com/hf-ruling');
    expect(vice[0]!.metrics).toEqual([]);
    expect(culture).toHaveLength(1);
    expect(culture[0]!.card).toMatchObject({ cardType: 'culture', companyId: 'c3' });
    expect(culture[0]!.card.citations.map((c) => c.url)).toEqual(['https://www.bbc.com/gousto-culture']);
  });

  it('never attributes on a guess: unknown or ambiguous company, a sentence that does not name it, one that names a rival, no source', async () => {
    const twin = [...roster, company('c5', 'Gousto Limited')];
    const { llm } = client({
      risks: [
        { company: 'Some Other Brand', text: 'Some Other Brand lost a major lawsuit over recipe labelling in 2024.', sourceIndex: 0 },
        { company: 'Marley Spoon Group', text: 'The company was criticised by a regulator over delivery delays last winter.', sourceIndex: 0 },
        { company: 'Marley Spoon Group', text: 'Marley Spoon Group, like Blue Apron, was named in a recall of contaminated produce in 2022.', sourceIndex: 0 },
        { company: 'Blue Apron, Inc.', text: 'Blue Apron settled a wage-and-hour class action brought by warehouse staff in 2021.', sourceIndex: null },
        { company: 'Blue Apron, Inc.', text: 'Blue Apron settled a wage-and-hour class action brought by warehouse staff in 2021.', sourceIndex: 9 },
        { company: 'Gousto', text: 'Gousto was fined over misleading discount claims in 2024.', sourceIndex: 0 },
      ],
      culture: [{ company: 'Marley Spoon Group', note: 'Short.', sourceIndex: 1 }],
    });
    const out = await researchRosterSignals(llm, plan, 'dck_1', twin);
    expect(out.vice).toEqual([]);
    expect(out.culture).toEqual([]);
  });

  it('skips a company that already has the card, and asks only for the kinds a deck is missing', async () => {
    const { llm, ground } = client({
      risks: [{ company: 'Gousto', text: 'Gousto was fined by the advertising regulator over delivery claims in 2022.', sourceIndex: 1 }],
      culture: [{ company: 'Gousto', note: 'Gousto publishes its values and runs an employee-owned share scheme according to its careers page.', sourceIndex: 1 }],
    });
    const out = await researchRosterSignals(llm, plan, 'dck_1', roster, { want: { vice: false, culture: true }, haveVice: new Set(['c3']) });
    expect(out.vice).toEqual([]);
    expect(out.culture).toHaveLength(1);
    expect(String((ground.mock.calls as unknown as string[][])[0]![0])).not.toMatch(/RISKS/);
    const none = await researchRosterSignals(llm, plan, 'dck_1', roster, { want: { vice: true, culture: true }, haveVice: new Set(['c3']), haveCulture: new Set(['c3']) });
    expect(none).toEqual({ vice: [], culture: [] });
    expect(await researchRosterSignals(llm, plan, 'dck_1', roster, { want: { vice: false, culture: false } })).toEqual({ vice: [], culture: [] });
    expect(await researchRosterSignals(llm, plan, 'dck_1', [])).toEqual({ vice: [], culture: [] });
  });

  it('cuts a long culture note at a sentence end and drops one that never ends in time', async () => {
    const long = `Gousto states a mission of making home cooking easier for everyone. ${'It also lists values on its careers page. '.repeat(12)}`;
    const { llm } = client({ culture: [{ company: 'Gousto', note: long, sourceIndex: 1 }, { company: 'Marley Spoon Group', note: `Marley Spoon Group ${'x'.repeat(400)}`, sourceIndex: 1 }] });
    const out = await researchRosterSignals(llm, plan, 'dck_1', roster);
    expect(out.culture).toHaveLength(1);
    expect(out.culture[0]!.card.summary!.length).toBeLessThanOrEqual(320);
    expect(out.culture[0]!.card.summary).toMatch(/[.!?]$/);
  });

  it('names the companies and the kinds it wants in the question', () => {
    const both = rosterSignalsPrompt(plan, roster, { vice: true, culture: true });
    expect(both).toContain('"HelloFresh SE"');
    expect(both).toMatch(/RISKS/);
    expect(both).toMatch(/CULTURE/);
    expect(rosterSignalsPrompt(plan, roster, { vice: false, culture: true })).not.toMatch(/RISKS/);
    expect(rosterSignalsPrompt(plan, Array.from({ length: 40 }, (_, i) => company(`x${i}`, `Brand ${i}`)), { vice: true, culture: true })).not.toContain('Brand 25');
  });

  it('reads a name the way the deck spells it', () => {
    expect(companyNamed('HelloFresh', roster)?.id).toBe('c1');
    expect(companyNamed('Blue Apron', roster)?.id).toBe('c2');
    expect(companyNamed('Marley Spoon Group (Berlin)', roster)?.id).toBe('c4');
    expect(companyNamed('Unknown Co', roster)).toBeNull();
    expect(companyNamed('', roster)).toBeNull();
  });
});
