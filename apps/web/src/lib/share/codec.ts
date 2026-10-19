/**
 * Shareable research snapshots — the whole payload rides the link.
 *
 * A shared card or deck is trimmed to its evidence (figures, confidence,
 * sources, key points), deflate-compressed with the browser's native
 * CompressionStream, and base64url-encoded into the URL hash. The recipient
 * opens the link and the app renders a clean read-only preview — no backend,
 * no account, and the AI layer (fact-check, dig-deeper, live desks) removed.
 *
 * Blob format: one prefix character, then base64url data.
 *   "z" — deflate-raw compressed JSON (normal path)
 *   "j" — plain JSON (fallback for engines without CompressionStream)
 *
 * A link is data from a stranger: anyone can type `#/share/<blob>` by hand. The decoder therefore never hands a link
 * back as it came. It inflates only up to MAX_INFLATED_BYTES, refuses a payload of the wrong shape or an absurd number
 * of rows, and holds what it keeps to the rules the app holds its own research to (Rule 9):
 *   - "user verified" is never honoured (only a person on THIS machine can set it; a link cannot prove a person did),
 *     and a figure is only as verified as its sources make it;
 *   - a figure whose value is not a finite, non-negative number is dropped;
 *   - an allegation with no clickable http(s) source is dropped, and every source link must be a plain http(s) page;
 *   - a figure with no capture date has no date: the share time is never substituted for it;
 *   - a signal card (or a card with no company) never carries figures.
 */
import { z } from 'zod';
import {
  cardTypeSchema,
  confidenceSchema,
  enforceMetricProvenance,
  enforceOwnershipProvenance,
  groundingProviderSchema,
  hasVerificationGradeCitation,
  isMaturityTier,
  isSignalCardType,
  metricPassageSupportSchema,
  metricTypeSchema,
  ownershipSchema,
  quotedSupportSchema,
  type CardType,
  type CardWithCompany,
  type CompanyMetric,
  type Confidence,
  type MaturityTier,
  type MetricType,
  type Ownership,
} from '@mi/contracts';

// ---------------------------------------------------------------------------
// Payload shape (v1) — short keys keep links small.
// ---------------------------------------------------------------------------

/**
 * Why a source-reported (estimated) figure may be shown: the sentence a search engine attributed to its sources, kept
 * short. A card face shows an estimated figure only while this proof is on the row, so a share that dropped it showed
 * "Not found yet" for every figure the app itself showed (seen on a live deck: HelloFresh's $7.6B, 18K and $367M).
 * The provider's long redirect links are not kept: the metric's top citation stands for them.
 */
export interface SharedReported {
  p: 'google-search' | 'page-quote';
  /** Company name as the proof recorded it (the face checks it against the card's company). */
  n: string;
  b: MetricType;
  v: number;
  u: string;
  a: string | null;
  d?: string;
  ps?: string;
  /** The supporting sentence. */
  x: string;
  /** Title of its first source. */
  t?: string;
}

export interface SharedMetric {
  t: MetricType;
  v: number | null;
  c: Confidence;
  /** Top citation: publisher + url. */
  s?: { t: string; u: string } | null;
  /** Source-reported proof (see SharedReported). */
  rs?: SharedReported;
  /** Verbatim passage proof, as stored. */
  ps?: CompanyMetric['passageSupport'];
  /** Quoted-original proof, as stored. */
  qs?: CompanyMetric['quotedSupport'];
  /** A headcount band a source states instead of a point value. */
  rb?: { p: SharedReported['p']; n: string; lo: number; hi: number; a: string | null; x: string; t?: string };
  /** When the figure was captured (YYYY-MM-DD), so "over a month old" stays true in a share. Absent means no date, never today. */
  at?: string;
}

export interface SharedCard {
  type: CardType;
  title: string | null;
  summary: string | null;
  tier: MaturityTier | null;
  keyPoints: string[];
  /** Top citations for market-level cards. */
  citations: Array<{ t: string; u: string }>;
  /** Sourced claims (vice/risk cards). */
  claims: Array<{ text: string; t: string | null; u: string }>;
  company: {
    name: string;
    oneLiner: string;
    website: string | null;
    hq: string | null;
    logo: string | null;
    /** Who owns it, when a source says so ("Acquired by ...", "Acquisition by ... pending"). */
    ow?: Ownership;
  } | null;
  metrics: SharedMetric[];
}

