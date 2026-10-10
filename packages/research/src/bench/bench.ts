/**
 * WS0 benchmark harness — the measurement floor for the speed-architecture
 * workstreams. Runs the repo's own research pipeline headlessly on two fixed
 * markets and reports what the owner will judge: provider call counts, fill
 * milestones, and the honest verified/estimated/unknown rates.
 *
 * Modes:
 *  - mock (default): a scripted provider drives the REAL pipeline and the REAL
 *    acceptance gates with zero network. Counts are the pipeline's structural
 *    call pattern; wall-clock is a pacing floor projected from the configured
 *    rate limits. Every report carries that label.
 *  - live: the real Gemini client with GEMINI_API_KEY read from the
 *    environment at runtime (never logged, never persisted).
 *
 * The script deliberately under-fills: creation enriches only employees
 * (verified) and users (estimated), so every entity keeps core-slot gaps and
 * the post-creation pass drives the same hunt/verify lanes the living deck
 * runs. The scripted hunt returns honestly empty figures — it measures the
 * attempt cost a structured lane (SEC ADV, quote) would remove.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ZodType, ZodTypeDef } from 'zod';
import { classifyMarketProfile, profileMetricTypes, PROFILE_CORE_SLOTS } from '@mi/contracts';
import { selectSecAdvRetainedText } from '../sec-adv';
import { selectTickerMapSlice } from '../market-quote';
import type { ResearchProgress } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from '../repository';
import type { CallMetricsAggregate, LlmClient } from '../types';
import type { OriginalSourceReceipt } from '../original-source';
import { createGeminiClient, DEFAULT_GROUNDED_RPM, DEFAULT_STRUCTURE_RPM } from '../gemini';

export type BenchPhase = 'creation' | 'hunt' | 'verify';

export interface BenchClaim {
  company: string;
  metricType: string;
  url: string;
  /** A gate-passing sentence: subject + verb + one number + unit + literal date. */
  text: string;
}

interface BenchCompanySpec {
  name: string;
  domain: string;
  descriptor: string;
  employees: number;
  users: number;
}

export const BENCH_MARKETS: Record<string, { label: string; companies: BenchCompanySpec[] }> = {
  'venture capital fund management': {
    label: 'venture capital fund management (financial profile)',
    companies: [
      { name: 'Meridian Venture Capital', domain: 'meridianvc.example', descriptor: 'early-stage venture capital firm', employees: 340, users: 12000 },
      { name: 'Harborlight Capital Management', domain: 'harborlightcm.example', descriptor: 'growth-stage capital management firm', employees: 210, users: 8000 },
      { name: 'Bluewater Growth Equity', domain: 'bluewaterge.example', descriptor: 'growth equity investor', employees: 180, users: 6000 },
      { name: 'Cobalt Peak Private Equity', domain: 'cobaltpeakpe.example', descriptor: 'middle-market private equity firm', employees: 260, users: 9000 },
      { name: 'Ironwood Family Office', domain: 'ironwoodfo.example', descriptor: 'single-family office', employees: 45, users: 500 },
      { name: 'Summit Ridge Wealth Management', domain: 'summitridgewm.example', descriptor: 'wealth management for founders', employees: 95, users: 3000 },
    ],
  },
  'utility-scale battery energy storage': {
    label: 'utility-scale battery energy storage (operating profile)',
    companies: [
      { name: 'Northgrid Storage Systems', domain: 'northgrid.example', descriptor: 'grid-scale battery integrator', employees: 4200, users: 90000 },
      { name: 'Voltarc Energy', domain: 'voltarc.example', descriptor: 'storage project developer', employees: 1500, users: 30000 },
      { name: 'Cathode Works', domain: 'cathodeworks.example', descriptor: 'battery cell manufacturer', employees: 8800, users: 40000 },
      { name: 'Gridspan Utilities', domain: 'gridspan.example', descriptor: 'utility storage operator', employees: 5400, users: 250000 },
      { name: 'Ampereon Power', domain: 'ampereon.example', descriptor: 'power electronics for storage', employees: 900, users: 15000 },
      { name: 'Cellfield Technologies', domain: 'cellfield.example', descriptor: 'battery management software', employees: 620, users: 50000 },
    ],
  },
};

