/**
 * Seed data for the sample market: "Christian apparel companies in California"
 * (the spec's own example). All companies here are FICTIONAL sample data used to
 * exercise the UI end-to-end — never presented as real. Confidence tags and
 * estimate method-notes mirror how the real research pipeline will annotate data.
 */
import type { BrandTheme, CardType, Confidence, MetricType } from '@mi/contracts';

export interface MetricSeed {
  value: number | null;
  confidence: Confidence;
  source: string | null;
  method: string | null;
}

export interface ViceClaimSeed {
  text: string;
  sourceUrl: string;
}

export interface CompanySeed {
  slug: string;
  name: string;
  oneLiner: string;
  hq: string;
  website: string;
  brand: BrandTheme;
  /** Which card types this company appears on (spec §4 — a company can be on several). */
  cardTypes: CardType[];
  metrics: Partial<Record<MetricType, MetricSeed>>;
  /** Optional LLM review nudge for the Company card (spec §6.3). */
  nudge?: { delta: -1 | 0 | 1; reason: string };
  /** Populated for companies that also carry a Vice card. */
  viceClaims?: ViceClaimSeed[];
  /** Marketing hook shown as an extra fact on the culture card, if any. */
  cultureNote?: string;
}

export interface BarrierSeed {
  slug: string;
  title: string;
  summary: string;
  category: 'regulatory' | 'capital' | 'network_effects' | 'brand_trust' | 'supply_chain';
}

// Helpers to keep the metric table readable.
const v = (value: number, source: string): MetricSeed => ({
  value,
  confidence: 'verified',
  source,
  method: null,
});
const e = (value: number, method: string): MetricSeed => ({
  value,
  confidence: 'estimated',
  source: null,
  method,
});
const u = (): MetricSeed => ({ value: null, confidence: 'unknown', source: null, method: null });

function theme(
  primary: string,
  secondary: string,
  accent: string,
  opts: Partial<Pick<BrandTheme, 'text' | 'background' | 'fontFamily'>> = {},
): BrandTheme {
  return {
    primary,
    secondary,
    accent,
    text: opts.text ?? '#0f172a',
    background: opts.background ?? '#ffffff',
    fontFamily: opts.fontFamily ?? null,
    source: 'scraped',
  };
}

