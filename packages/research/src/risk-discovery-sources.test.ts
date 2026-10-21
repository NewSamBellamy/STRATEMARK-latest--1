/**
 * Audit item M6: a risk (vice) card is a documented controversy about a company, shown with the page that says so.
 *
 * The roster path (roster-signals) has long refused a risk unless ONE fit source is attributed by the search itself to a
 * sentence that reads the event, the claim is one sentence about this company, and the source is a public page that is not
 * the company's own site. The per-company discovery path (the company agent, and the ViceAgent) still trusted the source
 * NUMBER the model wrote: a finding was kept when that number existed, even if the search never attached that sentence to that
 * source, even if the finding was two sentences, and even if the page was the company's own website. A risk could therefore be
 * stored with a source that does not state it. Each case below is a finding that was kept before and must now be dropped; the
 * honest version of the same finding must still be kept.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { hydrateCompanyCard, hydrateCompanyCardsBatch } from './company-agent';
import { ViceAgent } from './signal-agents';
import { claimKey } from './risk-claims';
import type { CompanyCandidate, LlmClient, MarketPlan, ProviderGrounding } from './types';

const plan: MarketPlan = { marketName: 'Warehouse Robotics', vertical: 'Robotics', geography: null, notes: null, searchThemes: [] };

const acme: CompanyCandidate = { name: 'Acme Robotics', domain: 'acme-robotics.com', descriptor: 'Warehouse robots', cardTypes: ['company', 'vice'] };
const beta: CompanyCandidate = { name: 'Beta Capital Group', domain: 'betacapital.com', descriptor: 'Lender', cardTypes: ['company', 'vice'] };

const REUTERS = 'https://www.reuters.com/acme-recall';
const FT = 'https://www.ft.com/acme-profile';
const OWN_SITE = 'https://www.acme-robotics.com/press/recall';

/** What the search wrote about the recall, and the sentence of the notes the structuring step turns into a finding. */
const RECALL_NOTE = 'Acme Robotics was fined by a safety regulator over a robot recall in 2024, the agency said.';
const RECALL = 'Acme Robotics was fined by a safety regulator over a robot recall in 2024.';
const PROFILE_NOTE = 'Acme Robotics builds warehouse robots and employs about 400 people across two sites.';

const grounding = (supports: Array<[string, string]>): ProviderGrounding => ({
  provider: 'google-search',
  answerText: supports.map(([text]) => text).join(' '),
  supports: supports.map(([text, url], index) => ({ supportIndex: index, text, sources: [{ chunkIndex: index, url, title: new URL(url).hostname }] })),
});

type Finding = { text: string; sourceIndex: number | null };

function fakeClient(options: { findings: Finding[]; citations: Array<{ title: string; url: string }>; grounding?: ProviderGrounding; cultureNote?: string | null }): LlmClient {
  return {
    ground: vi.fn(async () => ({
      text: options.grounding?.answerText ?? 'Grounded notes',
      citations: options.citations,
      queries: ['q'],
      ...(options.grounding ? { grounding: options.grounding } : {}),
    })),
    structure: vi.fn(async (_prompt: string, schema: ZodType<unknown>) => schema.parse({
      oneLiner: 'Warehouse robots', hqLocation: null, website: null, brand: null, metrics: {}, facts: {},
      viceClaims: options.findings, cultureNote: options.cultureNote ?? null,
    })),
  } as unknown as LlmClient;
}

const cite = (url: string) => ({ title: new URL(url).hostname, url });

async function riskClaims(options: Parameters<typeof fakeClient>[0], others: string[] = []) {
  const result = await hydrateCompanyCard({ candidate: acme, client: fakeClient(options), plan, deckId: 'dck', otherCompanies: others });
  const card = result.cards.find((c) => c.card.cardType === 'vice');
  return { result, card, claims: result.viceClaims };
}