/** Production coverage minimums are intentionally bypassed: the bench needs a
 * fixed deck shape so before/after counts stay comparable. */
const benchCoverage = {
  companies: { min: 3, target: 6, max: 6 },
  infrastructure: { min: 0, target: 0, max: 0 },
  distribution: { min: 0, target: 0, max: 0 },
  vice: { min: 0, target: 0, max: 0 },
  culture: { min: 0, target: 0, max: 0 },
  barrier: { min: 1, target: 1, max: 1 },
  insight: { min: 1, target: 1, max: 1 },
};

const CLAIM_DATE = '2026-10-01';

function claimFor(spec: BenchCompanySpec, metricType: string): BenchClaim {
  const url = `https://${spec.domain}/disclosures`;
  const text = metricType === 'employees'
    ? `${spec.name} reported ${spec.employees.toLocaleString('en-US')} employees as of ${CLAIM_DATE}.`
    : metricType === 'aum'
      ? `${spec.name} reports AUM of USD 18 billion as of ${CLAIM_DATE}.`
      : metricType === 'market_cap'
        ? `${spec.name} reported a market cap of USD 12.4 billion as of ${CLAIM_DATE}.`
        : metricType === 'arr'
          ? `${spec.name} reported ARR of USD 310 million as of ${CLAIM_DATE}.`
          : `${spec.name} reported ${spec.users.toLocaleString('en-US')} users as of ${CLAIM_DATE}.`;
  return { company: spec.name, metricType, url, text };
}

function companyClaims(spec: BenchCompanySpec): BenchClaim[] {
  // Employees and users are creation-fill claims; the rest wait for the
  // structured lanes (aum/market_cap/arr) — the bench corpus holds them so
  // WS1's mock transports can serve the same receipts.
  return [claimFor(spec, 'employees'), claimFor(spec, 'users'), claimFor(spec, 'aum'), claimFor(spec, 'market_cap'), claimFor(spec, 'arr')];
}

