/**
 * Assembles the full in-memory dataset from the seeds. Company-card tiers are
 * computed by the REAL scoring engine (`computeCms`) — the mock never hardcodes
 * a tier — so the fixtures exercise the same code path the back end will use.
 */
import {
  buildUserFootprintCohort,
  buildCmsInput,
  computeCms,
  type Card,
  type Company,
  type CompanyMetric,
  type DashboardContentMap,
  type Deck,
  type Market,
  type MaturityTier,
  type RefreshCadence,
  type ViceClaim,
  enforceMetricsProvenance,
} from '@mi/contracts';
import { BARRIER_SEEDS, COMPANY_SEEDS, INSIGHT_SEEDS, type CompanySeed } from './seed';
import { generateDashboardContent } from './dashboard-content';
import { id, ts } from './ids';

export interface DashboardRecord {
  content: DashboardContentMap;
  lastRefreshedAt: string;
}

export interface Dataset {
  market: Market;
  deck: Deck;
  companies: Company[];
  metrics: CompanyMetric[];
  cards: Card[];
  viceClaims: ViceClaim[];
  /** companyId → generated 8-tab content */
  dashboards: Record<string, DashboardRecord>;
}

const MARKET_SLUG = 'ca-christian-apparel';
const DEFAULT_CADENCE: RefreshCadence = 'daily';

function metricRowsFor(seed: CompanySeed): CompanyMetric[] {
  const companyId = id.company(seed.slug);
  const rows: CompanyMetric[] = [];
  for (const [metricType, m] of Object.entries(seed.metrics)) {
    if (!m) continue;
    rows.push({
      id: id.metric(seed.slug, metricType),
      companyId,
      metricType: metricType as CompanyMetric['metricType'],
      value: m.value,
      confidence: m.confidence,
      source: m.source,
      // Fixture provenance: a sourced figure gets a citation whose publisher is
      // its host, so the demo exercises the same provenance UI as live data.
      citations: m.source && /^https?:\/\//i.test(m.source)
        ? [{ title: new URL(m.source).hostname.replace(/^www\./, ''), url: m.source }]
        : [],
      methodNote: m.method,
      capturedAt: ts(0),
    });
  }
  // Same rules the live pipeline obeys — fixtures cannot claim what they can't show.
  return enforceMetricsProvenance(rows);
}

export function buildDataset(cadence: RefreshCadence = DEFAULT_CADENCE): Dataset {
  const market: Market = {
    id: id.market(MARKET_SLUG),
    name: 'Christian Apparel Companies — California',
    scopeDefinition: {
      vertical: 'Christian / faith-based apparel',
      geography: 'California, USA',
      notes: 'Sample market used to demonstrate the full deck workflow.',
    },
    refreshCadence: cadence,
    createdAt: ts(30),
  };

  const deck: Deck = {
    id: id.deck(MARKET_SLUG),
    marketId: market.id,
    createdAt: ts(30),
    lastRefreshedAt: ts(0),
  };

  const companies: Company[] = [];
  const metrics: CompanyMetric[] = [];
  const cards: Card[] = [];
  const viceClaims: ViceClaim[] = [];
  const dashboards: Record<string, DashboardRecord> = {};

  // First pass: companies + metrics; choose one comparable footprint basis for this deck.
  const seedMetrics = new Map<string, CompanyMetric[]>();
  for (const seed of COMPANY_SEEDS) {
    const company: Company = {
      id: id.company(seed.slug),
      name: seed.name,
      oneLiner: seed.oneLiner,
      logoUrl: null, // sourced by the back end's image step (spec §9); UI shows a monogram fallback
      hqLocation: seed.hq,
      websiteUrl: seed.website,
      brandTheme: seed.brand,
    };
    companies.push(company);
    const rows = metricRowsFor(seed);
    seedMetrics.set(seed.slug, rows);
    metrics.push(...rows);
  }

  const userFootprintCohort = buildUserFootprintCohort(metrics);

  // Second pass: cards (with computed tiers), vice claims, dashboards.
  for (const seed of COMPANY_SEEDS) {
    const rows = seedMetrics.get(seed.slug) ?? [];
    let companyTier: MaturityTier | null = null;
    let companyTierReason: string | null = null;

    for (const cardType of seed.cardTypes) {
      let tier: MaturityTier | null = null;
      let tierReason: string | null = null;

      if (cardType === 'company') {
        const result = computeCms(
          buildCmsInput(rows),
          { userFootprintCohort },
          { nudge: seed.nudge?.delta ?? 0, nudgeReason: seed.nudge?.reason ?? null },
        );
        tier = result.finalTier;
        tierReason = seed.nudge?.reason ?? null;
        companyTier = tier;
        companyTierReason = tierReason;
      }

      const summary =
        cardType === 'culture' ? (seed.cultureNote ?? null) : null;

      const card: Card = {
        id: id.card(MARKET_SLUG, seed.slug, cardType),
        deckId: deck.id,
        companyId: id.company(seed.slug),
        cardType,
        title: null,
        summary,
        tier,
        tierReason,
        citations: [],
        keyPoints: [],
        createdAt: ts(30),
      };
      cards.push(card);

      if (cardType === 'vice' && seed.viceClaims) {
        seed.viceClaims.forEach((vc, i) => {
          viceClaims.push({
            id: id.viceClaim(`${seed.slug}_vice`, i),
            cardId: card.id,
            claimText: vc.text,
            sourceUrl: vc.sourceUrl,
            // Fixture sources are illustrative; the publisher is the hostname.
            sourceTitle: null,
            capturedAt: ts(3),
          });
        });
      }
    }

    // Dashboard content (all 8 tabs) for every company.
    const arr = seed.metrics.arr?.value ?? null;
    const users = seed.metrics.users?.value ?? null;
    const employees = seed.metrics.employees?.value ?? null;
    dashboards[id.company(seed.slug)] = {
      content: generateDashboardContent({
        seed,
        tier: companyTier,
        arr,
        users,
        employees,
        cadence,
      }),
      lastRefreshedAt: ts(0),
    };
    void companyTierReason; // retained above on the card; not needed further here
  }

  // Insight cards: market-level findings, no company (same shape as barriers).
  for (const i of INSIGHT_SEEDS) {
    cards.push({
      id: id.card(MARKET_SLUG, i.slug, 'insight'),
      deckId: deck.id,
      companyId: null,
      cardType: 'insight',
      title: i.title,
      summary: i.summary,
      tier: null,
      tierReason: null,
      citations: [],
      keyPoints: i.keyPoints,
      createdAt: ts(30),
    });
  }

  // Barrier cards (not company-specific; spec §4).
  for (const b of BARRIER_SEEDS) {
    cards.push({
      id: id.card(MARKET_SLUG, b.slug, 'barrier'),
      deckId: deck.id,
      companyId: null,
      cardType: 'barrier',
      title: b.title,
      summary: b.summary,
      tier: null,
      tierReason: null,
      citations: [],
      keyPoints: [],
      createdAt: ts(30),
    });
  }

  return { market, deck, companies, metrics, cards, viceClaims, dashboards };
}
