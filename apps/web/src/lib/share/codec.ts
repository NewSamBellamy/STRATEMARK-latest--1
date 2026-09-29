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
 */
import type {
  CardType,
  CardWithCompany,
  Confidence,
  MaturityTier,
  MetricType,
} from '@mi/contracts';

// ---------------------------------------------------------------------------
// Payload shape (v1) — short keys keep links small.
// ---------------------------------------------------------------------------

export interface SharedMetric {
  t: MetricType;
  v: number | null;
  c: Confidence;
  /** Top citation: publisher + url. */
  s?: { t: string; u: string } | null;
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
  /** Present when kind='briefing' — the full briefing payload. */
  briefing?: SharedBriefing;
  /** Present when kind='report' — the full editorial report rides the link. */
  report?: SharedReport;
}

// ---------------------------------------------------------------------------
// Build (app side) — trim a live card down to shareable evidence.
// ---------------------------------------------------------------------------

export function toSharedCard(c: CardWithCompany): SharedCard {
  return {
    type: c.card.cardType,
    title: c.card.title,
    summary: c.card.summary,
    tier: c.card.tier,
    keyPoints: c.card.keyPoints.slice(0, 6),
    citations: (c.card.citations ?? []).slice(0, 3).map((x) => ({ t: x.title, u: x.url })),
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
        }
      : null,
    metrics: c.metrics.map((m) => ({
      t: m.metricType,
      v: m.value,
      c: m.confidence,
      s: m.citations[0] ? { t: m.citations[0].title, u: m.citations[0].url } : null,
    })),
  };
}

export function buildCardShare(c: CardWithCompany, marketName: string | null): SharePayload {
  return {
    v: 1,
    kind: 'card',
    market: marketName,
    sharedAt: new Date().toISOString(),
    cards: [toSharedCard(c)],
  };
}

export function buildDeckShare(cards: CardWithCompany[], marketName: string | null): SharePayload {
  return {
    v: 1,
    kind: 'deck',
    market: marketName,
    sharedAt: new Date().toISOString(),
    cards: cards.map(toSharedCard),
  };
}

/**
 * A shared Daily Briefing: the full report rides the link,
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
// Render (recipient side) — inflate a shared card back into the shape the
// existing card components already render. IDs are synthetic; nothing here
// touches the repository.
// ---------------------------------------------------------------------------

export function sharedToCardWithCompany(
  sc: SharedCard,
  index: number,
  sharedAt: string,
): CardWithCompany {
  const companyId = sc.company ? `shared_cmp_${index}` : null;
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
    company: sc.company
      ? {
          id: companyId as string,
          name: sc.company.name,
          oneLiner: sc.company.oneLiner,
          logoUrl: sc.company.logo,
          hqLocation: sc.company.hq,
          websiteUrl: sc.company.website,
          brandTheme: null,
        }
      : null,
    metrics: sc.metrics.map((m, mi) => ({
      id: `shared_met_${index}_${mi}`,
      companyId: companyId ?? 'shared',
      metricType: m.t,
      value: m.v,
      confidence: m.c,
      source: m.s?.u ?? null,
      citations: m.s ? [{ title: m.s.t, url: m.s.u }] : [],
      methodNote: null,
      capturedAt: sharedAt,
    })),
    viceClaims: sc.claims.map((cl, ci) => ({
      id: `shared_claim_${index}_${ci}`,
      cardId: `shared_card_${index}`,
      claimText: cl.text,
      sourceUrl: cl.u,
      sourceTitle: cl.t,
      capturedAt: sharedAt,
    })),
  } as CardWithCompany;
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

async function pipeThrough(
  bytes: Uint8Array,
  transform: { readable: ReadableStream; writable: WritableStream },
): Promise<Uint8Array> {
  // Consume first, then write — writing into an unconsumed transform can
  // stall on backpressure. (Direct writer, not Blob.stream(): broader support.)
  const consumed = new Response(transform.readable).arrayBuffer();
  // On a corrupt payload BOTH sides reject; the writer throws first and this
  // one would otherwise surface as an unhandled rejection. The real error
  // still reaches the caller through the awaits below.
  consumed.catch(() => {});
  const writer = transform.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await consumed);
}

export async function encodeSharePayload(payload: SharePayload): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  if (typeof CompressionStream !== 'undefined') {
    const compressed = await pipeThrough(json, new CompressionStream('deflate-raw'));
    return `z${toBase64Url(compressed)}`;
  }
  return `j${toBase64Url(json)}`;
}

export async function decodeSharePayload(blob: string): Promise<SharePayload | null> {
  try {
    const mode = blob.charAt(0);
    const bytes = fromBase64Url(blob.slice(1));
    let json: Uint8Array;
    if (mode === 'z') {
      if (typeof DecompressionStream === 'undefined') return null;
      json = await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
    } else if (mode === 'j') {
      json = bytes;
    } else {
      return null;
    }
    const parsed = JSON.parse(new TextDecoder().decode(json)) as SharePayload;
    if (parsed?.v !== 1 || !Array.isArray(parsed.cards)) return null;
    // A briefing or report can stand alone; card/deck shares need ≥1 card.
    if (parsed.cards.length === 0 && !parsed.briefing && !parsed.report) return null;
    return parsed;
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