/** A Daily Briefing update, trimmed for the link (short keys keep URLs small). */
export interface SharedBriefingUpdate {
  /** Company name. */
  n: string;
  /** Signal: 'h' high, 'n' notable. */
  s: 'h' | 'n';
  /** One-liner — what happened. */
  o: string;
  /** Detail — why it matters. */
  d: string;
  /** Published date (ISO) when the sources said. */
  p: string | null;
  /** Citations: publisher + url. */
  c: Array<{ t: string; u: string }>;
}

export interface SharedBriefing {
  /** The day's headline. */
  h: string;
  /** Generated at (ISO). */
  at: string;
  /** Lookback window, hours. */
  w: number;
  u: SharedBriefingUpdate[];
  /** Desk insights. */
  i: string[];
}

/** A research report, trimmed for the link — the markdown IS the report. */
export interface SharedReport {
  /** Title. */
  t: string;
  /** Report kind. */
  k: 'deck' | 'company' | 'site_audit';
  /** Generated at (ISO). */
  at: string;
  /** Markdown body. */
  md: string;
  /** Top citations: publisher + url. */
  c: Array<{ t: string; u: string }>;
}

export interface SharePayload {
  v: 1;
  kind: 'card' | 'deck' | 'briefing' | 'report';
  market: string | null;
  sharedAt: string;
  cards: SharedCard[];
  /** Present when kind='briefing' — the unboxing + report payload. */
  briefing?: SharedBriefing;
  /** Present when kind='report' — the full editorial report rides the link. */
  report?: SharedReport;
}

// ---------------------------------------------------------------------------
// Build (app side) — trim a live card down to shareable evidence.
// ---------------------------------------------------------------------------

/** The longest supporting sentence a share carries; a source sentence is rarely longer. */
const SUPPORT_TEXT_MAX = 600;

/**
 * The one source a share keeps for a figure. A recipient re-checks a "verified" figure against the sources it carries
 * (a figure is only as verified as its sources make it), so a figure the sender's app verified on its second source
 * must carry THAT one, not whichever happened to be listed first.
 */
function topCitation(m: CompanyMetric, officialWebsite: string | null | undefined): CompanyMetric['citations'][number] | undefined {
  if (m.confidence === 'verified') {
    const grade = m.citations.find((c) => hasVerificationGradeCitation([c], officialWebsite));
    if (grade) return grade;
  }
  return m.citations[0];
}

/** A metric trimmed for the link: its figure, its top source, and the proof the card face re-checks. */
export function toSharedMetric(m: CompanyMetric, officialWebsite?: string | null): SharedMetric {
  const top = topCitation(m, officialWebsite);
  const out: SharedMetric = {
    t: m.metricType,
    v: m.value,
    c: m.confidence,
    s: top ? { t: top.title, u: top.url } : null,
  };
  const rs = m.reportedSupport;
  if (rs) {
    out.rs = { p: rs.provider, n: rs.companyName, b: rs.basis, v: rs.value, u: rs.unit, a: rs.asOf,
      ...(rs.definition ? { d: rs.definition } : {}), ...(rs.periodStart ? { ps: rs.periodStart } : {}),
      x: rs.support.text.slice(0, SUPPORT_TEXT_MAX), ...(rs.support.sources[0]?.title ? { t: rs.support.sources[0].title } : {}) };
  }
  if (m.passageSupport) out.ps = m.passageSupport;
  if (m.quotedSupport) out.qs = m.quotedSupport;
  const band = m.reportedBand;
  if (band) {
    out.rb = { p: band.provider, n: band.companyName, lo: band.low, hi: band.high, a: band.asOf,
      x: band.support.text.slice(0, SUPPORT_TEXT_MAX), ...(band.support.sources[0]?.title ? { t: band.support.sources[0].title } : {}) };
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(m.capturedAt ?? '')) out.at = (m.capturedAt as string).slice(0, 10);
  return out;
}