export function buildClaimsIndex(market: string): Map<string, { company: string; text: string }> {
  const index = new Map<string, { company: string; text: string }>();
  // Marker so the mock reader knows which market's canned structured-lane
  // corpus to serve (the reader is the only consumer of this map).
  index.set('__market__', { company: market, text: '' });
  for (const spec of BENCH_MARKETS[market]!.companies) {
    const claims = companyClaims(spec);
    // One disclosures page per company carrying every claim sentence — the
    // acceptance gates still decide per figure.
    index.set(claims[0]!.url, { company: spec.name, text: claims.map((c) => c.text).join(' ') });
  }
  return index;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Serves the bench corpus as receipts. A hit carries every claim sentence
 * verbatim — the acceptance gates then decide, exactly as with a real page.
 * The structured-lane endpoints (IAPD search/ADV PDF, Yahoo chart, SEC ticker
 * map and dei shares) are served from the same canned corpus so the
 * structured-first lanes measure against the harness too. */
export function makeMockReader(claims: Map<string, { company: string; text: string }>): (url: string) => Promise<OriginalSourceReceipt> {
  const market = claims.get('__market__')?.company ?? '';
  const specs = BENCH_MARKETS[market]?.companies ?? [];
  const byName = new Map(specs.map((c) => [c.name.toUpperCase(), c]));
  const crdOf = (spec: BenchCompanySpec): string => String(300_000 + spec.employees % 700_000);
  const tickerOf = (spec: BenchCompanySpec): string => spec.name.replaceAll(/[^A-Z]/g, '').slice(0, 4) || 'CO';
  const advRetained = (spec: BenchCompanySpec): string => selectSecAdvRetainedText([
    '                                                         FORM ADV',
    'Primary Business Name: ' + spec.name.toUpperCase() + '                    CRD Number: ' + crdOf(spec),
    '3/30/2026 5:50:59 PM',
    ' A. Your full legal name (if you are a sole proprietor, your last, first, and middle names):',
    '        ' + spec.name.toUpperCase() + ' L.P.',
    ' B. In what month does your fiscal year end each year?',
    '        DECEMBER',
    ' A. Approximately how many employees do you have? Include full- and part-time employees but do not include any clerical workers.',
    '        ' + spec.employees.toLocaleString('en-US'),
    '(2) If yes, what is the amount of your regulatory assets under management and total number of accounts?',
    '                    U.S. Dollar Amount                                                   Total Number of Accounts',
    'Discretionary:      (a) $ 18,000,000,000                                                (d) 40',
    'Non-Discretionary:  (b) $ 0                                                              (e) 0',
    'Total:              (c) $ 18,000,000,000                                                (f) 40',
  ].join('\n'));
  const sharesJson = (spec: BenchCompanySpec): string => JSON.stringify({
    cik: Number(crdOf(spec)) % 10_000_000, taxonomy: 'dei', tag: 'EntityCommonStockSharesOutstanding',
    entityName: spec.name.toUpperCase(),
    units: { shares: [{ end: '2025-09-27', val: 1_200_000_000, accn: '0000000000-26-000001', fy: 2025, fp: 'FY', form: '10-K', filed: '2025-10-30' }] },
  });
  const chartJson = (spec: BenchCompanySpec): string => JSON.stringify({
    chart: { result: [{ meta: { currency: 'USD', symbol: tickerOf(spec), instrumentType: 'EQUITY',
      regularMarketTime: 1791576000, regularMarketPrice: 42.5, longName: spec.name, shortName: spec.name } }], error: null },
  });
  return async (url: string): Promise<OriginalSourceReceipt> => {
    const serve = (text: string, format?: OriginalSourceReceipt['format']): OriginalSourceReceipt => ({
      requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
      contentHash: sha256(text), retrievedAt: new Date().toISOString(), text, truncated: false, ...(format ? { format } : {}),
    });
    // Structured-lane endpoints are matched before the generic corpus.
    if (url.startsWith('https://api.adviserinfo.sec.gov/search/firm?')) {
      const hit = specs.find((c) => url.toLowerCase().includes(encodeURIComponent(c.name).toLowerCase().slice(0, 24)));
      if (!hit) return serve(JSON.stringify({ hits: { hits: [] } }));
      return serve(JSON.stringify({ hits: { hits: [{ _source: { firm_source_id: crdOf(hit), firm_name: hit.name.toUpperCase(), firm_other_names: [] } }] } }));
    }
    if (/^https:\/\/reports\.adviserinfo\.sec\.gov\/reports\/ADV\/\d+\/PDF\//.test(url)) {
      const hit = specs.find((c) => url.includes(crdOf(c)));
      return hit ? serve(advRetained(hit), 'sec-adv') : { requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'No canned ADV record.' };
    }
    if (url.startsWith('https://www.sec.gov/files/company_tickers.json')) {
      const lookup = /lookup=([^&]+)/.exec(url)?.[1] ? decodeURIComponent(/lookup=([^&]+)/.exec(url)![1]!) : '';
      const mapJson = JSON.stringify(Object.fromEntries(specs.map((c, i) => [String(i), { cik_str: Number(crdOf(c)) % 10_000_000, ticker: tickerOf(c), title: c.name }])));
      return serve(lookup ? selectTickerMapSlice(mapJson, lookup) : mapJson.slice(0, 3000));
    }
    if (/^https:\/\/query1\.finance\.yahoo\.com\/v1\/finance\/search\?/.test(url)) {
      const query = decodeURIComponent(/q=([^&]+)/.exec(url)?.[1] ?? '');
      const hit = byName.get(query.toUpperCase());
      return serve(JSON.stringify({ quotes: hit ? [{ symbol: tickerOf(hit), shortname: hit.name, longname: hit.name, quoteType: 'EQUITY' }] : [] }));
    }
    if (/^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\//.test(url)) {
      const hit = specs.find((c) => url.includes(tickerOf(c)));
      return hit ? serve(chartJson(hit)) : { requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'No canned quote.' };
    }
    if (url.includes('/dei/EntityCommonStockSharesOutstanding.json')) {
      const cik = /CIK(\d+)/.exec(url)?.[1] ?? '';
      const hit = specs.find((c) => String(Number(crdOf(c)) % 10_000_000) === cik.replace(/^0+/, ''));
      return hit ? serve(sharesJson(hit), 'sec-companyconcept') : { requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'No canned shares concept.' };
    }
    const hit = claims.get(url);
    if (!hit) {
      return { requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'Not in the bench corpus.' };
    }
    return serve(`${hit.company} — investor disclosures page. ${hit.text} Filed under periodic reporting.`);
  };
}

/** Scripted provider: same prompt-intent chain the pipeline tests use, with
 * per-market canned content and per-company enrichment. */
export function makeMockClient(market: string): LlmClient {
  const spec = BENCH_MARKETS[market];
  if (!spec) throw new Error(`Unknown bench market: ${market}. Known: ${Object.keys(BENCH_MARKETS).join('; ')}`);
  const companies = spec.companies;
  const byName = new Map(companies.map((c) => [c.name, c]));

  return {
    ground: benchGround(market),
    structure: (async (prompt: string, schema: ZodType<unknown, ZodTypeDef, unknown>) => {
      let obj: unknown;
      if (prompt.includes('market definition')) {
        obj = { marketName: spec.label, vertical: market, geography: null, notes: null, searchThemes: [market, 'leading companies'] };
      } else if (prompt.includes('"companies"')) {
        obj = {
          companies: companies.map((c) => ({ name: c.name, domain: c.domain, descriptor: c.descriptor, cardTypes: ['company'] })),
        };
      } else if (prompt.includes('Convert the research notes on')) {
        const name = prompt.match(/Convert the research notes on "([^"]+)"/)?.[1];
        const c = name ? byName.get(name) : undefined;
        if (!c) throw new Error(`bench mock: enrichment prompt for unknown company — ${prompt.slice(0, 120)}`);
        const claims = companyClaims(c);
        obj = {
          oneLiner: `${c.descriptor}.`,
          hqLocation: 'United States',
          website: `https://${c.domain}`,
          brand: null,
          metrics: {
            employees: {
              value: c.employees, confidence: 'verified', sourceIndex: 0, method: null,
              reportedClaim: { sourceUrl: claims[0]!.url, quote: claims[0]!.text, asOf: CLAIM_DATE, basis: 'employees', unit: 'count', definition: 'employees' },
            },
            users: {
              value: c.users, confidence: 'estimated', sourceIndex: 0, method: 'reported accounts',
              reportedClaim: { sourceUrl: claims[1]!.url, quote: claims[1]!.text, asOf: CLAIM_DATE, basis: 'users', unit: 'count', definition: 'users' },
            },
          },
          viceClaims: [],
          cultureNote: null,
        };
      } else if (prompt.includes('"barriers"')) {
        obj = {
          barriers: [{ title: 'Capital intensity', summary: 'Building at scale requires heavy up-front investment.', sourceIndex: 0 }],
          insights: [{ title: 'Consolidation pressure', summary: 'Scale operators keep winning share.', sourceIndex: 0 }],
        };
      } else if (prompt.includes('"markdown"')) {
        obj = { markdown: '# Overview\n\n## What they do\nDisclosed operations.\n\n## Why it matters\nScale and position.' };
      } else if (prompt.includes('"verdict"')) {
        obj = { verdict: 'supported', rationale: 'The retained disclosure page states the figure.' };
      } else if (prompt.includes('nudge')) {
        obj = { nudge: 0, reason: null };
      } else if (prompt.includes('"figures"')) {
        // A successful hunt: propose the corpus claims the company's market
        // profile actually hunts for. The hunt lane still confirms every
        // figure against the retained receipt through the real gates.
        const name = companies.find((c) => prompt.includes(c.name))?.name;
        if (!name) throw new Error(`bench mock: figures prompt without a bench company — ${prompt.slice(0, 120)}`);
        const c = byName.get(name)!;
        const wanted = new Set(profileMetricTypes(classifyMarketProfile({ name: c.name, oneLiner: `${c.descriptor}.` })));
        const valueFor: Record<string, number> = { aum: 18_000_000_000, market_cap: 12_400_000_000, arr: 310_000_000, users: c.users, employees: c.employees };
        const unitFor = (metricType: string): 'USD' | 'count' | 'percent' =>
          ['aum', 'market_cap', 'arr', 'valuation'].includes(metricType) ? 'USD'
            : metricType === 'market_share' ? 'percent' : 'count';
        const figures = companyClaims(c)
          .filter((claim) => wanted.has(claim.metricType as never) && valueFor[claim.metricType] !== undefined)
          .map((claim) => ({
            metricType: claim.metricType,
            value: valueFor[claim.metricType]!,
            methodNote: 'Disclosed on the firm\'s investor disclosures page.',
            passageSupport: {
              sourceUrl: claim.url, quote: claim.text, asOf: CLAIM_DATE,
              basis: claim.metricType, unit: unitFor(claim.metricType), definition: claim.metricType,
            },
          }));
        obj = { figures };
      } else {
        obj = {};
      }
      return schema.parse(obj);
    }) as LlmClient['structure'],
  };
}