export const COMPANY_SEEDS: CompanySeed[] = [
  // ---- Tier 1: Formation ----------------------------------------------------
  {
    slug: 'crossthread-labs',
    name: 'CrossThread Labs',
    oneLiner: 'Pre-launch studio prototyping AI-designed scripture-verse apparel.',
    hq: 'Pasadena, CA',
    website: 'https://example.com/crossthread',
    brand: theme('#4f46e5', '#a5b4fc', '#f59e0b'),
    cardTypes: ['company'],
    metrics: {
      market_share: v(0, 'No measurable share; pre-launch.'),
      valuation: e(3_000_000, 'Angel pre-seed SAFE cap; not a priced round.'),
      arr: v(0, 'Pre-revenue per founder statement.'),
      users: e(400, 'Waitlist signups from landing page.'),
      employees: v(3, 'Team page headcount.'),
    },
  },
  {
    slug: 'seraph-studio',
    name: 'Seraph Studio',
    oneLiner: 'Experimental faith-forward streetwear concepts; no product shipped yet.',
    hq: 'Long Beach, CA',
    website: 'https://example.com/seraph',
    brand: theme('#0ea5e9', '#7dd3fc', '#f43f5e'),
    cardTypes: ['company'],
    metrics: {
      market_share: v(0, 'Pre-product.'),
      valuation: u(),
      arr: v(0, 'Pre-revenue.'),
      users: e(120, 'Instagram followers as a proxy for early interest.'),
      employees: v(2, 'Founders only.'),
    },
  },
  // ---- Tier 2: Early Traction ----------------------------------------------
  {
    slug: 'grace-threads',
    name: 'Grace Threads',
    oneLiner: 'Direct-to-consumer basics with hand-lettered scripture graphics.',
    hq: 'Fresno, CA',
    website: 'https://example.com/gracethreads',
    brand: theme('#059669', '#6ee7b7', '#f59e0b'),
    cardTypes: ['company', 'culture'],
    metrics: {
      market_share: e(0.2, 'Relative positioning language in niche press.'),
      valuation: e(12_000_000, 'Seed round size × stage-typical multiple.'),
      arr: e(600_000, 'Shopify app-rank + review velocity proxy.'),
      users: e(9_000, 'Email list size cited in a founder podcast.'),
      employees: v(12, 'LinkedIn headcount.'),
    },
    cultureNote: 'Donates 10% of profits to a Central Valley refugee ministry.',
  },
  {
    slug: 'ekklesia-wear',
    name: 'Ekklesia Wear',
    oneLiner: 'Small-batch tees celebrating early-church history.',
    hq: 'Sacramento, CA',
    website: 'https://example.com/ekklesia',
    brand: theme('#7c3aed', '#c4b5fd', '#22d3ee'),
    cardTypes: ['company'],
    metrics: {
      market_share: v(0.3, 'Category tracker snapshot.'),
      valuation: e(9_000_000, 'Pre-seed SAFE cap.'),
      arr: e(450_000, 'Estimated from order-volume mentions.'),
      users: u(),
      employees: v(9, 'Company site team page.'),
    },
  },
  {
    slug: 'salt-light-apparel',
    name: 'Salt & Light Apparel',
    oneLiner: 'Minimalist faith basics sold at pop-up markets and online.',
    hq: 'San Diego, CA',
    website: 'https://example.com/saltlight',
    brand: theme('#ea580c', '#fdba74', '#0ea5e9'),
    cardTypes: ['company'],
    metrics: {
      market_share: e(0.15, 'Niche relative positioning.'),
      valuation: e(7_000_000, 'Seed cap estimate.'),
      arr: e(800_000, 'Marketplace revenue signals.'),
      users: e(14_000, 'Combined social + email reach.'),
      employees: v(15, 'LinkedIn.'),
    },
  },
  // ---- Tier 3: Emerging -----------------------------------------------------
  {
    slug: 'anchored-co',
    name: 'Anchored Co.',
    oneLiner: 'Coastal-inspired faith apparel with a strong DTC funnel.',
    hq: 'Huntington Beach, CA',
    website: 'https://example.com/anchored',
    brand: theme('#0d9488', '#5eead4', '#f97316'),
    cardTypes: ['company'],
    metrics: {
      market_share: v(1.1, 'Category analyst snapshot.'),
      valuation: v(42_000_000, 'Series A priced round (press release).'),
      arr: v(3_200_000, 'Disclosed at Series A.'),
      users: e(65_000, 'App installs + email list.'),
      employees: v(48, 'LinkedIn headcount.'),
    },
  },
  {
    slug: 'kingdom-culture',
    name: 'Kingdom Culture',
    oneLiner: 'Streetwear brand blending worship-music culture with fashion drops.',
    hq: 'Los Angeles, CA',
    website: 'https://example.com/kingdomculture',
    brand: theme('#db2777', '#f9a8d4', '#3b82f6', { text: '#111827' }),
    cardTypes: ['company', 'culture'],
    metrics: {
      market_share: e(0.9, 'Relative buzz vs. peers.'),
      valuation: v(38_000_000, 'Series A (Crunchbase-style disclosure).'),
      arr: e(2_600_000, 'Drop sell-through × cadence.'),
      users: e(120_000, 'Social following across platforms.'),
      employees: v(40, 'LinkedIn.'),
    },
    cultureNote: 'Runs a free apprenticeship for at-risk youth in South LA.',
  },
  // ---- Tier 4: Growth -------------------------------------------------------
  {
    slug: 'faithful-fit',
    name: 'Faithful Fit',
    oneLiner: 'Faith-based activewear scaling through gym and church partnerships.',
    hq: 'Irvine, CA',
    website: 'https://example.com/faithfulfit',
    brand: theme('#2563eb', '#93c5fd', '#f59e0b'),
    cardTypes: ['company'],
    metrics: {
      market_share: v(3.1, 'Category report.'),
      valuation: v(140_000_000, 'Series B priced round.'),
      arr: v(14_000_000, 'Disclosed at Series B.'),
      users: e(300_000, 'App + loyalty program members.'),
      employees: v(180, 'LinkedIn.'),
    },
  },
  {
    slug: 'testify-clothing',
    name: 'Testify Clothing',
    oneLiner: 'Story-driven apparel line with a fast-growing wholesale channel.',
    hq: 'Riverside, CA',
    website: 'https://example.com/testify',
    brand: theme('#c026d3', '#f0abfc', '#14b8a6'),
    cardTypes: ['company'],
    metrics: {
      market_share: e(2.4, 'Relative wholesale footprint.'),
      valuation: v(95_000_000, 'Series B (press).'),
      arr: v(9_500_000, 'Disclosed.'),
      users: u(),
      employees: v(120, 'LinkedIn.'),
    },
  },
  // ---- Tier 5: Breakout -----------------------------------------------------
  {
    slug: 'holy-hype',
    name: 'Holy Hype',
    oneLiner: 'Viral drop model rewriting how faith fashion reaches Gen Z.',
    hq: 'Los Angeles, CA',
    website: 'https://example.com/holyhype',
    brand: theme('#e11d48', '#fda4af', '#0ea5e9', { text: '#111827' }),
    cardTypes: ['company', 'vice'],
    metrics: {
      market_share: e(6.8, 'Growth rate weighted over absolute share (spec §6.2).'),
      valuation: v(520_000_000, 'Series C priced round.'),
      arr: v(41_000_000, 'Disclosed at Series C.'),
      users: e(1_400_000, 'App installs + social reach.'),
      employees: v(620, 'LinkedIn.'),
    },
    nudge: {
      delta: 1,
      reason:
        'Rules place it at Growth, but share is compounding >120% YoY per category report — nudged to Breakout.',
    },
    viceClaims: [
      {
        text: 'Named in a 2025 class-action alleging deceptive "limited drop" scarcity marketing.',
        sourceUrl: 'https://example.com/press/holyhype-classaction',
      },
      {
        text: 'Founder criticized publicly for undisclosed paid-influencer promotions.',
        sourceUrl: 'https://example.com/press/holyhype-ftc-questions',
      },
    ],
  },
  {
    slug: 'revival-threads',
    name: 'Revival Threads',
    oneLiner: 'Community-commerce brand turning church small-groups into micro-retailers.',
    hq: 'Anaheim, CA',
    website: 'https://example.com/revival',
    brand: theme('#7c3aed', '#c4b5fd', '#f59e0b'),
    cardTypes: ['company'],
    metrics: {
      market_share: e(5.2, 'Fast share gains per analyst note.'),
      valuation: v(410_000_000, 'Series C.'),
      arr: v(33_000_000, 'Disclosed.'),
      users: e(900_000, 'Registered micro-retailer + buyer accounts.'),
      employees: v(430, 'LinkedIn.'),
    },
  },
  // ---- Tier 6: Scale --------------------------------------------------------
  {
    slug: 'crown-cross',
    name: 'Crown & Cross',
    oneLiner: 'National faith-lifestyle brand with omnichannel distribution.',
    hq: 'Los Angeles, CA',
    website: 'https://example.com/crowncross',
    brand: theme('#b91c1c', '#fca5a5', '#eab308'),
    cardTypes: ['company'],
    metrics: {
      market_share: v(12.5, 'Category report.'),
      valuation: v(4_800_000_000, 'Late-stage private round.'),
      arr: v(160_000_000, 'Reported.'),
      users: e(3_200_000, 'Loyalty members + app.'),
      employees: v(2_100, 'LinkedIn.'),
    },
  },
  {
    slug: 'everyday-faith-co',
    name: 'Everyday Faith Co.',
    oneLiner: 'Newly public faith-apparel platform with a strong retail presence.',
    hq: 'San Jose, CA',
    website: 'https://example.com/everydayfaith',
    brand: theme('#0f766e', '#5eead4', '#f59e0b'),
    cardTypes: ['company'],
    metrics: {
      market_share: v(10.8, 'Category report.'),
      market_cap: v(3_400_000_000, 'Post-IPO market cap (public filing).'),
      arr: v(145_000_000, '10-K annual revenue.'),
      users: e(2_800_000, 'Reported active accounts.'),
      employees: v(1_650, '10-K headcount.'),
    },
  },
  // ---- Tier 7: Category Leader ---------------------------------------------
  {
    slug: 'cornerstone-apparel',
    name: 'Cornerstone Christian Apparel',
    oneLiner: 'Decades-old faith-apparel manufacturer with wide but flattening reach.',
    hq: 'Ontario, CA',
    website: 'https://example.com/cornerstone',
    brand: theme('#1e3a8a', '#93c5fd', '#b45309'),
    cardTypes: ['company'],
    metrics: {
      market_share: v(24, 'Category report (share flat 3 years).'),
      market_cap: v(18_000_000_000, 'Public filing.'),
      arr: v(420_000_000, '10-K.'),
      users: e(6_500_000, 'Estimated customer base.'),
      employees: v(7_200, '10-K.'),
    },
    nudge: {
      delta: 0,
      reason:
        'Market cap alone implies Titan-adjacent, but share has been flat/declining for 3 years — rules-based Legacy Incumbent confirmed, no nudge.',
    },
  },
  {
    slug: 'covenant-clothing-group',
    name: 'Covenant Clothing Group',
    oneLiner: 'Established multi-brand faith-apparel holding company.',
    hq: 'Bakersfield, CA',
    website: 'https://example.com/covenant',
    brand: theme('#334155', '#94a3b8', '#eab308'),
    cardTypes: ['company', 'vice'],
    metrics: {
      market_share: v(21, 'Category report.'),
      market_cap: v(22_000_000_000, 'Public filing.'),
      arr: v(510_000_000, '10-K.'),
      users: u(),
      employees: v(8_400, '10-K.'),
    },
    viceClaims: [
      {
        text: 'Settled a 2024 labor-practices complaint at an overseas contract facility.',
        sourceUrl: 'https://example.com/press/covenant-labor-settlement',
      },
    ],
  },
  // ---- Tier 8: Market Defining ---------------------------------------------
  {
    slug: 'gracewear-global',
    name: 'GraceWear Global',
    oneLiner: 'Category-defining faith-lifestyle behemoth with worldwide distribution.',
    hq: 'Los Angeles, CA',
    website: 'https://example.com/gracewear',
    brand: theme('#111827', '#6b7280', '#f59e0b', { background: '#0b1220', text: '#f8fafc' }),
    cardTypes: ['company'],
    metrics: {
      market_share: v(46, 'Category report — clear category leader.'),
      market_cap: v(120_000_000_000, 'Public filing.'),
      arr: v(6_200_000_000, '10-K.'),
      users: e(48_000_000, 'Estimated global customer base.'),
      employees: v(62_000, '10-K.'),
    },
  },
  {
    slug: 'proclaim-worldwide',
    name: 'Proclaim Worldwide',
    oneLiner: 'Mega-cap faith-apparel and media conglomerate.',
    hq: 'Los Angeles, CA',
    website: 'https://example.com/proclaim',
    brand: theme('#1f2937', '#9ca3af', '#38bdf8', { background: '#0b1220', text: '#f8fafc' }),
    cardTypes: ['company'],
    metrics: {
      market_share: v(41, 'Category report.'),
      market_cap: v(88_000_000_000, 'Public filing.'),
      arr: v(5_100_000_000, '10-K.'),
      users: e(39_000_000, 'Estimated customer base.'),
      employees: v(54_000, '10-K.'),
    },
  },
  // ---- Infrastructure (not market participants; spec §4) -------------------
  {
    slug: 'threadforge',
    name: 'ThreadForge Manufacturing',
    oneLiner: 'On-demand apparel manufacturing powering many faith brands.',
    hq: 'Vernon, CA',
    website: 'https://example.com/threadforge',
    brand: theme('#475569', '#94a3b8', '#f97316'),
    cardTypes: ['infrastructure'],
    metrics: {
      arr: e(60_000_000, 'Estimated from client roster + volume.'),
      employees: v(900, 'LinkedIn.'),
    },
  },
  {
    slug: 'printpress-pod',
    name: 'PrintPress POD',
    oneLiner: 'Print-on-demand platform integrated with faith-brand storefronts.',
    hq: 'Santa Ana, CA',
    website: 'https://example.com/printpress',
    brand: theme('#0369a1', '#7dd3fc', '#f59e0b'),
    cardTypes: ['infrastructure'],
    metrics: {
      arr: e(28_000_000, 'Estimated GMV take-rate.'),
      employees: v(340, 'LinkedIn.'),
    },
  },
  // ---- Distribution (channel access; spec §4) ------------------------------
  {
    slug: 'faith-marketplace',
    name: 'Faith Marketplace',
    oneLiner: 'Online marketplace aggregating Christian apparel brands.',
    hq: 'San Francisco, CA',
    website: 'https://example.com/faithmarketplace',
    brand: theme('#9333ea', '#d8b4fe', '#22c55e'),
    cardTypes: ['distribution'],
    metrics: {
      arr: e(45_000_000, 'Estimated marketplace take-rate.'),
      users: e(2_100_000, 'Marketplace shopper accounts.'),
      employees: v(260, 'LinkedIn.'),
    },
  },
  {
    slug: 'sanctuary-retail',
    name: 'Sanctuary Retail Co.',
    oneLiner: 'Brick-and-mortar retail chain carrying faith-apparel lines.',
    hq: 'Modesto, CA',
    website: 'https://example.com/sanctuaryretail',
    brand: theme('#166534', '#86efac', '#eab308'),
    cardTypes: ['distribution'],
    metrics: {
      arr: e(120_000_000, 'Estimated store revenue.'),
      employees: v(1_400, 'LinkedIn.'),
    },
  },
];