export function toSharedCard(c: CardWithCompany): SharedCard {
  return {
    type: c.card.cardType,
    title: c.card.title,
    summary: c.card.summary,
    tier: c.card.tier,
    keyPoints: c.card.keyPoints.slice(0, 6),
    citations: (c.card.citations ?? [])
      .slice(0, 3)
      .map((x) => ({ t: x.title, u: x.url })),
    claims: (c.viceClaims ?? [])
      .slice(0, 3)
      .map((v) => ({ text: v.claimText, t: v.sourceTitle, u: v.sourceUrl })),
    company: c.company
      ? {
          name: c.company.name,
          oneLiner: c.company.oneLiner,
          website: c.company.websiteUrl,
          hq: c.company.hqLocation,
          logo: c.company.logoUrl,
          ...(c.company.ownership ? { ow: { ...c.company.ownership, citations: c.company.ownership.citations.slice(0, 1), methodNote: null } } : {}),
        }
      : null,
    metrics: c.metrics.map((m) => toSharedMetric(m, c.company?.websiteUrl)),
  };
}

export function buildCardShare(c: CardWithCompany, marketName: string | null): SharePayload {
  return { v: 1, kind: 'card', market: marketName, sharedAt: new Date().toISOString(), cards: [toSharedCard(c)] };
}

export function buildDeckShare(
  cards: CardWithCompany[],
  marketName: string | null,
): SharePayload {
  return {
    v: 1,
    kind: 'deck',
    market: marketName,
    sharedAt: new Date().toISOString(),
    cards: cards.map(toSharedCard),
  };
}

/**
 * A shared Daily Briefing: the unboxing reveal + full report ride the link,
 * along with the cards for the companies the briefing mentions so the
 * recipient can flip through the evidence beneath the story.
 */
export function buildBriefingShare(
  briefing: {
    marketName: string;
    generatedAt: string;
    windowHours: number;
    headline: string;
    insights: string[];
    updates: Array<{
      companyName: string;
      signal: 'high' | 'notable';
      oneLiner: string;
      detail: string;
      publishedDate: string | null;
      citations: Array<{ title: string; url: string }>;
    }>;
  },
  cards: CardWithCompany[],
): SharePayload {
  return {
    v: 1,
    kind: 'briefing',
    market: briefing.marketName,
    sharedAt: new Date().toISOString(),
    cards: cards.map(toSharedCard),
    briefing: {
      h: briefing.headline,
      at: briefing.generatedAt,
      w: briefing.windowHours,
      u: briefing.updates.map((u) => ({
        n: u.companyName,
        s: u.signal === 'high' ? 'h' : 'n',
        o: u.oneLiner,
        d: u.detail,
        p: u.publishedDate,
        c: u.citations.slice(0, 2).map((c) => ({ t: c.title, u: c.url })),
      })),
      i: briefing.insights,
    },
  };
}

/**
 * A shared report: the whole markdown travels in the link (deflate makes even
 * a long report compact). Optionally rides with the subject's card so the
 * recipient sees the face-value figures beside the prose.
 */
export function buildReportShare(
  report: {
    title: string;
    kind: 'deck' | 'company' | 'site_audit';
    markdown: string;
    citations: Array<{ title: string; url: string }>;
    createdAt: string;
  },
  marketName: string | null,
  cards: CardWithCompany[] = [],
): SharePayload {
  return {
    v: 1,
    kind: 'report',
    market: marketName,
    sharedAt: new Date().toISOString(),
    cards: cards.slice(0, 3).map(toSharedCard),
    report: {
      t: report.title,
      k: report.kind,
      at: report.createdAt,
      md: report.markdown,
      c: report.citations.slice(0, 8).map((c) => ({ t: c.title, u: c.url })),
    },
  };
}

// ---------------------------------------------------------------------------
// Receive (recipient side) — hold a link to the rules, then inflate a shared
// card back into the shape the existing card components already render. IDs
// are synthetic; nothing here touches the repository.
// ---------------------------------------------------------------------------

/** The most text a link may inflate to: far above any real share (a 10-company deck is a few KB), far below what exhausts a tab. */
export const MAX_INFLATED_BYTES = 24 * 1024 * 1024;