function benchGround(market: string): LlmClient['ground'] {
  const spec = BENCH_MARKETS[market]!;
  const companies = spec.companies;
  return async (prompt: string) => {
    const mentioned = companies.find((c) => prompt.includes(c.name));
    const claims = mentioned
      ? companyClaims(mentioned)
      : companies.flatMap((c) => companyClaims(c));
    const text = claims.map((c) => c.text).join('\n');
    const sources: Array<{ title: string; url: string }> = mentioned
      ? [{ title: mentioned.domain, url: `https://${mentioned.domain}/disclosures` }]
      : companies.map((c) => ({ title: c.domain, url: `https://${c.domain}/disclosures` }));
    return {
      text: text || `${spec.label}: grounded survey notes.`,
      citations: sources.map((s) => ({ title: s.title, url: s.url })),
      queries: [market],
      grounding: {
        provider: 'google-search' as const,
        answerText: text,
        supports: claims.map((claim, supportIndex) => ({
          supportIndex, text: claim.text,
          sources: [{ chunkIndex: 0, url: claim.url, title: claim.company }],
        })),
      },
    };
  };
}

export interface BenchCall {
  index: number;
  phase: BenchPhase;
  kind: 'ground' | 'structure';
  startedAtMs: number;
  durationMs: number;
}

