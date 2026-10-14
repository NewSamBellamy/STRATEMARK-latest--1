/**
 * Stored company summaries: a sales line, a sentence bound to the page it came
 * from, or broken extraction is not a description. Stored ones go back to the
 * pending placeholder once (gate v2); the write lanes never store new ones.
 */
import { describe, expect, it } from 'vitest';
import type { Card, Company } from '@mi/contracts';
import { summaryIsUnfit, UNSUPPORTED_COMPANY_SUMMARY } from './company-summary';
import { extractProviderGrounding } from './grounding-support';
import { providerCompanySummary } from './reported-metrics';
import { migrateSnapshot, type RepoSnapshot } from './repository';
import { revalidateStoredMetrics } from './revalidate-stored';

const SALES = 'Discover Alter Domus, offering expert services to alternative investment managers worldwide.';
const BOUND = 'Oak Branch Advisors is purpose-built for this environment .';
const GOOD = 'Alter Domus provides fund administration and debt services to alternative asset managers.';

const company = (id: string, name: string, oneLiner: string): Company =>
  ({ id, name, oneLiner, logoUrl: null, hqLocation: null, websiteUrl: null, brandTheme: null });
const card = (id: string, companyId: string, cardType: Card['cardType'], summary: string | null): Card =>
  ({ id, deckId: 'deck_1', companyId, cardType, title: null, summary, tier: null, tierReason: null,
    citations: [{ title: 'example.com', url: 'https://example.com/' }] }) as Card;

describe('summaryIsUnfit', () => {
  it('flags sales lines, page-bound sentences and broken spacing', () => {
    expect(summaryIsUnfit(SALES)).toBe(true);
    expect(summaryIsUnfit(BOUND)).toBe(true);
    expect(summaryIsUnfit('Oak Branch Advisors is purpose-built for this environment.')).toBe(true);
    expect(summaryIsUnfit('Acme builds tools for teams , and more.')).toBe(true);
  });

  it('accepts a plain description', () => {
    expect(summaryIsUnfit(GOOD)).toBe(false);
    expect(summaryIsUnfit('Getaround operates a car-sharing marketplace.')).toBe(false);
  });
});

describe('providerCompanySummary — write time', () => {
  it('never takes a page-bound sentence as the company summary', () => {
    const text = 'Oak Branch Advisors is a firm that is purpose-built for this environment.';
    const grounding = extractProviderGrounding(text, { groundingChunks: [{ web: { uri: 'https://news.example/a', title: 'news.example' } }],
      groundingSupports: [{ segment: { text, startIndex: 0, endIndex: text.length }, groundingChunkIndices: [0] }] });
    expect(providerCompanySummary('Oak Branch Advisors', null, text, grounding)).toBeNull();
  });
});

describe('revalidateStoredMetrics — v2 summaries', () => {
  const snapshot = () => ({
    metricGateVersion: 1, metrics: [], dashboards: { co_alter: { cached: true }, co_good: { cached: true } } as Record<string, unknown>,
    companies: [company('co_alter', 'Alter Domus', SALES), company('co_oak', 'Oak Branch Advisors', BOUND),
      company('co_good', 'Alter Funds', GOOD), company('co_pending', 'Pending Co', UNSUPPORTED_COMPANY_SUMMARY)],
    cards: [card('c1', 'co_alter', 'company', SALES), card('c2', 'co_alter', 'culture', 'A culture note.'),
      card('c3', 'co_good', 'company', GOOD)],
  });

  it('resets unfit company and entity-card summaries to the pending placeholder', () => {
    const snap = snapshot();
    const outcome = revalidateStoredMetrics(snap);
    expect(snap.companies.map((c) => c.oneLiner)).toEqual([UNSUPPORTED_COMPANY_SUMMARY, UNSUPPORTED_COMPANY_SUMMARY, GOOD, UNSUPPORTED_COMPANY_SUMMARY]);
    expect(snap.cards[0]).toMatchObject({ summary: UNSUPPORTED_COMPANY_SUMMARY, citations: [] });
    // Signal cards keep their own copy; good summaries are untouched.
    expect(snap.cards[1]!.summary).toBe('A culture note.');
    expect(snap.cards[2]!.summary).toBe(GOOD);
    expect(outcome.resetSummaries.map((r) => r.companyId)).toEqual(['co_alter', 'co_oak']);
    // The cached dashboard restating the old copy is dropped; others stay.
    expect(snap.dashboards.co_alter).toEqual({});
    expect(snap.dashboards.co_good).toEqual({ cached: true });
  });

  it('runs through migrateSnapshot once', () => {
    const raw = { schemaVersion: 2, metricGateVersion: 1, companies: [company('co_alter', 'Alter Domus', SALES)],
      cards: [card('c1', 'co_alter', 'company', SALES)], metrics: [] } as unknown as RepoSnapshot;
    const { snapshot: migrated } = migrateSnapshot(raw);
    expect(migrated.companies[0]!.oneLiner).toBe(UNSUPPORTED_COMPANY_SUMMARY);
    expect(migrated.cards[0]!.summary).toBe(UNSUPPORTED_COMPANY_SUMMARY);
    const again = migrateSnapshot({ ...migrated, companies: [company('co_alter', 'Alter Domus', SALES)] });
    expect(again.snapshot.companies[0]!.oneLiner).toBe(SALES);
  });
});
