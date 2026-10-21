/**
 * The one read-time composition (PLAN-CRAAP 1.2/1.8): the repository's getCompanyFacts and the
 * card read paths (SentinelRepository, apps/api, share preflight) all serve the same facts for
 * the same input, assessed afresh with an injected clock. Fixed now: 2026-10-20T12:00:00Z.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CardWithCompany, Company, CompanyMetric, FigureAssessment } from '@mi/contracts';
import { displayedCompanyFacts, projectCompanyCardFacts } from './displayed-facts';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import type { OriginalSourceAttempt } from './original-source';
import type { LlmClient } from './types';

const NOW = new Date('2026-10-20T12:00:00Z');
const url = 'https://sec.gov/Archives/acme';
const quote = 'Acme reported 45 employees as of 2026-10-01.';
const captured = '2026-10-02T00:00:00.000Z';
const company: Company = { id: 'cmp', name: 'Acme', oneLiner: 'Software', websiteUrl: 'https://acme.com', logoUrl: null, hqLocation: null, brandTheme: null };
const employee: CompanyMetric = { id: 'employees', companyId: 'cmp', metricType: 'employees', value: 45, confidence: 'verified',
  source: url, citations: [{ title: 'SEC', url }], methodNote: null, capturedAt: captured,
  passageSupport: { sourceUrl: url, quote, basis: 'employees', asOf: '2026-10-01', unit: 'count' } };
const forged: FigureAssessment = {
  version: 1, assessedAt: '2020-01-01T00:00:00.000Z',
  currency: { asOf: '2020-01-01', asOfSource: 'figure', notAfter: null, notAfterSource: null, ageDays: 1, state: 'current', freshDays: 365, staleDays: 548 },
  relevance: { definition: 'employees', period: 'point_in_time', issues: [] },
  authority: { tier: 1, publisher: 'Forger', level: 'strong' },
  accuracy: { support: 'original_passage', independentSources: 9, corroboration: 'corroborated', plausibility: 'ok', newerObservation: null },
  purpose: { kind: 'regulatory_filing', reportedBy: 'regulator' },
  score: 100, verdict: 'strong', effect: 'none', summary: 'Forged: perfect.',
};
const attempt = (publishedAt?: string): OriginalSourceAttempt => ({ id: 'source', companyId: 'cmp', metricType: 'company_profile', capturedAt: captured,
  receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote,
    retrievedAt: '2026-10-16T00:00:00.000Z', ...(publishedAt ? { publishedAt } : {}) }] });
const cardOf = (metrics: CompanyMetric[], cardType: 'company' | 'culture' = 'company'): CardWithCompany => ({
  card: { id: 'card', deckId: 'deck', companyId: 'cmp', cardType, tier: 5, tierReason: null, title: null, summary: null, citations: [], keyPoints: [], createdAt: captured },
  company, metrics, viceClaims: [] });
const displayed = (metrics: CompanyMetric[], attempts: OriginalSourceAttempt[], now = NOW) =>
  displayedCompanyFacts({ company, metrics, attempts, evidence: [], now });
const of = (rows: CompanyMetric[]) => rows.find((row) => row.metricType === 'employees')!;

async function repoFor(metrics: CompanyMetric[], attempts: OriginalSourceAttempt[], now = NOW) {
  let snapshot = migrateSnapshot(null).snapshot;
  snapshot.companies = [company];
  snapshot.metrics = metrics;
  snapshot.originalSourceAttempts = attempts;
  const store: ResearchStore = { read: () => structuredClone(snapshot), write: async (value) => { snapshot = structuredClone(value); } };
  const client = { ground: vi.fn(), structure: vi.fn() } as unknown as LlmClient;
  return new GeminiRepository({ apiKey: 'test', store, client, now: () => now });
}

describe('card read paths serve the same facts as getCompanyFacts', () => {
  it('a current verified figure: card path, composition and repository agree', async () => {
    const viaCard = projectCompanyCardFacts(cardOf([employee]), [attempt()], { now: NOW }).metrics;
    expect(viaCard).toEqual(displayed([employee], [attempt()]));
    expect(viaCard).toEqual(await (await repoFor([employee], [attempt()])).getCompanyFacts('cmp'));
    expect(of(viaCard)).toMatchObject({ value: 45, confidence: 'verified' });
    expect(of(viaCard).assessment!.assessedAt).toBe(NOW.toISOString());
  });
  it('an old verified figure: all three show it as the same dated estimate (shown_aged_out), never vanished', async () => {
    const later = new Date('2028-01-01T00:00:00Z');
    const viaCard = projectCompanyCardFacts(cardOf([employee]), [attempt()], { now: later }).metrics;
    expect(viaCard).toEqual(displayed([employee], [attempt()], later));
    expect(viaCard).toEqual(await (await repoFor([employee], [attempt()], later)).getCompanyFacts('cmp'));
    expect(of(viaCard)).toMatchObject({ value: 45, confidence: 'estimated', lastVerifiedAt: null });
    expect(of(viaCard).assessment!.effect).toBe('shown_aged_out');
  });
  it('a stale-but-in-window verified figure is demoted the same way on every path', async () => {
    // Page dated well before the figure: the figure date is suspect, so it reads as the page's old date.
    const old = attempt('2024-03-01');
    const viaCard = projectCompanyCardFacts(cardOf([employee]), [old], { now: NOW }).metrics;
    expect(viaCard).toEqual(displayed([employee], [old]));
    expect(viaCard).toEqual(await (await repoFor([employee], [old])).getCompanyFacts('cmp'));
    expect(of(viaCard)).toMatchObject({ confidence: 'estimated', value: 45 });
    expect(of(viaCard).assessment!.effect).toBe('demoted_stale');
  });
  it('a forged assessment on the incoming card is discarded and recomputed', () => {
    const shown = of(projectCompanyCardFacts(cardOf([{ ...employee, assessment: forged }]), [attempt()], { now: NOW }).metrics);
    expect(shown.assessment!.summary).not.toContain('Forged');
    expect(shown.assessment!.assessedAt).toBe(NOW.toISOString());
  });
  it('a forged assessment cannot keep a figure the evidence does not support', () => {
    const shown = of(projectCompanyCardFacts(cardOf([{ ...employee, assessment: forged }]), [], { now: NOW }).metrics);
    expect(shown).toMatchObject({ value: null, confidence: 'unknown' });
    expect(shown.assessment).toBeUndefined();
  });
  it('a signal card gets no facts', () => {
    expect(projectCompanyCardFacts(cardOf([employee], 'culture'), [attempt()], { now: NOW }).metrics).toEqual([]);
  });
  it('does not mutate the incoming card', () => {
    const card = cardOf([{ ...employee, assessment: forged }]);
    const copy = structuredClone(card);
    projectCompanyCardFacts(card, [attempt()], { now: NOW });
    expect(card).toEqual(copy);
  });
});

describe('receipt publication dates reach the assessment', () => {
  it('a page published long before the figure date makes the figure look older, never newer', () => {
    const row = of(displayed([employee], [attempt('2024-03-01')]));
    expect(row.assessment!.currency).toMatchObject({ asOf: '2024-03-01', notAfter: '2024-03-01', notAfterSource: 'page', state: 'stale' });
    expect(row.assessment!.relevance.issues).toContain('figure_date_after_page_date');
    expect(row.passageSupport!.asOf).toBe('2026-10-01'); // never written into the figure's own date
  });
  it('a newer page date does not freshen anything: the figure keeps its own date', () => {
    const row = of(displayed([employee], [attempt('2026-10-15')]));
    expect(row.assessment!.currency).toMatchObject({ asOf: '2026-10-01', asOfSource: 'figure', state: 'current' });
  });
  it('no page date: the figure date alone decides', () => {
    expect(of(displayed([employee], [attempt()])).assessment!.currency).toMatchObject({ asOf: '2026-10-01', notAfter: null });
  });
});
