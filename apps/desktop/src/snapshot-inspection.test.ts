import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inspectLegacySnapshot, SnapshotInspectionError } from './snapshot-inspection';
import publicSample from '../../web/src/sample/frontier-snapshot.json';

const AT = '2026-09-30T12:00:00.000Z';
function fixture() {
  const company = {
    id: 'co_a',
    name: 'Fixture Labs',
    oneLiner: 'Synthetic company',
    logoUrl: 'https://a.example/logo.svg',
    hqLocation: null,
    websiteUrl: 'https://www.a.example/about',
    brandTheme: null,
  };
  const markets = ['a', 'b'].map((suffix) => ({
    id: `mkt_${suffix}`,
    name: `Market ${suffix}`,
    scopeDefinition: { vertical: 'Fixtures', geography: null, notes: null },
    refreshCadence: 'daily',
    createdAt: AT,
  }));
  const decks = markets.map((market) => ({
    id: `deck_${market.id}`,
    marketId: market.id,
    createdAt: AT,
    lastRefreshedAt: null,
  }));
  const cards = decks.map((deck, index) => ({
    id: `card_${index}`,
    deckId: deck.id,
    companyId: company.id,
    cardType: index ? 'infrastructure' : 'company',
    title: null,
    summary: null,
    tier: null,
    tierReason: null,
    createdAt: AT,
  }));
  const riskCard = {
    ...cards[0]!,
    id: 'card_risk',
    cardType: 'vice',
    title: 'Attributed risk',
    summary: 'Synthetic allegation',
  };
  const metric = {
    id: 'metric_a',
    companyId: company.id,
    metricType: 'arr',
    value: 0,
    confidence: 'user_verified',
    source: 'https://a.example/report',
    methodNote: 'Imported assertion',
    capturedAt: AT,
    period: '2025',
  };
  return {
    markets,
    decks,
    companies: [company],
    metrics: [metric],
    cards: [...cards, riskCard],
    viceClaims: [
      {
        id: 'vice_a',
        cardId: riskCard.id,
        claimText: 'Synthetic allegation',
        sourceUrl: 'https://a.example/news',
        capturedAt: AT,
      },
    ],
    dashboards: {
      co_a: {
        overview: { content: { prose: 'Saved dashboard, not a new fact.' }, lastRefreshedAt: AT },
      },
    },
    companyMarket: { co_a: 'Market a' },
    reports: [
      {
        id: 'report_a',
        kind: 'deck',
        subjectId: decks[0]!.id,
        title: 'Original brief',
        markdown: '```text\nKeep exact prose.\n```\n\nVERIFIED is only imported wording.',
        citations: [],
        createdAt: AT,
      },
    ],
    briefings: [
      {
        id: 'brief_a',
        marketId: markets[0]!.id,
        deckId: decks[0]!.id,
        marketName: markets[0]!.name,
        generatedAt: AT,
        windowHours: 24,
        headline: 'Saved news',
        updates: [],
        insights: [],
      },
    ],
    savedCards: [{ cardId: cards[0]!.id, savedAt: AT }],
    opportunity: { mkt_a: { markdown: 'Original whitespace analysis', citations: [], at: AT } },
    researchJobs: [
      {
        id: 'job_a',
        status: 'running',
        stage: 'metrics',
        brief: { prompt: 'Synthetic research', region: null },
        catalogNames: [],
        completedEntityNames: [],
        partialCards: [{ card: cards[0]!, company, metrics: [metric], viceClaims: [] }],
        warnings: [],
        error: null,
        createdAt: AT,
        updatedAt: AT,
      },
    ],
    threads: [
      {
        id: 'thread_a',
        scope: { kind: 'deck', deckId: decks[0]!.id },
        title: 'Saved question',
        messages: [{ id: 'message_a', role: 'assistant', text: 'Original answer', at: AT }],
        reportId: 'report_a',
        createdAt: AT,
        updatedAt: AT,
        semanticMemory: {
          threadId: 'thread_a',
          distilledFacts: [
            { id: 'fact_a', fact: 'Imported confirmation', extractedAt: AT, userVerified: true },
          ],
          lastDistilledTurnIndex: 0,
          totalTurnsDistilled: 1,
          distilledAt: AT,
        },
      },
    ],
  };
}

function expectCode(json: string, code: string) {
  try {
    inspectLegacySnapshot(json);
    throw new Error('Inspection unexpectedly accepted the input');
  } catch (error) {
    expect(error).toBeInstanceOf(SnapshotInspectionError);
    expect(error).toMatchObject({ code });
  }
}