export const BARRIER_SEEDS: BarrierSeed[] = [
  {
    slug: 'brand-trust',
    title: 'Faith-Authenticity Trust Barrier',
    summary:
      'New entrants must earn credibility with faith communities; perceived inauthenticity is punished quickly, making brand trust a durable moat for incumbents.',
    category: 'brand_trust',
  },
  {
    slug: 'licensing',
    title: 'Scripture & Artwork Licensing',
    summary:
      'Use of certain translations, artwork, and ministry partnerships requires licensing agreements, raising the cost and complexity of catalog expansion.',
    category: 'regulatory',
  },
  {
    slug: 'supply-chain',
    title: 'Ethical Supply-Chain Expectations',
    summary:
      'Faith consumers increasingly expect demonstrably ethical sourcing, which raises capital intensity and audit burden versus generic apparel.',
    category: 'supply_chain',
  },
];

/**
 * Market-level Insight seeds. In a live run these come from the same grounded
 * pass as barriers; the demo fixture carries its own so the card type is
 * exercised end-to-end (and so the demo deck isn't missing a whole tab).
 *
 * These are illustrative fixture copy for a fictional market, not researched
 * claims — the same standing as every other value in this file.
 */
export interface InsightSeed {
  slug: string;
  title: string;
  summary: string;
  keyPoints: string[];
}

