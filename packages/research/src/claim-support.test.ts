import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Company } from '@mi/contracts';
import { claimSupportCitations } from './claim-support';
import { researchRosterSignals } from './roster-signals';
import { researchMarketSignals } from './signal-agents';
import type { LlmClient, MarketPlan, ProviderGrounding } from './types';

const grounding = (supports: Array<[string, string]>): ProviderGrounding => ({
  provider: 'google-search', answerText: supports.map(([text]) => text).join(' '),
  supports: supports.map(([text, url], i) => ({ supportIndex: i, text, sources: [{ chunkIndex: i, url, title: new URL(url).hostname }] })),
});

const REGULATION = 'Pet insurance is regulated state by state under property and casualty rules, requiring separate filings and disclosures in every state.';
const CHURN = 'Monthly subscriber churn for meal kit operators averages roughly ten percent, which drives very high acquisition costs.';
const g = grounding([[REGULATION, 'https://www.naic.org/reg'], [CHURN, 'https://www.ft.com/churn'], ['Short fragment here.', 'https://example.org/x']]);

describe('sources from the search engine\'s own attribution', () => {
  it('gives a claim built from an answer sentence the sources the engine attached to that sentence', () => {
    const claim = 'Multi-State Regulatory Overhead. Pet insurance is regulated state by state under property and casualty rules. Separate filings and disclosures are required in every state.';
    expect(claimSupportCitations(claim, g).map((c) => c.url)).toEqual(['https://www.naic.org/reg']);
  });

  it('gives nothing to a claim no sentence backs, to a grounding with no supports, or to a claim with too few words in common', () => {
    expect(claimSupportCitations('Moats form when carriers lock in veterinary clinics through exclusive software integrations.', g)).toEqual([]);
    expect(claimSupportCitations('Regulated state by state.', g)).toEqual([]);
    expect(claimSupportCitations('anything at all about regulated pet insurance filings', undefined)).toEqual([]);
    expect(claimSupportCitations('anything at all about regulated pet insurance filings', { provider: 'google-search', answerText: '', supports: [] })).toEqual([]);
    // A short support fragment never backs a claim by chance.
    expect(claimSupportCitations('Short fragment here and more words about fragment', g)).toEqual([]);
  });

  it('keeps at most the best two supports', () => {
    const many = grounding([
      [REGULATION, 'https://a.example.com/1'], [`${REGULATION} Rules differ widely.`, 'https://b.example.com/2'], [`${REGULATION} Legal costs are high.`, 'https://c.example.com/3']]);
    const claim = `${REGULATION} Rules differ widely. Legal costs are high.`;
    expect(claimSupportCitations(claim, many).length).toBe(2);
    expect(claimSupportCitations(claim, many, 3).length).toBe(3);
  });
});

const plan: MarketPlan = { marketName: 'Pet Insurance', vertical: 'Insurance', geography: null, notes: null, searchThemes: [] };

/** A client whose structuring step names no source for any card, the way the live one often does. */
function unattributedClient(structured: unknown, grounded: ProviderGrounding | undefined) {
  return {
    ground: vi.fn(async () => ({ text: 'notes', citations: [], queries: [], ...(grounded ? { grounding: grounded } : {}) })),
    structure: vi.fn(async (_p: string, schema: ZodType<unknown>) => schema.parse(structured)),
  } as unknown as LlmClient;
}

describe('market and roster cards when the structuring step names no source', () => {
  it('a barrier or insight takes the source the engine attached to its sentence, and one nothing backs is still dropped', async () => {
    const structured = {
      barriers: [
        { title: 'Multi-state regulatory overhead', summary: 'Pet insurance is regulated state by state under property and casualty rules.', sourceIndex: null,
          keyPoints: ['Separate filings and disclosures are required in every state.'] },
        { title: 'Exclusive clinic software lock-in', summary: 'Carriers tie veterinary clinics to exclusive integrations.', sourceIndex: null, keyPoints: ['Clinics rarely switch.'] },
      ],
      insights: [],
    };
    const cards = await researchMarketSignals(unattributedClient(structured, g), plan, 'dck_1', { minBarriers: 1, minInsights: 0 });
    expect(cards.map((c) => c.card.title)).toEqual(['Multi-state regulatory overhead']);
    expect(cards[0]!.card.citations.map((c) => c.url)).toEqual(['https://www.naic.org/reg']);
    expect(cards[0]!.card.cardType).toBe('barrier');
  });

  it('a controversy sentence takes the source the engine attached to it, and attribution still needs the company named', async () => {
    const company = (id: string, name: string) => ({ id, name, oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl: null, brandTheme: null }) as Company;
    const roster = [company('t', 'Trupanion'), company('l', 'Lemonade')];
    const fine = 'Trupanion was fined 100,000 dollars by the Washington insurance commissioner in 2019 over marketing practices.';
    const support = grounding([[fine, 'https://www.reuters.com/trupanion-fine']]);
    const llm = unattributedClient({
      risks: [
        { company: 'Trupanion', text: fine, sourceIndex: null },
        { company: 'Lemonade', text: 'Lemonade drew a regulator complaint over its use of artificial intelligence for claims in 2021.', sourceIndex: null },
      ],
      culture: [],
    }, support);
    const { vice } = await researchRosterSignals(llm, plan, 'dck_1', roster);
    expect(vice).toHaveLength(1);
    expect(vice[0]!.card.companyId).toBe('t');
    expect(vice[0]!.viceClaims[0]!.sourceUrl).toBe('https://www.reuters.com/trupanion-fine');
  });
});