describe('read-only staged migration inspection (not a cutover)', () => {
  it('inspects the repository public sample without keys or a vault owner', () => {
    const json = JSON.stringify(publicSample);
    const result = inspectLegacySnapshot(json);
    expect(result.originalJson).toBe(json);
    expect(result.counts.companies).toBe(publicSample.companies.length);
    expect(result.counts.cards).toBe(publicSample.cards.length);
    expect(result.canApply).toBe(false);
  });
  it.each([undefined, 1, 2])(
    'inspects every known legacy format without recovering jobs or changing the original: %s',
    (version) => {
      const source = { ...fixture(), ...(version === undefined ? {} : { schemaVersion: version }) };
      const before = structuredClone(source);
      const json = JSON.stringify(source, null, 2);
      const result = inspectLegacySnapshot(json);
      expect(source).toEqual(before);
      expect(result.source).toEqual({
        schemaVersion: version ?? 1,
        byteLength: Buffer.byteLength(json),
        sha256: createHash('sha256').update(json).digest('hex'),
      });
      expect(result.appliedVersions).toEqual(version === 2 ? [] : [1]);
      expect(result.originalJson).toBe(json);
      expect(result.snapshot.schemaVersion).toBe(2);
      expect(result.snapshot.researchJobs[0]?.status).toBe('running');
      expect(result.canApply).toBe(false);
      expect(result.proposedAuthority).toEqual({
        runnableJobs: 0,
        schedules: 0,
        grants: 0,
        budgetApprovals: 0,
        localAttestations: 0,
        requiresFreshApproval: true,
      });
    },
  );

  it('counts every family and proposes two separate memberships for the shared company', () => {
    const result = inspectLegacySnapshot(JSON.stringify(fixture()));
    expect(result.counts).toEqual({
      markets: 2,
      decks: 2,
      companies: 1,
      metrics: 1,
      cards: 3,
      viceClaims: 1,
      dashboards: 1,
      dashboardTabs: 1,
      companyMarket: 1,
      reports: 1,
      briefings: 1,
      savedCards: 1,
      opportunity: 1,
      researchJobs: 1,
      threads: 1,
    });
    expect(result.memberships).toEqual([
      { companyId: 'co_a', marketId: 'mkt_a', roles: ['company'], basis: 'card_link' },
      { companyId: 'co_a', marketId: 'mkt_b', roles: ['infrastructure'], basis: 'card_link' },
    ]);
    expect(result.review).toMatchObject({
      activeJobCount: 1,
      attributedAttestationCount: 3,
      externalLogoCount: 1,
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'authority_disabled',
        'missing_evidence',
        'scope_review',
        'missing_assets',
      ]),
    );
  });

  it('retains a pending cancellation as active during read-only inspection', () => {
    const source = fixture();
    source.researchJobs[0]!.status = 'cancelling';
    const result = inspectLegacySnapshot(JSON.stringify(source));
    expect(result.snapshot.researchJobs[0]?.status).toBe('cancelling');
    expect(result.review.activeJobCount).toBe(1);
  });

  it('retains original prose, true zero, periods and nested unknown research fields without upgrading support', () => {
    const source = fixture();
    const result = inspectLegacySnapshot(JSON.stringify(source));
    expect(result.snapshot.metrics[0]).toMatchObject({
      value: 0,
      confidence: 'user_verified',
      period: '2025',
    });
    expect(result.snapshot.reports[0]?.markdown).toBe(source.reports[0]!.markdown);
    expect(result.review.attributedAttestationCount).toBeGreaterThan(0);
    expect(result.proposedAuthority.localAttestations).toBe(0);
    expect(result.snapshot.threads[0]?.semanticMemory?.distilledFacts[0]?.userVerified).toBe(true);
    expect(result.review.supportedPassageCount).toBe(0);
  });

  it('validates without stripping nested historical fields that older schemas do not model', () => {
    const source = fixture();
    const result = inspectLegacySnapshot(
      JSON.stringify({
        ...source,
        markets: source.markets.map((row) => ({
          ...row,
          scopeDefinition: { ...row.scopeDefinition, retainedExclusions: ['Original exclusion'] },
        })),
        metrics: source.metrics.map((row) => ({
          ...row,
          conflicts: [
            {
              metricType: 'arr',
              observations: [
                { value: 1, confidence: 'estimated', source: null, capturedAt: AT, period: '2024' },
              ],
              detectedAt: AT,
              preferredObservation: 0,
            },
          ],
        })),
      }),
    );
    expect(result.snapshot.markets[0]?.scopeDefinition).toMatchObject({
      retainedExclusions: ['Original exclusion'],
    });
    expect(result.snapshot.metrics[0]?.conflicts?.[0]?.observations[0]).toMatchObject({
      period: '2024',
    });
  });

  it('preserves minimal older job history and fills only absent optional families', () => {
    const {
      reports: _reports,
      briefings: _briefings,
      savedCards: _saved,
      threads: _threads,
      opportunity: _opportunity,
      researchJobs: _jobs,
      ...old
    } = fixture();
    const result = inspectLegacySnapshot(
      JSON.stringify({ ...old, researchJobs: [{ id: 'job_older', status: 'running' }] }),
    );
    expect(result.snapshot.researchJobs[0]).toMatchObject({
      id: 'job_older',
      status: 'running',
      partialCards: [],
    });
    expect(result.counts.reports).toBe(0);
    expect(result.counts.opportunity).toBe(0);
    expect(result.originalJson).not.toContain('partialCards');
  });

  it('never merges duplicate names/domains or trusts a stale name-based market association', () => {
    const source = fixture();
    source.companies.push({ ...source.companies[0]!, id: 'co_b', websiteUrl: 'https://b.example' });
    source.companies.push({
      ...source.companies[0]!,
      id: 'co_c',
      name: 'Different name',
      websiteUrl: 'https://a.example',
    });
    source.companyMarket.co_a = 'Nonexistent market';
    const result = inspectLegacySnapshot(JSON.stringify(source));
    expect(result.snapshot.companies.map((row) => row.id)).toEqual(['co_a', 'co_b', 'co_c']);
    expect(result.identityReview).toEqual(
      expect.arrayContaining([
        { companyIds: ['co_a', 'co_b'], reason: 'same_name' },
        { companyIds: ['co_a', 'co_c'], reason: 'same_domain' },
      ]),
    );
    expect(result.memberships).toHaveLength(2);
  });

  it('flags duplicate normalized domains even when older website fields omit a URL scheme', () => {
    const source = fixture();
    source.companies[0]!.websiteUrl = 'www.a.example';
    source.companies.push({
      ...source.companies[0]!,
      id: 'co_b',
      name: 'Different name',
      websiteUrl: 'https://a.example/',
    });
    expect(inspectLegacySnapshot(JSON.stringify(source)).identityReview).toContainEqual({
      companyIds: ['co_a', 'co_b'],
      reason: 'same_domain',
    });
  });

  it('does not invent membership when a legacy market name is ambiguous', () => {
    const source = fixture();
    source.cards = [];
    source.viceClaims = [];
    source.savedCards = [];
    source.researchJobs = [];
    source.markets[1]!.name = source.markets[0]!.name;
    const result = inspectLegacySnapshot(JSON.stringify(source));
    expect(result.memberships).toEqual([]);
    expect(result.review.unresolvedCompanyMarketCount).toBe(1);
  });

  it('fails closed for future/invalid versions and unknown top-level families', () => {
    for (const schemaVersion of [0, -1, 1.5, null, '2'])
      expectCode(JSON.stringify({ ...fixture(), schemaVersion }), 'UNSUPPORTED_FORMAT');
    expectCode(
      JSON.stringify({ ...fixture(), schemaVersion: 999, futureOnly: [] }),
      'UNSUPPORTED_FORMAT',
    );
    for (const field of ['grants', 'schedules', 'budgets', 'newResearchFamily'])
      expectCode(
        JSON.stringify({ ...fixture(), [field]: [{ enabled: true }] }),
        'UNSUPPORTED_FIELD',
      );
  });

  it('rejects malformed family records rather than counting them as migrated', () => {
    expectCode(
      JSON.stringify({
        ...fixture(),
        researchJobs: [
          {
            ...fixture().researchJobs[0],
            catalog: [
              { name: 'Fixture', domain: null, descriptor: 'Synthetic', cardTypes: ['not_a_role'] },
            ],
          },
        ],
      }),
      'INVALID_RECORD',
    );
    for (const field of ['reports', 'briefings', 'savedCards', 'threads', 'researchJobs']) {
      expectCode(
        JSON.stringify({ ...fixture(), [field]: [{ id: 'incomplete' }] }),
        'INVALID_RECORD',
      );
      expectCode(JSON.stringify({ ...fixture(), [field]: 'invalid' }), 'INVALID_RECORD');
    }
    expectCode(
      JSON.stringify({ ...fixture(), dashboards: { co_a: { unknown_tab: {} } } }),
      'UNSUPPORTED_FIELD',
    );
  });

  it('rejects duplicate stable IDs and dangling relationships without echoing source values', () => {
    const source = fixture();
    source.companies.push({ ...source.companies[0]! });
    expectCode(JSON.stringify(source), 'DUPLICATE_ID');
    for (const [field, record] of [
      ['decks', { ...fixture().decks[0]!, marketId: 'private-missing-market' }],
      ['metrics', { ...fixture().metrics[0]!, companyId: 'private-missing-company' }],
      ['cards', { ...fixture().cards[0]!, deckId: 'private-missing-deck' }],
      ['savedCards', { cardId: 'private-missing-card', savedAt: AT }],
      ['reports', { ...fixture().reports[0]!, subjectId: 'private-missing-deck' }],
    ] as const) {
      try {
        inspectLegacySnapshot(JSON.stringify({ ...fixture(), [field]: [record] }));
        throw new Error('accepted');
      } catch (error) {
        expect(error).toMatchObject({ code: 'MISSING_REFERENCE' });
        expect(String(error)).not.toContain('private-missing');
      }
    }
  });

  it('rejects duplicate JSON members including escaped keys before JSON parsing loses data', () => {
    const json = JSON.stringify(fixture());
    expectCode(json.replace('"markets":', '"markets":[],"mark\\u0065ts":'), 'DUPLICATE_MEMBER');
    expectCode(
      json.replace('"name":"Fixture Labs"', '"name":"First","name":"Fixture Labs"'),
      'DUPLICATE_MEMBER',
    );
    expect(
      inspectLegacySnapshot(
        json.replace('Synthetic company', 'Text with { braces } and : punctuation'),
      ).counts.companies,
    ).toBe(1);
  });

  it('rejects malformed/deep/oversized input and structural credential fields with safe errors', () => {
    expectCode('{"private text":', 'INVALID_JSON');
    expectCode(
      JSON.stringify({
        ...fixture(),
        dashboards: {
          co_a: {
            overview: { content: { apiKey: 'synthetic-do-not-display' }, lastRefreshedAt: AT },
          },
        },
      }),
      'CREDENTIAL_FIELD',
    );
    expectCode(' '.repeat(50 * 1024 * 1024 + 1), 'SOURCE_LIMIT');
    expectCode('['.repeat(65) + '0' + ']'.repeat(65), 'SOURCE_LIMIT');
    expectCode(JSON.stringify(null), 'UNSUPPORTED_FORMAT');
    expectCode('[' + '0,'.repeat(200_000) + '0]', 'SOURCE_LIMIT');
    expectCode(JSON.stringify(fixture()).replace('"value":0', '"value":1e999'), 'INVALID_RECORD');
  });

  it('rejects duplicates inside partial job records and semantic-memory identities', () => {
    const source = fixture();
    source.researchJobs[0]!.partialCards.push(
      structuredClone(source.researchJobs[0]!.partialCards[0]!),
    );
    expectCode(JSON.stringify(source), 'DUPLICATE_ID');
    const memory = fixture();
    memory.threads[0]!.semanticMemory.distilledFacts.push(
      structuredClone(memory.threads[0]!.semanticMemory.distilledFacts[0]!),
    );
    expectCode(JSON.stringify(memory), 'DUPLICATE_ID');
  });

  it('preserves uncommitted company/deck/market results only inside their historical job', () => {
    const source = fixture();
    const partial = structuredClone(source.researchJobs[0]!.partialCards[0]!);
    source.researchJobs[0]!.partialCards = [partial];
    partial.company.id = 'co_partial';
    partial.card.companyId = 'co_partial';
    partial.card.deckId = 'deck_partial';
    partial.metrics[0]!.companyId = 'co_partial';
    const json = JSON.stringify({
      ...source,
      researchJobs: [
        {
          ...source.researchJobs[0],
          market: { ...source.markets[0], id: 'mkt_partial' },
          deck: { ...source.decks[0], id: 'deck_partial', marketId: 'mkt_partial' },
        },
      ],
    });
    const result = inspectLegacySnapshot(json);
    expect(result.counts.companies).toBe(1);
    expect(result.snapshot.companies[0]?.id).toBe('co_a');
    expect(result.snapshot.researchJobs[0]?.partialCards[0]?.company?.id).toBe('co_partial');
    expect(result.proposedAuthority.runnableJobs).toBe(0);
  });

  it('gives independent inspection copies and fingerprints exact bytes rather than normalized JSON', () => {
    const json = JSON.stringify(fixture());
    const first = inspectLegacySnapshot(json);
    const second = inspectLegacySnapshot(json);
    first.snapshot.researchJobs[0]!.status = 'cancelled';
    expect(second.snapshot.researchJobs[0]?.status).toBe('running');
    expect(inspectLegacySnapshot(` ${json}`).source.sha256).not.toBe(second.source.sha256);
  });
});