/** Wraps any LlmClient and records every call with its phase. */
export class CountingClient implements LlmClient {
  readonly calls: BenchCall[] = [];
  phase: BenchPhase = 'creation';
  metrics = (): CallMetricsAggregate => this.inner.metrics?.() ?? { calls: 0, retries: 0, rateLimitedMs: 0, fallbacks: 0 };
  constructor(private readonly inner: LlmClient, private readonly epoch: number = Date.now()) {}
  async ground(prompt: string, opts?: Parameters<LlmClient['ground']>[1]) {
    return this.record('ground', () => this.inner.ground(prompt, opts));
  }
  async structure<T>(prompt: string, schema: ZodType<T, ZodTypeDef, unknown>, opts?: Parameters<LlmClient['structure']>[2]) {
    return this.record('structure', () => this.inner.structure(prompt, schema, opts));
  }
  private async record<R>(kind: 'ground' | 'structure', fn: () => Promise<R>): Promise<R> {
    const startedAtMs = Date.now() - this.epoch;
    try {
      return await fn();
    } finally {
      this.calls.push({ index: this.calls.length, phase: this.phase, kind, startedAtMs, durationMs: Date.now() - this.epoch - startedAtMs });
    }
  }
}

/** Pacing floor: serial issue, each lane spaced at its RPM. Real fan-out
 * overlaps arrivals, so treat these as lower bounds (label them). */