export const INSIGHT_SEEDS: InsightSeed[] = [
  {
    slug: 'wholesale-inversion',
    title: 'Wholesale is quietly outgrowing DTC',
    summary:
      'The loudest brands in this market are direct-to-consumer, but the fastest revenue growth sits with the quieter labels selling through church bookstores and conference channels — a distribution advantage that does not show up in social following.',
    keyPoints: [
      'Fixture example: wholesale accounts reorder on a season calendar, which smooths revenue versus the spike-and-trough pattern of drop-based DTC.',
      'Fixture example: conference and bookstore channels reach buyers who never see brand social content, so follower counts systematically undercount this segment.',
      'Fixture example: the two fastest-growing labels in this sample both added a dedicated wholesale rep before adding any paid social spend.',
    ],
  },
  {
    slug: 'youth-price-ceiling',
    title: 'The youth segment has a hard price ceiling',
    summary:
      'Brands targeting under-25 buyers cluster tightly under a $40 unit price regardless of margin structure, which caps how far premium positioning can travel down the age curve.',
    keyPoints: [
      'Fixture example: every under-25-focused label in this sample prices tees between $24 and $38 — none above $40.',
      'Fixture example: the premium labels that do clear $50 skew their buyer base visibly older in community photos and event lineups.',
      'Fixture example: bundle mechanics (2-for) appear almost exclusively in the youth segment, a margin-preserving answer to the ceiling.',
    ],
  },
  {
    slug: 'giving-as-product',
    title: 'Giving programmes now function as product features',
    summary:
      'Explicit donation mechanics have shifted from brand marketing to a purchase driver buyers actively compare, which turns a soft differentiator into a line item competitors must answer.',
    keyPoints: [
      'Fixture example: donation percentages are now stated on product pages next to price, not on about pages — buyers comparison-shop them.',
      'Fixture example: labels with named ministry partners convert the giving story into repeat purchases better than those citing a generic percentage.',
      'Fixture example: two sample brands added giving trackers (meals, wells funded) to order-confirmation emails, treating impact as post-purchase UX.',
    ],
  },
];
