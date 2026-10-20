/**
 * Second red-team pass over the signal cards (the fixes of the first pass had holes). Each case is an input an
 * independent reviewer reproduced against the first fixes; every one must now be refused, and the honest version of the
 * same input must still pass.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Company } from '@mi/contracts';
import { claimSupportCitations, sourceBacksClaim } from './claim-support';
import { canon, companyAliases } from './company-aliases';
import { aboutCompany, researchRosterSignals } from './roster-signals';
import { researchMarketSignals } from './signal-agents';
import type { LlmClient, MarketPlan, ProviderGrounding } from './types';

const plan: MarketPlan = { marketName: 'Test Market', vertical: 'Software', geography: null, notes: null, searchThemes: [] };
const company = (id: string, name: string, websiteUrl: string | null = null) => ({ id, name, oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl, brandTheme: null }) as Company;
const grounding = (supports: Array<[string, string]>): ProviderGrounding => ({
  provider: 'google-search', answerText: supports.map(([text]) => text).join(' '),
  supports: supports.map(([text, url], i) => ({ supportIndex: i, text, sources: [{ chunkIndex: i, url, title: new URL(url).hostname }] })),
});
function fake(out: unknown, opts: { citations?: Array<{ title: string; url: string }>; grounding?: ProviderGrounding } = {}) {
  const ground = vi.fn(async () => ({ text: 'notes', citations: opts.citations ?? [], queries: [], ...(opts.grounding ? { grounding: opts.grounding } : {}) }));
  const structure = vi.fn(async (_prompt: string, schema: ZodType<unknown>) => schema.parse(out));
  return { llm: { ground, structure } as unknown as LlmClient };
}
const REUTERS = 'https://www.reuters.com/acme-recall';
const acme = company('a', 'Acme Robotics', 'https://www.acme-robotics.com');
const beta = company('b', 'Beta Capital Group');
const viceFor = async (text: string, g: ProviderGrounding | undefined, sourceIndex: number | null = null, roster: Company[] = [acme, beta], name = 'Acme Robotics') => {
  const citations = g ? g.supports.flatMap((s) => s.sources.map((x) => ({ title: x.title, url: x.url }))) : [{ title: 'reuters.com', url: REUTERS }];
  const { llm } = fake({ risks: [{ company: name, text, sourceIndex }], culture: [] }, { citations, ...(g ? { grounding: g } : {}) });
  return (await researchRosterSignals(llm, plan, 'd', roster)).vice;
};
const FINED = 'Acme Robotics was fined by a safety regulator over a robot recall in 2024';
const recallSupport = grounding([[`${FINED}, the agency said.`, REUTERS]]);

describe('a risk is exactly what its source says: nothing added to a true sentence', () => {
  it('refuses a second sentence, a clause after a semicolon and an added conjunct riding on a real fine', async () => {
    expect(await viceFor(`${FINED}.`, recallSupport, 0)).toHaveLength(1); // the honest version
    expect(await viceFor(`${FINED}. Its chief executive was also arrested for securities fraud in 2025.`, recallSupport)).toEqual([]);
    expect(await viceFor(`${FINED}. Its chief executive was also arrested for securities fraud in 2025.`, recallSupport, 0)).toEqual([]);
    expect(await viceFor(`${FINED}; separately, its founder was convicted of tax fraud and sentenced to prison.`, recallSupport, 0)).toEqual([]);
    expect(await viceFor(`${FINED} and its chief executive was arrested for fraud.`, recallSupport)).toEqual([]);
  });

  it('files a risk on a source only when the search attributed a sentence to it: a named source alone is not enough', async () => {
    const invented = 'Acme Robotics was convicted of securities fraud and its chief executive jailed in 2025.';
    expect(await viceFor(invented, undefined, 0)).toEqual([]);
    expect(await viceFor(invented, { provider: 'google-search', answerText: '', supports: [] }, 0)).toEqual([]);
  });

  it('an award does not back a recall, and a deal does not back a fraud charge, though they share the product words', async () => {
    const award = grounding([['Acme Robotics won a 2024 safety award for its warehouse robot.', REUTERS]]);
    expect(await viceFor('Acme Robotics faced a safety recall of its warehouse robot in 2024.', award, 0)).toEqual([]);
    expect(await viceFor('Acme Robotics faced a safety recall of its warehouse robot in 2024.', award)).toEqual([]);
    const deal = grounding([['Acme Robotics strikes a 2024 deal for its Ohio warehouse robot, regulators approved.', REUTERS]]);
    expect(await viceFor('Acme Robotics was charged with fraud over its Ohio warehouse robot deal in 2024.', deal, 0)).toEqual([]);
  });

  it('a named source must back this claim, not another event at the same company', async () => {
    const breach = grounding([['Acme Robotics was fined for a 2023 data breach at its Ohio warehouse.', REUTERS]]);
    expect(await viceFor('Acme Robotics was fined for a 2024 safety violation at its Ohio warehouse.', breach, 0)).toEqual([]);
    expect(await viceFor('Acme Robotics was fined for a 2023 data breach at its Ohio warehouse.', breach, 0)).toHaveLength(1);
  });

  it('files a culture note on the sentences a source backs, not the ones carried along with them', async () => {
    const g = grounding([['Acme Robotics is a certified B Corporation according to its careers page.', 'https://www.reuters.com/acme-culture']]);
    const note = 'Acme Robotics is a certified B Corporation according to its careers page. Acme Robotics pays every employee at least $40 an hour and gives each a 25 percent equity grant.';
    const { llm } = fake({ risks: [], culture: [{ company: 'Acme Robotics', note, sourceIndex: null }] }, { citations: [{ title: 'reuters.com', url: 'https://www.reuters.com/acme-culture' }], grounding: g });
    const { culture } = await researchRosterSignals(llm, plan, 'd', [acme]);
    expect(culture).toHaveLength(1);
    expect(culture[0]!.card.summary).toBe('Acme Robotics is a certified B Corporation according to its careers page.');
  });
});

describe('who a sentence is about', () => {
  it('does not take the front of a longer name for the company: Check Point is not Check, Square Enix is not Square', () => {
    const check = company('c', 'Check');
    expect(aboutCompany('Check Point Software disclosed a customer data breach affecting its VPN products in 2024.', check, [check, company('g', 'Gamma Shop')])).toBe(false);
    const square = company('s', 'Square');
    expect(aboutCompany('Square Enix was fined over a loot box ruling in 2024 by regulators.', square, [square, company('b', 'Block')])).toBe(false);
    // The company itself, with a legal form or part of its own name after it, still counts.
    expect(aboutCompany('Check was fined by a regulator over a data breach in 2024.', check, [check])).toBe(true);
    expect(aboutCompany('Acme Robotics Inc. was fined by a regulator over a recall in 2024.', acme, [acme, beta])).toBe(true);
    expect(aboutCompany('Beta Capital Group was fined by a regulator over a recall in 2024.', beta, [acme, beta])).toBe(true);
  });

  it('files no card on a company when the answer names a longer proper noun that is not in the deck', async () => {
    const check = company('c', 'Check');
    const g = grounding([['Check Point Software disclosed a customer data breach affecting its VPN products in 2024.', REUTERS]]);
    expect(await viceFor('Check Point Software disclosed a customer data breach affecting its VPN products in 2024.', g, 0, [check, company('x', 'Gamma Shop')], 'Check')).toEqual([]);
    const { llm } = fake({ risks: [], culture: [{ company: 'Check', note: 'Check Point Software runs a values programme and a four day week according to its careers page.', sourceIndex: null }] }, {
      grounding: grounding([['Check Point Software runs a values programme and a four day week according to its careers page.', REUTERS]]), citations: [{ title: 'reuters.com', url: REUTERS }] });
    expect((await researchRosterSignals(llm, plan, 'd', [check, company('x', 'Gamma Shop')])).culture).toEqual([]);
  });

  it('sees a rival written without its apostrophe, and "and" for "&"', () => {
    const mc = company('m', "McDonald's");
    const wendys = company('w', "Wendy's");
    expect(aboutCompany("McDonald's and Wendys were fined by regulators over a joint food safety recall in 2024.", mc, [mc, wendys])).toBe(false);
    expect(aboutCompany("Wendys was fined by regulators over a food safety recall in 2024.", wendys, [mc, wendys])).toBe(true);
    const pg = company('p', 'Procter & Gamble');
    const ms = company('s', 'Marks & Spencer');
    expect(aboutCompany('Procter & Gamble and Marks and Spencer were fined by regulators over a joint recall in 2024.', pg, [pg, ms])).toBe(false);
    expect(aboutCompany('Procter and Gamble was fined by regulators over a product recall in 2024.', pg, [pg, ms])).toBe(true);
    // The shared alias folding is left alone (other matching builds its own phrases from it); the signal cards canonicalise.
    expect(companyAliases(canon("McDonald's"))).toContain('mcdonalds');
  });
});

describe('what a source may be', () => {
  it('is not the company’s own site even when no website is recorded for it, and not a private address', async () => {
    const nimbus = company('n', 'Nimbus Dynamics');
    const own = 'https://www.nimbusdynamics.com/press/statement';
    const g = grounding([['Nimbus Dynamics was fined by a safety regulator over a drone recall in 2024, the agency said.', own]]);
    expect(await viceFor('Nimbus Dynamics was fined by a safety regulator over a drone recall in 2024.', g, 0, [nimbus, beta], 'Nimbus Dynamics')).toEqual([]);
    for (const url of ['http://localhost/story', 'http://127.0.0.1/story', 'http://192.168.1.4/story', 'https://intranet/x']) {
      const bad = grounding([['Nimbus Dynamics was fined by a safety regulator over a drone recall in 2024, the agency said.', url]]);
      expect(await viceFor('Nimbus Dynamics was fined by a safety regulator over a drone recall in 2024.', bad, 0, [nimbus, beta], 'Nimbus Dynamics'), url).toEqual([]);
    }
  });
});

describe('market cards: a named source must back the card, in any script', () => {
  const claim = (title: string, summary: string, sourceIndex: number | null, keyPoints: string[] = []) => ({ title, summary, sourceIndex, sourceIndexes: [] as number[], keyPoints });
  function market(first: unknown, g: ProviderGrounding, citations: Array<{ title: string; url: string }>) {
    const ground = vi.fn(async () => ({ text: 'n', citations, queries: [], grounding: g }));
    const structure = vi.fn(async (_p: string, schema: ZodType<unknown>) => schema.parse(first));
    return { ground, structure } as unknown as LlmClient;
  }

  it('refuses a barrier whose named source is attached to an unrelated sentence that shares two words', async () => {
    const g = grounding([['Regulators in Texas approved a record number of insurance licences for coastal property owners.', 'https://example.org/insurance']]);
    const llm = market({ barriers: [claim('Cold chain capital intensity', 'Refrigerated logistics need heavy capital.', 0,
      ['Refrigerated trucks cost far more than dry vans.', 'Insurance premiums for perishable freight are high.'])], insights: [] }, g, [{ title: 'example.org', url: 'https://example.org/insurance' }]);
    expect(await researchMarketSignals(llm, plan, 'd', { minBarriers: 0, minInsights: 0 })).toEqual([]);
  });

  it('keeps a barrier written in Cyrillic when the search attributed its sentence to the named source', async () => {
    const sentence = 'Высокие барьеры входа связаны с регулированием лицензирования банковской деятельности';
    const g = grounding([[sentence, 'https://example.org/ru']]);
    const llm = market({ barriers: [claim('Высокие барьеры входа', sentence, 0)], insights: [] }, g, [{ title: 'example.org', url: 'https://example.org/ru' }]);
    const cards = await researchMarketSignals(llm, plan, 'd', { minBarriers: 0, minInsights: 0 });
    expect(cards.map((c) => c.card.title)).toEqual(['Высокие барьеры входа']);
  });
});

describe('claim support, scoped', () => {
  it('requires every event a risk states to be in the one sentence that backs it', () => {
    const scope = { about: (t: string) => /acme/i.test(t), ignore: new Set(['acme', 'robotics']), oneSentence: true, reads: /\b(?:fined?|recall|arrest\w*|fraud)\b/i };
    const g = grounding([[`${FINED}, the agency said.`, REUTERS]]);
    expect(claimSupportCitations(`${FINED}.`, g, 2, scope)).toHaveLength(1);
    expect(claimSupportCitations(`${FINED} and its chief executive was arrested for fraud.`, g, 2, scope)).toEqual([]);
    expect(sourceBacksClaim(REUTERS, `${FINED} and its chief executive was arrested for fraud.`, g, scope, true)).toBe(false);
    expect(sourceBacksClaim(REUTERS, `${FINED}.`, g, scope, true)).toBe(true);
  });
});
