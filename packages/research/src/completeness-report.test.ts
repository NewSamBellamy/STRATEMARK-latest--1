/**
 * The completeness scoreboard: per-slot filled / tried-empty / never-tried,
 * receipts behind each attempt, aggregates, top gaps and integrity smells.
 */
import { describe, expect, it } from 'vitest';
import { PROFILE_CORE_SLOTS } from '@mi/contracts';
import { buildCompletenessReport, completenessSlotsFor, renderCompletenessTable, type CompanyCompletenessReport } from './completeness-report';
import { completenessFixture } from './completeness-report.fixture';
import { displayedCompanyFacts } from './displayed-facts';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const statusOf = (company: CompanyCompletenessReport, key: string) => company.slots.find((slot) => slot.key === key)?.status;
const slotOf = (company: CompanyCompletenessReport, key: string) => company.slots.find((slot) => slot.key === key)!;

describe('buildCompletenessReport', () => {
  const report = buildCompletenessReport(completenessFixture());
  const deck = report.decks[0]!;
  const byId = (id: string) => deck.companies.find((company) => company.companyId === id)!;

  it('scores entity companies only, once per deck, and never signal cards', () => {
    expect(deck.companies.map((company) => company.companyId).sort()).toEqual(['acme', 'beta', 'gamma']);
    expect(byId('acme').cardTypes).toEqual(['company', 'infrastructure']);
    expect(report.companies).toBe(3);
  });

  it('derives metric slots from the market profile table, not a parallel list', () => {
    expect(byId('acme').profile).toBe('operating_company');
    expect(byId('beta').profile).toBe('financial_firm');
    const metricKeys = (company: CompanyCompletenessReport) => company.slots.filter((slot) => slot.group === 'metric').map((slot) => slot.key);
    expect(metricKeys(byId('acme'))).toEqual(PROFILE_CORE_SLOTS.operating_company.map((slot) => `metric.${slot.join('|')}`));
    expect(metricKeys(byId('beta'))).toEqual(PROFILE_CORE_SLOTS.financial_firm.map((slot) => `metric.${slot.join('|')}`));
    expect(completenessSlotsFor('financial_firm').map((slot) => slot.key)).toContain('metric.aum');
    expect(completenessSlotsFor('operating_company').map((slot) => slot.key)).not.toContain('metric.aum');
  });

  it('reports identity, description, team, history, products and news', () => {
    const acme = byId('acme');
    expect(slotOf(acme, 'identity.website').value).toBe('https://acme.example');
    expect(slotOf(acme, 'identity.hq').value).toBe('San Francisco, CA');
    expect(slotOf(acme, 'identity.founded').value).toBe('2015 (history tab)');
    expect(statusOf(acme, 'description')).toBe('filled');
    expect(slotOf(acme, 'history').value).toBe('2 events');
    expect(slotOf(acme, 'news').value).toBe('2 items');
    // Team tab researched and came back empty: tried, nothing found.
    expect(statusOf(acme, 'team')).toBe('unknown_attempted');
    expect(slotOf(acme, 'team').attempts.cachedTab).toBe(true);
    // Products: nothing ever tried.
    expect(statusOf(acme, 'products')).toBe('unknown_never_attempted');
    // A bare team list (the tolerant schema's preprocess shape) still counts people.
    expect(slotOf(byId('beta'), 'team').value).toBe('2 people');
    expect(statusOf(byId('beta'), 'identity.website')).toBe('unknown_never_attempted');
  });

  it('tells filled, tried-empty and never-tried metric slots apart, with receipts', () => {
    const acme = byId('acme');
    expect(statusOf(acme, 'metric.employees')).toBe('filled');
    // A stored "verified" figure without proof is withheld by the read path.
    const revenue = slotOf(acme, 'metric.arr|revenue|funding_total');
    expect(revenue.status).toBe('unknown_attempted');
    expect(revenue.withheld).toBe(true);
    expect(revenue.note).toMatch(/^Stored ARR 50,000,000 \(verified\) withheld/);
    // A targeted, blocked page read.
    const users = slotOf(acme, 'metric.users|distribution');
    expect(users.status).toBe('unknown_attempted');
    expect(users.attempts).toMatchObject({ targeted: true, originalAttempts: 1, receipts: { retrieved: 0, blocked: 1, unavailable: 0 }, topics: ['users'] });
    expect(statusOf(acme, 'metric.valuation|market_cap|last_round|funding_total')).toBe('unknown_never_attempted');

    // Gamma: a broad company_profile pass touched every metric slot, but aimed at none.
    const gammaUsers = slotOf(byId('gamma'), 'metric.users|distribution');
    expect(gammaUsers.status).toBe('unknown_attempted');
    expect(gammaUsers.attempts).toMatchObject({ targeted: false, evidenceRecords: 1, topics: ['company_profile'] });
    // The market-cap computation lane survives projection → filled.
    expect(slotOf(byId('gamma'), 'metric.valuation|market_cap|last_round|funding_total').value).toBe('Market Cap 900,000,000 (estimated)');

    const beta = byId('beta');
    expect(statusOf(beta, 'metric.aum')).toBe('filled');
    expect(statusOf(beta, 'metric.valuation|market_cap')).toBe('unknown_never_attempted');
  });

  it('aggregates per deck and per slot, and ranks gaps by companies affected', () => {
    expect(deck.totals).toEqual({ slots: 36, filled: 16, unknownAttempted: 7, unknownNeverAttempted: 13, fillPct: 44.4 });
    expect(report.totals).toEqual(deck.totals);
    const employees = report.bySlot.find((row) => row.key === 'metric.employees')!;
    // Gamma's ledger row is Unknown (with a stray value): tried, but not a withheld finding.
    expect(employees).toMatchObject({ applicable: 3, filled: 2, unknownAttempted: 1, unknownNeverAttempted: 0, withheld: 0, fillPct: 66.7 });
    expect(report.topGaps[0]).toMatchObject({ key: 'products', companiesAffected: 3, unknownNeverAttempted: 3, neverTargeted: 3 });
    const revenue = report.topGaps.find((gap) => gap.key === 'metric.arr|revenue|funding_total')!;
    expect(revenue).toMatchObject({ companiesAffected: 2, unknownAttempted: 2, withheld: 1, neverTargeted: 1 });
    for (let i = 1; i < report.topGaps.length; i += 1) {
      expect(report.topGaps[i - 1]!.companiesAffected).toBeGreaterThanOrEqual(report.topGaps[i]!.companiesAffected);
    }
  });

  it('reports data-integrity smells', () => {
    const kinds = (kind: string) => report.smells.filter((smell) => smell.kind === kind);
    expect(kinds('stored_figure_without_citation')).toEqual([expect.objectContaining({ companyIds: ['acme'], metricType: 'arr', displayed: false })]);
    expect(kinds('unknown_with_value')).toEqual([expect.objectContaining({ companyIds: ['gamma'], metricType: 'employees' })]);
    expect(kinds('estimated_without_date')).toEqual([expect.objectContaining({ companyIds: ['gamma'], metricType: 'market_cap', displayed: true })]);
    expect(kinds('identical_value_across_companies')).toEqual([expect.objectContaining({ companyIds: ['acme', 'beta'], metricType: 'employees' })]);
    expect(kinds('description_sales_verb').map((smell) => smell.companyIds)).toEqual([['gamma']]);
    expect(kinds('description_spacing').map((smell) => smell.companyIds)).toEqual([['gamma']]);
    expect(kinds('hq_format_inconsistent')).toHaveLength(1);
    expect(kinds('hq_format_inconsistent')[0]!.detail).toContain('"London, United Kingdom"');
    // Human-entered figures are never flagged for lacking a citation.
    expect(report.smells.some((smell) => smell.kind === 'stored_figure_without_citation' && smell.companyIds.includes('beta'))).toBe(false);
  });

  it('filters by deck and tolerates an empty or partial snapshot', () => {
    expect(buildCompletenessReport(completenessFixture(), { deckIds: ['nope'] }).decks).toEqual([]);
    const empty = buildCompletenessReport({});
    expect(empty).toMatchObject({ companies: 0, decks: [], topGaps: [], smells: [] });
    expect(empty.caveats[0]).toMatch(/originalSourceAttempts/);
  });

  it('renders a compact table', () => {
    const table = renderCompletenessTable(report);
    expect(table).toContain('DECK Fixture Robotics [deck_fx]  3 companies  44.4% filled');
    expect(table).toMatch(/Acme Robotics\s+# {3}# {3}# {3}# {3}# {3}o {3}o {3}\. {3}o {3}# {3}\. {3}# {4}7\/12/);
    expect(table).toContain('TOP GAPS');
    expect(table).toContain('[hq_format_inconsistent]');
    // A deck with no measured run (built before the ledger) shows no RUN line.
    expect(table).not.toContain('RUN ');
  });

  it('prints the measured time and spend of a deck right under its fill', () => {
    const measured = buildCompletenessReport({
      ...completenessFixture(),
      deckRun: { deck_fx: { submittedAt: '2026-10-14T20:00:00.000Z', leadCardAt: '2026-10-14T20:00:30.000Z', deckReadyAt: '2026-10-14T20:02:00.000Z',
        usage: { calls: 40, inputTokens: 300_000, outputTokens: 50_000, searchQueries: 20, estCostUsd: 0.74 } } },
    });
    const lines = renderCompletenessTable(measured).split('\n');
    const at = lines.findIndex((line) => line.startsWith('DECK Fixture Robotics'));
    expect(lines[at + 1]).toBe('  RUN first card 30s · deck 2m00s · warm-up n/a · 40 calls · 300k in / 50k out tokens · 20 searches · est $0.74');
  });
});

describe('displayedCompanyFacts', () => {
  it('matches what the repository serves through getCompanyFacts', async () => {
    const fixture = completenessFixture();
    const snapshot = { ...fixture, viceClaims: [], reports: [], briefings: [], savedCards: [], opportunity: {}, researchJobs: [],
      threads: [] } as unknown as RepoSnapshot;
    const client: LlmClient = { ground: () => Promise.reject(new Error('offline')), structure: () => Promise.reject(new Error('offline')) };
    const now = new Date('2026-10-20T12:00:00Z');
    const repo = new GeminiRepository({ apiKey: 'test', client, store: { read: () => structuredClone(snapshot), write: () => undefined }, now: () => now });
    for (const company of fixture.companies!) {
      const served = await repo.getCompanyFacts(company.id);
      const others = fixture.companies!.filter((c) => c.id !== company.id);
      const pure = displayedCompanyFacts({ company, metrics: fixture.metrics!, attempts: fixture.originalSourceAttempts!,
        evidence: fixture.researchEvidence!, otherCompanies: others.map((c) => c.name),
        rivalWebsites: others.flatMap((c) => c.websiteUrl ?? []), now });
      expect(pure).toEqual(served);
    }
  });
});