describe('a risk found while researching one company is kept only when the search itself attributed it to a fit source', () => {
  it('keeps an honest controversy: one sentence about the company, attributed by the search to a public page', async () => {
    const { card, claims } = await riskClaims({
      findings: [{ text: RECALL, sourceIndex: 0 }], citations: [cite(REUTERS)], grounding: grounding([[RECALL_NOTE, REUTERS]]),
    });
    expect(claims.map((c) => [c.claimText, c.sourceUrl])).toEqual([[RECALL, REUTERS]]);
    expect(card?.viceClaims).toHaveLength(1);
    expect(card?.metrics).toEqual([]);
  });

  it('files the claim on the source the search attached to that sentence, not the one the model numbered', async () => {
    const { claims } = await riskClaims({
      findings: [{ text: RECALL, sourceIndex: 0 }],
      citations: [cite(FT), cite(REUTERS)],
      grounding: grounding([[PROFILE_NOTE, FT], [RECALL_NOTE, REUTERS]]),
    });
    expect(claims.map((c) => c.sourceUrl)).toEqual([REUTERS]);
  });

  it('drops a finding whose numbered source exists but is attached to something else, with nothing else backing it', async () => {
    const { card, claims } = await riskClaims({
      findings: [{ text: RECALL, sourceIndex: 0 }], citations: [cite(FT)], grounding: grounding([[PROFILE_NOTE, FT]]),
    });
    expect(claims).toEqual([]);
    expect(card).toBeUndefined();
  });

  it('drops a finding when the search attributed nothing at all, however real the source number looks', async () => {
    const withoutSupports = await riskClaims({ findings: [{ text: RECALL, sourceIndex: 0 }], citations: [cite(REUTERS)] });
    expect(withoutSupports.claims).toEqual([]);
    expect(withoutSupports.card).toBeUndefined();
    const emptySupports = await riskClaims({
      findings: [{ text: RECALL, sourceIndex: 0 }], citations: [cite(REUTERS)], grounding: { provider: 'google-search', answerText: RECALL_NOTE, supports: [] },
    });
    expect(emptySupports.claims).toEqual([]);
  });

  it('drops a finding that is two sentences: the second was never looked up and would ride on the first one\'s source', async () => {
    const { claims } = await riskClaims({
      findings: [{ text: `${RECALL} Its chief executive was later jailed for securities fraud.`, sourceIndex: 0 }],
      citations: [cite(REUTERS)], grounding: grounding([[RECALL_NOTE, REUTERS]]),
    });
    expect(claims).toEqual([]);
    const clause = await riskClaims({
      findings: [{ text: 'Acme Robotics was fined over a robot recall in 2024; its chief executive was jailed for fraud.', sourceIndex: 0 }],
      citations: [cite(REUTERS)], grounding: grounding([[RECALL_NOTE, REUTERS]]),
    });
    expect(clause.claims).toEqual([]);
  });

  it('drops a finding backed only by the company\'s own website', async () => {
    const { claims } = await riskClaims({
      findings: [{ text: RECALL, sourceIndex: 0 }], citations: [cite(OWN_SITE)], grounding: grounding([[RECALL_NOTE, OWN_SITE]]),
    });
    expect(claims).toEqual([]);
  });

  it('drops a finding backed only by a page on a private network address', async () => {
    const internal = 'http://intranet.corp/acme-recall';
    const { claims } = await riskClaims({
      findings: [{ text: RECALL, sourceIndex: 0 }], citations: [cite(internal)], grounding: grounding([[RECALL_NOTE, internal]]),
    });
    expect(claims).toEqual([]);
  });

  it('drops a finding about a rival, a finding that does not name the company, and a finding that is not a controversy', async () => {
    const rivalNote = 'Acme Robotics and Beta Capital Group were fined by regulators over a joint recall in 2024, the agency said.';
    const rival = await riskClaims({
      findings: [{ text: 'Acme Robotics and Beta Capital Group were fined by regulators over a joint recall in 2024.', sourceIndex: 0 }],
      citations: [cite(REUTERS)], grounding: grounding([[rivalNote, REUTERS]]),
    }, ['Beta Capital Group']);
    expect(rival.claims).toEqual([]);

    const unnamed = await riskClaims({
      findings: [{ text: 'The company was fined by a safety regulator over a robot recall in 2024.', sourceIndex: 0 }],
      citations: [cite(REUTERS)], grounding: grounding([['The company was fined by a safety regulator over a robot recall in 2024, the agency said.', REUTERS]]),
    });
    expect(unnamed.claims).toEqual([]);

    const awardNote = 'Acme Robotics won a 2024 industry award for its new warehouse robot launch, the trade body said.';
    const award = await riskClaims({
      findings: [{ text: 'Acme Robotics won a 2024 industry award for its new warehouse robot launch.', sourceIndex: 0 }],
      citations: [cite(REUTERS)], grounding: grounding([[awardNote, REUTERS]]),
    });
    expect(award.claims).toEqual([]);
  });

  it('keeps the honest findings of a company and drops only the others', async () => {
    const { claims } = await riskClaims({
      findings: [
        { text: RECALL, sourceIndex: 0 },
        { text: 'Acme Robotics was convicted of securities fraud and its chief executive jailed in 2025.', sourceIndex: 0 },
      ],
      citations: [cite(REUTERS)], grounding: grounding([[RECALL_NOTE, REUTERS]]),
    });
    expect(claims.map((c) => c.claimText)).toEqual([RECALL]);
  });

  it('does not change what a culture note needs: it is kept without a search attribution, as before', async () => {
    const note = 'Hosts weekly open-source hackathons for students.';
    const result = await hydrateCompanyCard({
      candidate: { ...acme, cardTypes: ['company', 'vice', 'culture'] },
      client: fakeClient({ findings: [], citations: [cite(REUTERS)], cultureNote: note }), plan, deckId: 'dck',
    });
    expect(result.cards.find((c) => c.card.cardType === 'culture')?.card.summary).toBe(note);
    // No finding, no risk card: a signal card is never minted empty.
    expect(result.cards.some((c) => c.card.cardType === 'vice')).toBe(false);
  });
});