export function projectPacing(calls: BenchCall[], groundedRpm = DEFAULT_GROUNDED_RPM, structureRpm = DEFAULT_STRUCTURE_RPM): number[] {
  const groundSpacing = 60_000 / groundedRpm;
  const structureSpacing = 60_000 / structureRpm;
  let groundNext = 0;
  let structureNext = 0;
  const completions: number[] = [];
  for (const call of calls) {
    const arrival = completions.length > 0 ? completions[completions.length - 1]! : 0;
    if (call.kind === 'ground') {
      const dispatch = Math.max(arrival, groundNext);
      completions.push(dispatch + call.durationMs);
      groundNext = dispatch + groundSpacing;
    } else {
      const dispatch = Math.max(arrival, structureNext);
      completions.push(dispatch + call.durationMs);
      structureNext = dispatch + structureSpacing;
    }
  }
  return completions;
}

export interface BenchMilestone {
  callIndex: number;
  wallMs: number;
  companyName?: string;
}

export interface BenchRates {
  metrics: number;
  verified: number;
  estimated: number;
  unknown: number;
  userVerified: number;
  nullValues: number;
  byType: Record<string, { verified: number; estimated: number; unknown: number; user_verified: number }>;
}

export interface BenchReport {
  market: string;
  label: string;
  mode: 'mock' | 'live';
  startedAt: string;
  wallMs: number;
  entities: Array<{ companyId: string; name: string; profile: string; verified: number; estimated: number; unknown: number }>;
  deckStatus: string;
  calls: {
    ground: number;
    structure: number;
    total: number;
    byPhase: Record<BenchPhase, { ground: number; structure: number }>;
  };
  milestones: {
    firstCard: BenchMilestone | null;
    firstVerifiedFigure: BenchMilestone | null;
    filled: BenchMilestone;
  };
  projected: {
    groundedRpm: number;
    structureRpm: number;
    firstCardMs: number | null;
    firstVerifiedMs: number | null;
    filledMs: number;
  };
  rates: BenchRates;
  notes: string[];
}

export interface BenchOptions {
  market: string;
  mode?: 'mock' | 'live';
  catalogMax?: number;
  outDir?: string;
}

function emptySnapshot(): RepoSnapshot {
  return {
    schemaVersion: 2,
    markets: [], decks: [], companies: [], cards: [], metrics: [], viceClaims: [],
    dashboards: {}, companyMarket: {}, opportunity: {}, reports: [], savedCards: [],
    researchJobs: [], threads: [], researchEvidence: [], originalSourceAttempts: [],
  } as unknown as RepoSnapshot;
}