/** The longest blob worth reading: more than a plain-JSON payload at the inflate cap could ever need. */
const MAX_BLOB_CHARS = Math.ceil((MAX_INFLATED_BYTES * 4) / 3) + 8;

/** Far above any real deck (18 companies, about 20 cards and 300 figures), far below hostile. */
export const SHARE_LIMITS = {
  companies: 300,
  cards: 400,
  metrics: 8_000,
  viceClaims: 800,
  keyPoints: 100,
  citations: 100,
  briefingUpdates: 500,
  insights: 200,
  reportMarkdown: 2_000_000,
} as const;

/** A plain http(s) address with no credentials, or null. */
function webUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.hostname && !url.username && !url.password ? text : null;
  } catch {
    return null;
  }
}

/** A real calendar day written YYYY-MM-DD ("2026-02-31" is not one). */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoInstant = z.string().refine((text) => Number.isFinite(Date.parse(text)), 'not a date');
const maybeText = z.string().nullish().transform((value) => value ?? null);
const wireLink = z.object({ t: z.string().catch(''), u: z.string() });

/**
 * The wire shape, checked. A proof that does not fit is dropped (the figure then stands on its own confidence, which a
 * face with no proof shows plainly); a field of the wrong type anywhere else refuses the whole link.
 */
const sharedReportedSchema = z.object({
  p: groundingProviderSchema,
  n: z.string().min(1),
  b: metricTypeSchema,
  v: z.number().finite().nonnegative(),
  u: metricPassageSupportSchema.shape.unit,
  a: dateOnly.nullable(),
  d: metricPassageSupportSchema.shape.definition,
  ps: metricPassageSupportSchema.shape.periodStart,
  x: z.string().min(1).max(12_000),
  t: z.string().optional(),
});

const sharedBandSchema = z.object({
  p: groundingProviderSchema,
  n: z.string().min(1),
  lo: z.number().int().positive(),
  hi: z.number().int().positive(),
  a: dateOnly.nullable(),
  x: z.string().min(1).max(12_000),
  t: z.string().optional(),
}).refine((band) => band.hi > band.lo, 'band high must exceed low');

const sharedMetricSchema = z.object({
  t: metricTypeSchema,
  // Not narrowed here: a figure that is not a finite, non-negative number is dropped, not a reason to refuse the link.
  v: z.unknown(),
  c: confidenceSchema,
  s: wireLink.nullish().transform((value) => value ?? null),
  rs: sharedReportedSchema.optional().catch(undefined),
  ps: metricPassageSupportSchema.optional().catch(undefined),
  qs: quotedSupportSchema.extend({ value: z.number().finite() }).optional().catch(undefined),
  rb: sharedBandSchema.optional().catch(undefined),
  at: z.string().optional().catch(undefined),
});

const sharedCardSchema = z.object({
  type: cardTypeSchema,
  title: maybeText,
  summary: maybeText,
  tier: z.number().nullish().transform((value) => value ?? null).refine((value) => value === null || isMaturityTier(value), 'not a tier'),
  keyPoints: z.array(z.string()).max(SHARE_LIMITS.keyPoints).default([]),
  citations: z.array(wireLink).max(SHARE_LIMITS.citations).default([]),
  claims: z.array(z.object({ text: z.string(), t: maybeText, u: z.string() })).max(SHARE_LIMITS.viceClaims).default([]),
  company: z.object({
    name: z.string(),
    oneLiner: z.string(),
    website: maybeText,
    hq: maybeText,
    logo: maybeText,
    ow: ownershipSchema.optional().catch(undefined),
  }).nullish().transform((value) => value ?? null),
  metrics: z.array(sharedMetricSchema).max(SHARE_LIMITS.metrics).default([]),
});

const sharedBriefingSchema = z.object({
  h: z.string(),
  at: isoInstant,
  w: z.number().finite().nonnegative(),
  u: z.array(z.object({
    n: z.string(),
    s: z.enum(['h', 'n']),
    o: z.string(),
    d: z.string(),
    p: maybeText,
    c: z.array(wireLink).max(SHARE_LIMITS.citations).default([]),
  })).max(SHARE_LIMITS.briefingUpdates),
  i: z.array(z.string()).max(SHARE_LIMITS.insights).default([]),
});