describe('the same rule applies when one search covers a whole cohort', () => {
  it('files each company\'s risk on a sentence about that company, and drops the one that names the other', async () => {
    const betaNote = 'Beta Capital Group agreed to a settlement over a lending lawsuit in 2023, court records show.';
    const betaClaim = 'Beta Capital Group agreed to a settlement over a lending lawsuit in 2023.';
    const betaUrl = 'https://www.bbc.com/beta-settlement';
    const g = grounding([[RECALL_NOTE, REUTERS], [betaNote, betaUrl]]);
    const citations = [cite(REUTERS), cite(betaUrl)];
    const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => schema.parse({
      oneLiner: 'x', hqLocation: null, website: null, brand: null, metrics: {}, facts: {},
      viceClaims: prompt.includes('notes on "Acme Robotics"')
        ? [{ text: RECALL, sourceIndex: 0 }, { text: 'Acme Robotics settled with Beta Capital Group over a lending lawsuit in 2023.', sourceIndex: 1 }]
        : [{ text: betaClaim, sourceIndex: 0 }],
      cultureNote: null,
    }));
    const ground = vi.fn(async () => ({ text: g.answerText, citations, queries: ['q'], grounding: g }));
    const client = { ground, structure } as unknown as LlmClient;
    const results = await hydrateCompanyCardsBatch({
      batch: [{ candidate: acme, companyId: 'cmp_acme' }, { candidate: beta, companyId: 'cmp_beta' }],
      client, plan, deckId: 'dck', otherCompanies: ['Acme Robotics', 'Beta Capital Group'],
    });
    expect(ground).toHaveBeenCalledTimes(1);
    expect(results.get('Acme Robotics')!.viceClaims.map((c) => [c.claimText, c.sourceUrl])).toEqual([[RECALL, REUTERS]]);
    // Beta's finding named source 0 (the Acme page): the sentence on it is about Acme, so the search's own attribution (the BBC page) wins.
    expect(results.get('Beta Capital Group')!.viceClaims.map((c) => [c.claimText, c.sourceUrl])).toEqual([[betaClaim, betaUrl]]);
  });
});

describe('the dedicated per-company risk search (ViceAgent) obeys the same rule', () => {
  const company = { id: 'cmp_acme', name: 'Acme Robotics', oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl: 'https://www.acme-robotics.com', brandTheme: null };

  function agentClient(findings: Finding[], citations: Array<{ title: string; url: string }>, g?: ProviderGrounding): LlmClient {
    return {
      ground: vi.fn(async () => ({ text: g?.answerText ?? 'notes', citations, queries: ['q'], ...(g ? { grounding: g } : {}) })),
      structure: vi.fn(async (_prompt: string, schema: ZodType<unknown>) => schema.parse({ viceClaims: findings })),
    } as unknown as LlmClient;
  }

  it('keeps an honest, fully attributed controversy and persists the source the search attached', async () => {
    const card = await ViceAgent.research(agentClient([{ text: RECALL, sourceIndex: 1 }], [cite(FT), cite(REUTERS)], grounding([[PROFILE_NOTE, FT], [RECALL_NOTE, REUTERS]])), company, plan, 'dck');
    expect(card?.viceClaims.map((c) => [c.claimText, c.sourceUrl])).toEqual([[RECALL, REUTERS]]);
  });

  it('drops a finding whose numbered source the search never attached to it, one that is two sentences, and one on the company\'s own site', async () => {
    expect(await ViceAgent.research(agentClient([{ text: RECALL, sourceIndex: 0 }], [cite(FT)], grounding([[PROFILE_NOTE, FT]])), company, plan, 'dck')).toBeNull();
    expect(await ViceAgent.research(agentClient([{ text: RECALL, sourceIndex: 0 }], [cite(REUTERS)]), company, plan, 'dck')).toBeNull();
    expect(await ViceAgent.research(agentClient([{ text: `${RECALL} Its chief executive resigned afterwards.`, sourceIndex: 0 }], [cite(REUTERS)], grounding([[RECALL_NOTE, REUTERS]])), company, plan, 'dck')).toBeNull();
    expect(await ViceAgent.research(agentClient([{ text: RECALL, sourceIndex: 0 }], [cite(OWN_SITE)], grounding([[RECALL_NOTE, OWN_SITE]])), company, plan, 'dck')).toBeNull();
  });
});

describe('the key that collapses repeated risks', () => {
  it('tells apart two claims written in a script other than Latin', () => {
    // Before, every character outside a-z was dropped, so any two Cyrillic or Greek claims had the same (empty) key and the
    // second one was thrown away as a duplicate of the first.
    expect(claimKey('Компания оштрафована регулятором.')).not.toBe(claimKey('Завод компании закрыт после аварии.'));
    expect(claimKey('Компания оштрафована регулятором.')).toBe(claimKey('компания оштрафована регулятором'));
    expect(claimKey('Η εταιρεία πρόστιμο.')).not.toBe('');
  });
});
