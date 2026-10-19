/**
 * Found by an adversarial review of the signal cards: a risk or culture card about one company could be filed with a
 * source that is about another company, or about something else, or not about the company at all. Each case below is an
 * input that review reproduced; the card must now be refused (and the honest versions of the same input still pass).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Company } from '@mi/contracts';
import { claimSupportCitations, sourceBacksClaim } from './claim-support';
import { aboutCompany, companyNamed, researchRosterSignals } from './roster-signals';
import { deduplicatePreferSourced, researchMarketSignals } from './signal-agents';
import type { LlmClient, MarketPlan, ProviderGrounding } from './types';

const plan: MarketPlan = { marketName: 'Test Market', vertical: 'Software', geography: null, notes: null, searchThemes: [] };
const company = (id: string, name: string, websiteUrl: string | null = null) => ({ id, name, oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl, brandTheme: null }) as Company;
const grounding = (supports: Array<[string, string]>): ProviderGrounding => ({
  provider: 'google-search', answerText: supports.map(([text]) => text).join(' '),
  supports: supports.map(([text, url], i) => ({ supportIndex: i, text, sources: [{ chunkIndex: i, url, title: new URL(url).hostname }] })),
});
function fake(out: unknown, opts: { citations?: Array<{ title: string; url: string }>; grounding?: ProviderGrounding; text?: string } = {}) {
  const ground = vi.fn(async () => ({ text: opts.text ?? 'notes', citations: opts.citations ?? [], queries: [], ...(opts.grounding ? { grounding: opts.grounding } : {}) }));
  const structure = vi.fn(async (_prompt: string, schema: ZodType<unknown>) => schema.parse(out));
  return { llm: { ground, structure } as unknown as LlmClient, ground, structure };
}

const acme = company('a', 'Acme Robotics', 'https://www.acme-robotics.com');
const beta = company('b', 'Beta Capital Group');
const risk = (text: string, sourceIndex: number | null = null, name = 'Acme Robotics') => ({ risks: [{ company: name, text, sourceIndex }], culture: [] });

describe('a risk is backed only by sentences about that company, saying that thing', () => {
  const breach = 'Acme Robotics faced a data breach affecting 3 million customers in 2023.';

  it('files the card on the sentence the search attached to the claim, and shows that source', async () => {
    const g = grounding([['Acme Robotics faced a data breach affecting 3 million customers in 2023, regulators said.', 'https://www.reuters.com/acme-breach']]);
    const { vice } = await researchRosterSignals(fake(risk(breach), { grounding: g }).llm, plan, 'd', [acme, beta]);
    expect(vice).toHaveLength(1);
    expect(vice[0]!.viceClaims[0]!.sourceUrl).toBe('https://www.reuters.com/acme-breach');
  });

  it('refuses a source that is about a rival (a sentence about another company shares the words, not the subject)', async () => {
    const g = grounding([['Beta Capital faced a data breach affecting 3 million customers in 2023, regulators said.', 'https://www.reuters.com/beta-breach']]);
    expect((await researchRosterSignals(fake(risk(breach), { grounding: g }).llm, plan, 'd', [acme, beta])).vice).toEqual([]);
  });

  it('refuses a sentence about an award or a launch as the backing of a recall, though it shares the product words', async () => {
    const g = grounding([['Acme Robotics won a 2024 award for its new warehouse robot launch.', 'https://www.acme-news.example/award']]);
    const fined = 'Acme Robotics was fined over a warehouse robot recall in 2024.';
    expect((await researchRosterSignals(fake(risk(fined), { grounding: g }).llm, plan, 'd', [acme])).vice).toEqual([]);
  });

  it('refuses a source number the model named when the sentences that source is attached to are about something else', async () => {
    const invented = 'Acme Robotics was convicted of securities fraud and its chief executive jailed in 2025.';
    const g = grounding([['Acme Robotics builds warehouse robots and has 400 employees across two sites.', 'https://www.ft.com/unrelated-article']]);
    const llm = fake(risk(invented, 0), { grounding: g, citations: [{ title: 'ft.com', url: 'https://www.ft.com/unrelated-article' }] }).llm;
    expect((await researchRosterSignals(llm, plan, 'd', [acme])).vice).toEqual([]);
  });

  it('accepts a source number the model named when the sentences it is attached to are about this company and this controversy', async () => {
    const g = grounding([['Acme Robotics was fined by a safety regulator over a robot recall in 2024, the agency said.', 'https://www.reuters.com/acme-recall']]);
    const llm = fake(risk('Acme Robotics was fined by a safety regulator over a robot recall in 2024.', 0), { grounding: g, citations: [{ title: 'reuters.com', url: 'https://www.reuters.com/acme-recall' }] }).llm;
    expect((await researchRosterSignals(llm, plan, 'd', [acme])).vice).toHaveLength(1);
  });

  it('does not take a risk to a company from its own website, or a rival company\'s website', async () => {
    const own = fake(risk('Acme Robotics was fined by a safety regulator over a robot recall in 2024.', 0), { citations: [{ title: 'acme-robotics.com', url: 'https://www.acme-robotics.com/blog/our-year' }] }).llm;
    expect((await researchRosterSignals(own, plan, 'd', [acme])).vice).toEqual([]);
    const rivalSite = company('b', 'Beta Capital Group', 'https://www.betacapital.com');
    const viaRival = fake(risk('Acme Robotics was fined by a safety regulator over a robot recall in 2024.', 0), { citations: [{ title: 'betacapital.com', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA' }] }).llm;
    expect((await researchRosterSignals(viaRival, plan, 'd', [acme, rivalSite])).vice).toEqual([]);
  });

  it('does not count the same claim twice because of case or punctuation, and keeps different claims', async () => {
    const base = 'Acme Robotics was fined by a safety regulator over a robot recall in 2024';
    const out = {
      risks: [
        { company: 'Acme Robotics', text: `${base}.`, sourceIndex: 0 },
        { company: 'Acme Robotics', text: base, sourceIndex: 0 },
        { company: 'Acme Robotics', text: `${base.toUpperCase()}.`, sourceIndex: 0 },
        { company: 'Acme Robotics', text: 'Acme Robotics settled a class action lawsuit over unpaid overtime in 2023.', sourceIndex: 0 },
      ], culture: [],
    };
    const { vice } = await researchRosterSignals(fake(out, { citations: [{ title: 'bbc.com', url: 'https://www.bbc.com/a' }] }).llm, plan, 'd', [acme]);
    expect(vice[0]!.viceClaims).toHaveLength(2);
  });
});

describe('a name in the answer must be a deck company\'s own name, and the sentence about it must be about it', () => {
  it('does not take a longer name that merely contains a company\'s name for that company', () => {
    expect(companyNamed('Check Point Software', [company('c', 'Check'), company('x', 'Gamma Shop')])).toBeNull();
    expect(companyNamed('Merge Labs', [company('m', 'Merge'), company('n', 'Nova')])).toBeNull();
    expect(companyNamed('Block Party Inc', [company('b', 'Block'), company('s', 'Square')])).toBeNull();
    expect(companyNamed('Square Enix', [company('b', 'Block'), company('s', 'Square')])).toBeNull();
    expect(companyNamed('Apple Hospitality REIT', [company('a', 'Apple'), company('b', 'Beta')])).toBeNull();
    // Its own name, with or without a legal form or a product, is still found.
    expect(companyNamed('HelloFresh', [company('h', 'HelloFresh SE')])?.id).toBe('h');
    expect(companyNamed('Blue Apron', [company('b', 'Blue Apron, Inc.')])?.id).toBe('b');
    expect(companyNamed('Gusto', [company('g', 'Gusto (Gusto Pro)'), company('o', 'Oyster')])?.id).toBe('g');
  });

  it('does not file a Check Point breach on the company Check', async () => {
    const roster = [company('c', 'Check'), company('x', 'Gamma Shop')];
    const out = risk('Check Point Software disclosed a customer data breach affecting its VPN products in 2024.', 0, 'Check Point Software');
    expect((await researchRosterSignals(fake(out, { citations: [{ title: 'reuters.com', url: 'https://www.reuters.com/cp' }] }).llm, plan, 'd', roster)).vice).toEqual([]);
  });

  it('finds a rival in any case or form, and a company that is named only late in a sentence about someone else', () => {
    const roster = [acme, beta];
    for (const text of [
      'Acme Robotics and Beta Capital Group were fined by regulators over a joint recall in 2024.',
      'Acme Robotics and BETA CAPITAL GROUP were fined by regulators over a joint recall in 2024.',
      'Acme Robotics and beta capital group were fined by regulators over a joint recall in 2024.',
      'Acme Robotics and Beta-Capital Group were fined by regulators over a joint recall in 2024.',
      'Acme Robotics and Beta Capital were fined by regulators over a joint recall in 2024.',
    ]) expect(aboutCompany(text, acme, roster), text).toBe(false);
    expect(aboutCompany('Acme Robotics was fined by a safety regulator over a robot recall in 2024.', acme, roster)).toBe(true);
    expect(aboutCompany('Walmart was fined two million dollars over warehouse robots supplied by Acme Robotics in 2024.', acme, roster)).toBe(false);
  });

  it('keeps "Gusto Pro" apart from "Gusto" in both directions', () => {
    const gusto = company('g', 'Gusto');
    const pro = company('p', 'Gusto Pro');
    expect(aboutCompany('Gusto Pro was fined over a billing error in 2024.', gusto, [gusto, pro])).toBe(false);
    expect(aboutCompany('Gusto Pro was fined over a billing error in 2024.', pro, [gusto, pro])).toBe(true);
  });
});

describe('a culture note is cut at a real sentence end', () => {
  it('does not treat a decimal or "U.S." as the end of a sentence, so a long note keeps whole sentences', async () => {
    const note = 'Acme Robotics was never a certified B Corporation despite 2.5 years of marketing that said so. Acme Robotics runs an employee share scheme according to its careers page. '
      + 'It also lists values on its careers page and publishes a charter. '.repeat(6);
    const g = grounding([['Acme Robotics runs an employee share scheme according to its careers page.', 'https://www.reuters.com/acme-culture']]);
    const { culture } = await researchRosterSignals(fake({ risks: [], culture: [{ company: 'Acme Robotics', note, sourceIndex: null }] }, { grounding: g }).llm, plan, 'd', [acme, company('n', 'Nova Shop')]);
    expect(culture).toHaveLength(1);
    const summary = culture[0]!.card.summary ?? "";
    expect(summary.length).toBeLessThanOrEqual(320);
    expect(summary.startsWith('Acme Robotics was never a certified B Corporation despite 2.5 years of marketing that said so. Acme Robotics runs an employee share scheme according to its careers page.')).toBe(true);
    expect(summary.endsWith('charter.')).toBe(true);
  });

  it('does not cut after "U.S." or "Inc." either', async () => {
    const note = 'Acme Robotics, Inc. employs 400 people in the U.S. and publishes its pay bands on its careers page for every role. '
      + 'The company runs an employee share scheme according to its careers page and a yearly engagement survey. '
      + 'It also lists values on its careers page and publishes a charter, a code of conduct and a long list of benefits for staff.';
    const { culture } = await researchRosterSignals(fake({ risks: [], culture: [{ company: 'Acme Robotics', note, sourceIndex: null }] }, { grounding: grounding([['Acme Robotics employs 400 people in the U.S. and publishes its pay bands on its careers page for every role.', 'https://www.reuters.com/x']]) }).llm, plan, 'd', [acme, company('n', 'Nova Shop')]);
    expect(culture).toHaveLength(1);
    expect((culture[0]!.card.summary ?? "").startsWith('Acme Robotics, Inc. employs 400 people in the U.S. and publishes its pay bands on its careers page for every role.')).toBe(true);
    expect(culture[0]!.card.summary ?? "").not.toMatch(/(?:U\.S\.|Inc\.)$/);
  });
});

describe('claimSupportCitations and sourceBacksClaim, scoped', () => {
  const scope = { about: (t: string) => /acme/i.test(t), ignore: new Set(['acme', 'robotics']), oneSentence: true };
  it('needs real words, not just a year and a name, to match', () => {
    const g = grounding([['Acme Robotics reported results in 2024, 2023 and 2022 across several regions.', 'https://example.org/results']]);
    expect(claimSupportCitations('Acme Robotics faced a recall in 2024, 2023 and 2022.', g, 2, scope)).toEqual([]);
  });
  it('trusts a model-named source only when the sentences it is attached to are about the claim; unattached sources fail only a strict claim', () => {
    const g = grounding([['Acme Robotics faced a data breach affecting customers in 2023.', 'https://a.example/x']]);
    expect(sourceBacksClaim('https://a.example/x', 'Acme Robotics breach affecting customers', g, scope)).toBe(true);
    expect(sourceBacksClaim('https://a.example/x', 'Acme Robotics won an award for design', g, scope)).toBe(false);
    expect(sourceBacksClaim('https://unattached.example/y', 'Acme Robotics breach affecting customers', g, scope)).toBe(true);
    expect(sourceBacksClaim('https://unattached.example/y', 'Acme Robotics breach affecting customers', g, scope, true)).toBe(false);
    expect(sourceBacksClaim('https://a.example/x', 'anything at all', undefined, scope, true)).toBe(true);
  });
});

describe('market-level cards resolve each source number against the pass that wrote it', () => {
  const claim = (title: string, summary: string, sourceIndex: number | null) => ({ title, summary, sourceIndex, sourceIndexes: [] as number[], keyPoints: [] as string[] });
  function twoPass(first: unknown, second: unknown, firstSources: string[], secondSources: string[]) {
    let call = 0;
    const ground = vi.fn(async () => {
      call += 1;
      return { text: 'n', citations: (call === 1 ? firstSources : secondSources).map((url) => ({ title: new URL(url).hostname, url })), queries: [] };
    });
    let s = 0;
    const structure = vi.fn(async (_p: string, schema: ZodType<unknown>) => schema.parse(s++ === 0 ? first : second));
    return { ground, structure } as unknown as LlmClient;
  }

  it('does not turn a second pass\'s "none" into the first pass\'s last source', async () => {
    const llm = twoPass(
      { barriers: [claim('Alpha barrier', 'Alpha.', 0)], insights: [] },
      { barriers: [claim('Second pass barrier unsourced', 'Claim from pass two.', -1)], insights: [] },
      ['https://first.example/a', 'https://first.example/b', 'https://first.example/c'], ['https://second.example/a']);
    const cards = await researchMarketSignals(llm, plan, 'd', { minBarriers: 3, minInsights: 0 });
    expect(cards.map((c) => c.card.title)).toEqual(['Alpha barrier']);
  });

  it('does not give a first pass\'s out-of-range number a second pass\'s source', async () => {
    const llm = twoPass(
      { barriers: [claim('Alpha barrier', 'Alpha.', 0), claim('Beta barrier invented', 'No source really.', 4)], insights: [] },
      { barriers: [claim('Gamma barrier', 'G.', 0)], insights: [] },
      ['https://first.example/a', 'https://first.example/b'], ['https://second.example/a', 'https://second.example/b', 'https://second.example/c']);
    const cards = await researchMarketSignals(llm, plan, 'd', { minBarriers: 3, minInsights: 0 });
    expect(cards.map((c) => c.card.title).sort()).toEqual(['Alpha barrier', 'Gamma barrier']);
    expect(cards.find((c) => c.card.title === 'Gamma barrier')!.card.citations.map((c) => c.url)).toEqual(['https://second.example/a']);
  });

  it('keeps the sourced copy when both passes found the same barrier and only one had a source', () => {
    const kept = deduplicatePreferSourced([
      { title: 'Grid delays', cited: [] as unknown[] }, { title: 'Grid  delays!', cited: [{ url: 'x' }] }, { title: 'Capital', cited: [{ url: 'y' }] },
    ], 10);
    expect(kept.map((k) => k.cited.length)).toEqual([1, 1]);
    expect(kept.map((k) => k.title)).toEqual(['Grid  delays!', 'Capital']);
  });
});
