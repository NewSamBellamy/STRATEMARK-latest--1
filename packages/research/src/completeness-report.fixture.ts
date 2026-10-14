/**
 * A small hand-built snapshot that exercises every completeness status and
 * every integrity smell. Used by completeness-report.test.ts.
 * Every figure here is fixture data, not research.
 */
import type { Card, Company, CompanyMetric } from '@mi/contracts';
import type { CompletenessSnapshot } from './completeness-report';

const at = '2026-10-01T00:00:00.000Z';

const company = (id: string, name: string, oneLiner: string, hqLocation: string | null, websiteUrl: string | null): Company =>
  ({ id, name, oneLiner, hqLocation, websiteUrl, logoUrl: null, brandTheme: null });

const card = (id: string, companyId: string | null, cardType: Card['cardType']): Card => ({
  id, deckId: 'deck_fx', companyId, cardType, title: null, summary: null, tier: null, tierReason: null,
  citations: [], keyPoints: [], createdAt: at,
});

const metric = (companyId: string, metricType: CompanyMetric['metricType'], value: number | null,
  confidence: CompanyMetric['confidence'], extra: Partial<CompanyMetric> = {}): CompanyMetric => ({
  id: `met_${companyId}_${metricType}`, companyId, metricType, value, confidence,
  source: null, citations: [], methodNote: null, capturedAt: at, ...extra,
});

export function completenessFixture(): CompletenessSnapshot {
  return {
    markets: [{ id: 'mkt_fx', name: 'Fixture Robotics', createdAt: at, refreshCadence: 'weekly',
      scopeDefinition: { vertical: 'Robotics', geography: null, notes: null } }],
    decks: [{ id: 'deck_fx', marketId: 'mkt_fx', createdAt: at, lastRefreshedAt: null }],
    companies: [
      // Operating company with most slots filled.
      company('acme', 'Acme Robotics', 'Acme Robotics builds autonomous warehouse robots.', 'San Francisco, CA', 'https://acme.example'),
      // Asset manager → financial_firm profile → AUM slot applies, users/ARR-first slots do not.
      company('beta', 'Beta Capital', 'Beta Capital is a venture capital firm investing in robotics.', 'London, United Kingdom', null),
      // Marketing-copy description with bad spacing.
      company('gamma', 'Gamma Shop', 'Discover the best robot gadgets .', 'Austin, TX', 'https://gamma.example'),
      // Only reachable through a signal card: never scored.
      company('vice_entity', 'Acme Safety Controversy', 'A controversy.', null, null),
    ],
    cards: [
      card('card_acme', 'acme', 'company'),
      card('card_acme_infra', 'acme', 'infrastructure'),
      card('card_beta', 'beta', 'company'),
      card('card_gamma', 'gamma', 'company'),
      card('card_vice', 'vice_entity', 'vice'),
      card('card_barrier', null, 'barrier'),
    ],
    metrics: [
      // Human-entered: survives the facts projection → filled.
      metric('acme', 'employees', 1200, 'user_verified', { source: 'Analyst confirmed' }),
      // Stored "verified" with no citation: the read path withholds it → tried, unknown; ledger smell.
      metric('acme', 'arr', 50_000_000, 'verified'),
      metric('beta', 'aum', 42_000_000_000, 'user_verified', { source: 'Analyst confirmed' }),
      // Same headcount as Acme → identical-value smell.
      metric('beta', 'employees', 1200, 'user_verified', { source: 'Analyst confirmed' }),
      // Unknown that still stores a number → smell.
      metric('gamma', 'employees', 50, 'unknown'),
      // Market-cap computation lane: estimated, cites a retained original, no as-of date → shown, smell.
      metric('gamma', 'market_cap', 900_000_000, 'estimated', {
        citations: [{ title: 'quotes.example', url: 'https://quotes.example/gamma' }], source: 'https://quotes.example/gamma',
        methodNote: 'Computed from a retained share count and quote.', passageSupport: null, reportedSupport: null,
      }),
    ],
    dashboards: {
      acme: {
        history: { lastRefreshedAt: at, content: { founderStory: '', quotes: [], timeline: [
          { date: '2015', title: 'Acme Robotics founded', detail: 'Founded in Oakland.' },
          { date: '2019', title: 'Series B', detail: '' },
        ] } },
        // Researched, came back empty → team tried, nothing found.
        team_org: { lastRefreshedAt: at, content: { nodes: [] } },
        live_intel: { lastRefreshedAt: at, content: { items: [{ id: 'n1' }, { id: 'n2' }], cadence: 'weekly', lastRefreshedAt: at } },
      },
      beta: {
        team_org: { lastRefreshedAt: at, content: [{ id: 'p1', name: 'Pat', role: 'GP' }, { id: 'p2', name: 'Lee', role: 'GP' }] },
      },
    },
    companyMarket: { acme: 'mkt_fx', beta: 'mkt_fx', gamma: 'mkt_fx', vice_entity: 'mkt_fx' },
    researchEvidence: [
      // A broad profile pass for Gamma: every metric slot it left empty was tried, but not targeted.
      { id: 'ev_gamma', companyId: 'gamma', companyName: 'Gamma Shop', topic: 'company_profile', capturedAt: at,
        text: 'Gamma Shop sells robot gadgets online.', citations: [{ title: 'gamma.example', url: 'https://gamma.example' }], queries: [] },
    ],
    originalSourceAttempts: [
      // A targeted users read for Acme that was blocked.
      { id: 'src_acme_users', companyId: 'acme', metricType: 'users', capturedAt: at,
        receipts: [{ requestedUrl: 'https://acme.example/customers', status: 'blocked', retrievedAt: at, reason: 'HTTP 403' }] },
      // The original behind Gamma's market cap (unavailable today, still the cited page).
      { id: 'src_gamma_cap', companyId: 'gamma', metricType: 'market_cap', capturedAt: at,
        receipts: [{ requestedUrl: 'https://quotes.example/gamma', status: 'unavailable', retrievedAt: at, reason: 'timeout' }] },
    ],
  };
}