const sharedReportSchema = z.object({
  t: z.string(),
  k: z.enum(['deck', 'company', 'site_audit']),
  at: isoInstant,
  md: z.string().max(SHARE_LIMITS.reportMarkdown),
  c: z.array(wireLink).max(SHARE_LIMITS.citations).default([]),
});

const sharePayloadSchema = z.object({
  v: z.literal(1),
  kind: z.enum(['card', 'deck', 'briefing', 'report']),
  market: maybeText,
  sharedAt: isoInstant,
  cards: z.array(sharedCardSchema).max(SHARE_LIMITS.cards),
  briefing: sharedBriefingSchema.optional(),
  report: sharedReportSchema.optional(),
});

/** Cheap count of the raw rows, before any is copied: a payload past the limits is refused unread. */
function rowsWithinLimits(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const cards = (value as { cards?: unknown }).cards;
  if (!Array.isArray(cards) || cards.length > SHARE_LIMITS.cards) return false;
  let companies = 0;
  let metrics = 0;
  let claims = 0;
  for (const card of cards) {
    if (typeof card !== 'object' || card === null) continue; // the schema refuses it
    const { company, metrics: figures, claims: allegations } = card as { company?: unknown; metrics?: unknown; claims?: unknown };
    if (company) companies++;
    if (Array.isArray(figures)) metrics += figures.length;
    if (Array.isArray(allegations)) claims += allegations.length;
  }
  return companies <= SHARE_LIMITS.companies && metrics <= SHARE_LIMITS.metrics && claims <= SHARE_LIMITS.viceClaims;
}

function cleanLinks<T extends { u: string }>(links: T[]): T[] {
  return links.flatMap((link) => {
    const url = webUrl(link.u);
    return url ? [{ ...link, u: url }] : [];
  });
}

/**
 * One figure as a visitor may see it, or null when it is not a figure at all. This is the wire-level half of the
 * rules; `sharedToCardWithCompany` adds the provenance check (an unsourced "verified" figure becomes an estimate).
 */
function cleanSharedMetric(m: SharedMetric): SharedMetric | null {
  const value = (m.v ?? null) as unknown;
  if (value !== null && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) return null;
  const top = m.s ? webUrl(m.s.u) : null;
  const out: SharedMetric = {
    ...m,
    v: value as number | null,
    // No person here checked anything: a human check cannot arrive in a link. The figure keeps whatever its sources earn it.
    c: m.c === 'user_verified' ? 'verified' : m.c,
    s: m.s && top ? { t: m.s.t, u: top } : null,
  };
  // A missing or malformed date stays missing. The share time is not the date a figure was captured.
  if (out.at !== undefined && !isCalendarDate(out.at)) delete out.at;
  return out;
}

function cleanSharedCard(card: SharedCard): SharedCard {
  // Same rule the card face uses: a signal card (or one with no company) shows no figures, whatever a link carries.
  const signal = isSignalCardType(card.type) || !card.company;
  let company: SharedCard['company'] = null;
  if (card.company) {
    const { ow, ...rest } = card.company;
    // A link cannot carry a human's say-so about ownership either, and a status with no source is not shown.
    const ownership = enforceOwnershipProvenance(ow, true);
    company = { ...rest, website: webUrl(card.company.website), logo: webUrl(card.company.logo), ...(ownership ? { ow: ownership } : {}) };
  }
  return {
    ...card,
    citations: cleanLinks(card.citations),
    // Rule 9: an allegation with no clickable http(s) source is dropped, not displayed.
    claims: cleanLinks(card.claims),
    company,
    metrics: signal ? [] : card.metrics.flatMap((m) => cleanSharedMetric(m) ?? []),
  };
}

/** The proof's support block, rebuilt around the one source a share keeps. */
function sharedSupport(text: string, title: string | undefined, top: SharedMetric['s']) {
  return { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: top?.u ?? '', title: title ?? top?.t ?? '' }] };
}