export async function runBench(options: BenchOptions): Promise<BenchReport> {
  const market = options.market;
  const spec = BENCH_MARKETS[market];
  if (!spec) throw new Error(`Unknown bench market: ${market}. Known: ${Object.keys(BENCH_MARKETS).join('; ')}`);
  const mode = options.mode ?? 'mock';
  const startedAt = new Date().toISOString();
  const epoch = Date.now();

  let inner: LlmClient;
  if (mode === 'live') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('live mode needs GEMINI_API_KEY in the environment (read at runtime only — never logged, never persisted).');
    inner = createGeminiClient({ apiKey });
  } else {
    inner = makeMockClient(market);
  }
  const counting = new CountingClient(inner, epoch);

  let snapshot: RepoSnapshot | null = emptySnapshot();
  const store: ResearchStore = { read: () => snapshot, write: (next) => { snapshot = next; } };

  const repo = new GeminiRepository({
    apiKey: mode === 'live' ? (process.env.GEMINI_API_KEY ?? '') : 'bench-mock',
    client: counting,
    store,
    // Reader only: the repository builds its own retention services, exactly
    // like the browser app — receipts persist into the snapshot it owns.
    originalSourceReader: makeMockReader(buildClaimsIndex(market)),
    catalogMax: options.catalogMax ?? 6,
    catalogPasses: 0,
    coverage: benchCoverage,
  });

  const found: { firstCard: BenchMilestone | null; firstVerifiedFigure: BenchMilestone | null } = { firstCard: null, firstVerifiedFigure: null };
  const onProgress = (p: ResearchProgress): void => {
    if (p.kind !== 'find' || p.stage !== 'summary' || !p.card?.company) return;
    const at: BenchMilestone = { callIndex: counting.calls.length, wallMs: Date.now() - epoch, companyName: p.card.company.name };
    if (!found.firstCard) found.firstCard = at;
    if (!found.firstVerifiedFigure && p.card.metrics.some((m) => m.value != null && m.confidence === 'verified')) found.firstVerifiedFigure = at;
  };

  const { market: marketRow, deck } = await repo.createResearchedDeck({ prompt: market, region: null }, { onProgress });
  await repo.waitForBackgroundJobs();
  const filled: BenchMilestone = { callIndex: counting.calls.length, wallMs: Date.now() - epoch };

  // Post-creation hydration pass — the same hunt/verify lanes the living deck
  // drives after creation, one attempt per gapped entity (no cooldown ladder).
  counting.phase = 'hunt';
  const entries = (await repo.listCards(deck.id))
    .filter((e) => e.company && ['company', 'infrastructure', 'distribution'].includes(e.card.cardType));
  for (const entry of entries) {
    const facts = await repo.getCompanyFacts(entry.company!.id);
    const core = PROFILE_CORE_SLOTS[classifyMarketProfile(entry.company)].flat();
    if (core.some((type) => !facts.some((m) => m.metricType === type && m.value != null))) {
      await repo.huntCompanyMetrics(entry.company!.id);
      if (!found.firstVerifiedFigure) {
        const refreshed = await repo.getCompanyFacts(entry.company!.id);
        if (refreshed.some((m) => m.value != null && m.confidence === 'verified')) {
          found.firstVerifiedFigure = { callIndex: counting.calls.length, wallMs: Date.now() - epoch, companyName: entry.company!.name };
        }
      }
    }
  }
  counting.phase = 'verify';
  for (const entry of entries) {
    if (typeof repo.verifyCompanyMetrics === 'function') await repo.verifyCompanyMetrics(entry.company!.id);
  }

  const entityReports: BenchReport['entities'] = [];
  const rates: BenchRates = { metrics: 0, verified: 0, estimated: 0, unknown: 0, userVerified: 0, nullValues: 0, byType: {} };
  for (const entry of entries) {
    const facts = await repo.getCompanyFacts(entry.company!.id);
    const per = { verified: 0, estimated: 0, unknown: 0 };
    for (const m of facts) {
      rates.metrics += 1;
      if (m.value == null) rates.nullValues += 1;
      if (m.confidence === 'verified') { rates.verified += 1; per.verified += 1; }
      else if (m.confidence === 'estimated') { rates.estimated += 1; per.estimated += 1; }
      else if (m.confidence === 'user_verified') { rates.userVerified += 1; }
      else { rates.unknown += 1; per.unknown += 1; }
      const row = rates.byType[m.metricType] ?? { verified: 0, estimated: 0, unknown: 0, user_verified: 0 };
      if (m.confidence === 'verified') row.verified += 1;
      else if (m.confidence === 'estimated') row.estimated += 1;
      else if (m.confidence === 'user_verified') row.user_verified += 1;
      else row.unknown += 1;
      rates.byType[m.metricType] = row;
    }
    entityReports.push({
      companyId: entry.company!.id, name: entry.company!.name,
      profile: classifyMarketProfile(entry.company),
      verified: per.verified, estimated: per.estimated, unknown: per.unknown,
    });
  }

  const stored = await repo.getDeckByMarket(marketRow.id) as { status?: string } | null;
  const byPhase: Record<BenchPhase, { ground: number; structure: number }> = {
    creation: { ground: 0, structure: 0 }, hunt: { ground: 0, structure: 0 }, verify: { ground: 0, structure: 0 },
  };
  for (const call of counting.calls) {
    byPhase[call.phase][call.kind] += 1;
  }
  const projected = projectPacing(counting.calls);
  const completedAt = (index: number): number | null => (index > 0 && index <= projected.length ? Math.round(projected[index - 1]!) : null);

  const report: BenchReport = {
    market,
    label: spec.label,
    mode,
    startedAt,
    wallMs: Date.now() - epoch,
    entities: entityReports,
    deckStatus: stored?.status ?? 'unknown',
    calls: {
      ground: counting.calls.filter((c) => c.kind === 'ground').length,
      structure: counting.calls.filter((c) => c.kind === 'structure').length,
      total: counting.calls.length,
      byPhase,
    },
    milestones: { firstCard: found.firstCard, firstVerifiedFigure: found.firstVerifiedFigure, filled },
    projected: {
      groundedRpm: DEFAULT_GROUNDED_RPM,
      structureRpm: DEFAULT_STRUCTURE_RPM,
      firstCardMs: found.firstCard ? completedAt(found.firstCard.callIndex) : null,
      firstVerifiedMs: found.firstVerifiedFigure ? completedAt(found.firstVerifiedFigure.callIndex) : null,
      filledMs: completedAt(filled.callIndex) ?? Math.round(projected[projected.length - 1] ?? 0),
    },
    rates,
    notes: mode === 'mock'
      ? [
          'mock mode: provider responses are scripted; the pipeline, repository and acceptance gates are the real ones.',
          'projected times are a pacing floor from the free-tier limiter (serial issue, recorded durations) — lower bounds.',
          'the scripted hunt returns honestly empty figures, so hunt-phase calls measure attempt cost; structured lanes (WS1) remove them.',
        ]
      : ['live mode: real provider calls; the key was read from the environment at runtime only.'],
  };
  return report;
}