function sharedReportedSupport(rs: SharedReported, top: SharedMetric['s']): NonNullable<CompanyMetric['reportedSupport']> {
  return {
    provider: rs.p, companyName: rs.n, basis: rs.b, value: rs.v, unit: rs.u as NonNullable<CompanyMetric['reportedSupport']>['unit'], asOf: rs.a,
    ...(rs.d ? { definition: rs.d as NonNullable<CompanyMetric['reportedSupport']>['definition'] } : {}),
    ...(rs.ps ? { periodStart: rs.ps } : {}),
    support: sharedSupport(rs.x, rs.t, top),
  };
}

/** A shared card as the card components render it, held to the rules in the file header whatever the link claimed. */
export function sharedToCardWithCompany(shared: SharedCard, index: number, sharedAt: string): CardWithCompany {
  const sc = cleanSharedCard(shared);
  const companyId = sc.company ? `shared_cmp_${index}` : null;
  const company = sc.company
    ? {
        id: companyId as string,
        name: sc.company.name,
        oneLiner: sc.company.oneLiner,
        logoUrl: sc.company.logo,
        hqLocation: sc.company.hq,
        websiteUrl: sc.company.website,
        brandTheme: null,
        ...(sc.company.ow ? { ownership: sc.company.ow } : {}),
      }
    : null;
  const metrics = sc.metrics.map((m, mi): CompanyMetric => enforceMetricProvenance({
    id: `shared_met_${index}_${mi}`,
    companyId: companyId ?? 'shared',
    metricType: m.t,
    value: m.v,
    confidence: m.c,
    source: m.s?.u ?? null,
    citations: m.s ? [{ title: m.s.t, url: m.s.u }] : [],
    methodNote: null,
    // The day it was captured, or no day at all (the card reads a blank date as unknown, never as fresh).
    capturedAt: m.at && isCalendarDate(m.at) ? `${m.at}T00:00:00.000Z` : '',
    ...(m.rs ? { reportedSupport: sharedReportedSupport(m.rs, m.s) } : {}),
    ...(m.ps ? { passageSupport: m.ps } : {}),
    ...(m.qs ? { quotedSupport: m.qs } : {}),
    ...(m.rb ? { reportedBand: { provider: m.rb.p, companyName: m.rb.n, basis: 'employees' as const, low: m.rb.lo, high: m.rb.hi, unit: 'count' as const,
      asOf: m.rb.a, support: sharedSupport(m.rb.x, m.rb.t, m.s) } } : {}),
  }, company?.websiteUrl, company?.ownership));
  return {
    card: {
      id: `shared_card_${index}`,
      deckId: 'shared_deck',
      companyId,
      cardType: sc.type,
      title: sc.title,
      summary: sc.summary,
      tier: sc.tier,
      tierReason: null,
      citations: sc.citations.map((x) => ({ title: x.t, url: x.u })),
      keyPoints: sc.keyPoints,
      createdAt: sharedAt,
    },
    company,
    metrics,
    viceClaims: sc.claims.map((cl, ci) => ({
      id: `shared_claim_${index}_${ci}`,
      cardId: `shared_card_${index}`,
      claimText: cl.text,
      sourceUrl: cl.u,
      sourceTitle: cl.t,
      // The link does not say when an allegation was captured; the share time is not that date.
      capturedAt: '',
    })),
  } as CardWithCompany;
}

/** A card with the rules already applied to its wire form, so what `decodeSharePayload` returns is what a visitor may see. */
function receiveSharedCard(card: SharedCard, index: number, sharedAt: string): SharedCard {
  const clean = cleanSharedCard(card);
  const shown = sharedToCardWithCompany(clean, index, sharedAt);
  return {
    ...clean,
    metrics: clean.metrics.map((m, i) => {
      const row = shown.metrics[i];
      const top = row?.citations[0];
      return row ? { ...m, v: row.value, c: row.confidence, s: top ? { t: top.title, u: top.url } : null } : m;
    }),
  };
}

/**
 * Check what a link decoded to. Null when it is not a share this page can show (wrong shape, wrong types, or more rows
 * than any real deck has); otherwise the payload with every rule applied.
 */
export function parseSharePayload(value: unknown): SharePayload | null {
  if (!rowsWithinLimits(value)) return null;
  const checked = sharePayloadSchema.safeParse(value);
  if (!checked.success) return null;
  const payload = checked.data as unknown as SharePayload;
  // A briefing or report can stand alone; card/deck shares need ≥1 card.
  if (payload.cards.length === 0 && !payload.briefing && !payload.report) return null;
  return {
    ...payload,
    cards: payload.cards.map((card, i) => receiveSharedCard(card, i, payload.sharedAt)),
    ...(payload.briefing ? { briefing: { ...payload.briefing, u: payload.briefing.u.map((update) => ({ ...update, c: cleanLinks(update.c) })) } } : {}),
    ...(payload.report ? { report: { ...payload.report, c: cleanLinks(payload.report.c) } } : {}),
  };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Pump bytes through a (de)compression stream, reading while writing so backpressure cannot stall it, and stopping at
 * `maxOut` bytes of output. A few hundred kilobytes of hostile link can inflate to gigabytes (a 398 KB hash inflated
 * 300 MB with no refusal, and a 1.36 MB one a gigabyte), so a decoder must stop reading, not merely discard the result.
 */
async function pipeThrough(
  bytes: Uint8Array,
  transform: { readable: ReadableStream; writable: WritableStream },
  maxOut = Number.POSITIVE_INFINITY,
): Promise<Uint8Array> {
  const reader = transform.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const reading = (async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxOut) {
        await reader.cancel().catch(() => undefined);
        throw new Error('The shared research is larger than this page will open.');
      }
      chunks.push(value);
    }
    const out = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  })();
  // On a corrupt payload or a refused size BOTH sides reject; whichever is not awaited would otherwise surface as an
  // unhandled rejection. The real error still reaches the caller through the awaits below.
  reading.catch(() => undefined);
  const writing = (async () => {
    const writer = transform.writable.getWriter();
    await writer.write(bytes);
    await writer.close();
  })();
  writing.catch(() => undefined);
  const out = await reading;
  await writing;
  return out;
}

export async function encodeSharePayload(payload: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream !== 'undefined') {
    const compressed = await pipeThrough(json, new CompressionStream('deflate-raw'));
    return `z${toBase64Url(compressed)}`;
  }
  return `j${toBase64Url(json)}`;
}

/**
 * Open a link. Null for anything that is not a share this page will show: a truncated or tampered blob, one that
 * inflates past MAX_INFLATED_BYTES, one of the wrong shape or with an absurd number of rows. What comes back has
 * already been held to the rules in the file header, so a caller renders it as it is.
 */
export async function decodeSharePayload(blob: string): Promise<SharePayload | null> {
  try {
    if (blob.length > MAX_BLOB_CHARS) return null;
    const mode = blob.charAt(0);
    const bytes = fromBase64Url(blob.slice(1));
    let json: Uint8Array;
    if (mode === 'z') {
      if (typeof DecompressionStream === 'undefined') return null;
      json = await pipeThrough(bytes, new DecompressionStream('deflate-raw'), MAX_INFLATED_BYTES);
    } else if (mode === 'j') {
      if (bytes.byteLength > MAX_INFLATED_BYTES) return null;
      json = bytes;
    } else {
      return null;
    }
    return parseSharePayload(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The share action — one call from any button.
// ---------------------------------------------------------------------------

export function shareUrlFor(blob: string): string {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#/share/${blob}`;
}

/**
 * Share via the native share sheet (text, email, drive — the OS decides) with
 * clipboard as the universal fallback. Returns how it was delivered.
 */
export async function sharePayload(
  payload: SharePayload,
  title: string,
): Promise<'shared' | 'copied'> {
  const url = shareUrlFor(await encodeSharePayload(payload));
  const nav = navigator as Navigator & {
    share?: (data: { title: string; url: string }) => Promise<void>;
    canShare?: (data: { title: string; url: string }) => boolean;
  };
  if (typeof nav.share === 'function' && (nav.canShare?.({ title, url }) ?? true)) {
    try {
      await nav.share({ title, url });
      return 'shared';
    } catch {
      // user dismissed the sheet or the target rejected — fall through to copy
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