export function reportSlug(market: string): string {
  return market.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

export function writeReport(report: BenchReport, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${report.mode}-${reportSlug(report.market)}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

export function formatReport(report: BenchReport): string {
  const lines = [
    `bench ${report.mode} — ${report.label}`,
    `  deck: ${report.deckStatus}, entities: ${report.entities.length}, wall: ${(report.wallMs / 1000).toFixed(1)}s`,
    `  calls: ground ${report.calls.ground} / structure ${report.calls.structure} (total ${report.calls.total})`,
    `    creation ${report.calls.byPhase.creation.ground}g+${report.calls.byPhase.creation.structure}s · hunt ${report.calls.byPhase.hunt.ground}g+${report.calls.byPhase.hunt.structure}s · verify ${report.calls.byPhase.verify.ground}g+${report.calls.byPhase.verify.structure}s`,
    `  milestones: first card ${report.milestones.firstCard ? `@call ${report.milestones.firstCard.callIndex}` : '—'} · first verified ${report.milestones.firstVerifiedFigure ? `@call ${report.milestones.firstVerifiedFigure.callIndex}` : '—'} · filled @call ${report.milestones.filled.callIndex}`,
    `  projected @ ${report.projected.groundedRpm}/15 RPM: first card ${report.projected.firstCardMs ? `${(report.projected.firstCardMs / 1000).toFixed(0)}s` : '—'} · first verified ${report.projected.firstVerifiedMs ? `${(report.projected.firstVerifiedMs / 1000).toFixed(0)}s` : '—'} · filled ${(report.projected.filledMs / 60000).toFixed(1)}min`,
    `  rates: ${report.rates.verified} verified / ${report.rates.estimated} estimated / ${report.rates.unknown} unknown of ${report.rates.metrics} metrics (${report.rates.nullValues} null)`,
    ...report.entities.map((e) => `    ${e.name} [${e.profile}]: ${e.verified}v ${e.estimated}e ${e.unknown}u`),
  ];
  return lines.join('\n');
}
