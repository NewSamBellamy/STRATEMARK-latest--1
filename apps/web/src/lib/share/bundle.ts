/**
 * Turns a ShareSnapshot into the page a share link opens: the share viewer
 * template with the shared research embedded, and the tags that make a chat app
 * unfurl it with a title, a line of description and a picture.
 *
 * Nothing here invents anything: the description is the card's own summary (or
 * the company's own one-liner), and the picture is drawn from the same figures.
 */
import { CARD_TYPE_LABELS, METRIC_TYPE_LABELS, isEntityCardType, type Card, type CompanyMetric, type ShareSnapshot } from '@mi/contracts';
import { formatMetricValue } from '@/lib/format';

export const SHARE_META_TOKEN = '<!--STRATEMARK_SHARE_META-->';
export const SHARE_DATA_TOKEN = '__STRATEMARK_SHARE_DATA__';
/** The data slot as a whole element: the app's own scripts mention the token too, so only this exact element is the slot. */
export const SHARE_DATA_SLOT = /(<script id="stratemark-share-data" type="application\/json">)__STRATEMARK_SHARE_DATA__(<\/script>)/;
export const DEFAULT_SIGNUP = 'https://getstratemark.com';

/** An unguessable id: the link is the only way in, so it must not be enumerable. */
export function newShareId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from(random(12), (b) => alphabet[b % alphabet.length]).join('');
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`);
/** Like clip, but never cuts a word in half. */
const clipAtWord = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > max * 0.5 ? head.slice(0, space) : head).trimEnd()}…`;
};
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface ShareMeta {
  title: string;
  description: string;
}

/**
 * What a signal card (culture, risk, insight, barrier) is about, in a line. It never borrows a company, and a card made
 * by the research often has no title of its own, so it falls back to the first sentence of its finding.
 */
function signalHeadline(card: Pick<Card, 'title' | 'summary' | 'keyPoints'>): string {
  const own = oneLine(card.title ?? '');
  if (own) return own;
  const finding = oneLine(card.summary ?? card.keyPoints?.[0] ?? '');
  return clipAtWord(finding.split(/(?<=[.!?])\s+(?=[A-Z])/)[0] ?? finding, 90);
}

export function shareMeta(snapshot: ShareSnapshot): ShareMeta {
  if (snapshot.kind === 'card') {
    const card = snapshot.cards.find((c) => c.id === snapshot.focusCardId) ?? snapshot.cards[0];
    if (card && !isEntityCardType(card.cardType)) {
      const headline = signalHeadline(card);
      const finding = oneLine(card.summary ?? '');
      const description = (finding && finding !== headline ? finding : oneLine(card.keyPoints?.[0] ?? '')) || `A sourced ${CARD_TYPE_LABELS[card.cardType].toLowerCase()} finding.`;
      return { title: `${CARD_TYPE_LABELS[card.cardType]}: ${headline || 'a sourced finding'}`, description: clip(description, 200) };
    }
    const company = card && isEntityCardType(card.cardType) ? snapshot.companies[0] : undefined;
    const name = company?.name ?? card?.title ?? 'A card';
    const description = oneLine(card?.summary ?? company?.oneLiner ?? '') || `Sourced research on ${name}.`;
    return { title: `${name}: sourced research on Stratemark`, description: clip(description, 200) };
  }
  const market = snapshot.markets[0];
  const names = snapshot.companies.map((c) => c.name);
  const count = names.length;
  return {
    title: `${market?.name ?? 'A market'}: a deck of sourced research on Stratemark`,
    description: clip(
      count > 0
        ? `${count} ${count === 1 ? 'company' : 'companies'}, every figure with its source: ${names.slice(0, 5).join(', ')}${count > 5 ? ' and more' : ''}.`
        : 'Sourced market research.',
      200,
    ),
  };
}

function metaTags(meta: ShareMeta, imageUrl: string | null): string {
  const t = escapeHtml(meta.title);
  const d = escapeHtml(meta.description);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    '<meta name="robots" content="noindex, nofollow" />',
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Stratemark" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    ...(imageUrl
      ? [
        `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
        '<meta property="og:image:width" content="1200" />',
        '<meta property="og:image:height" content="630" />',
        '<meta name="twitter:card" content="summary_large_image" />',
        `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
      ]
      : ['<meta name="twitter:card" content="summary" />']),
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
  ].join('\n    ');
}

/** JSON that is safe inside a <script> element: no early </script>, no line separators. */
export function embedJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface BuildShareHtmlInput {
  template: string;
  snapshot: ShareSnapshot;
  signupUrl?: string;
  /** Public address the share folder will be served from (https, no trailing slash). Needed for an absolute og:image. */
  baseUrl?: string | null;
  shareId: string;
  /** Whether an og.png will sit beside the page. */
  withImage: boolean;
}

export function buildShareHtml(input: BuildShareHtmlInput): string {
  const { template, snapshot, shareId } = input;
  if (!SHARE_DATA_SLOT.test(template) || !template.includes(SHARE_META_TOKEN)) {
    throw new Error('The share viewer template is missing its data slot. Rebuild the web app and try again.');
  }
  const base = input.baseUrl && /^https:\/\//i.test(input.baseUrl) ? input.baseUrl.replace(/\/+$/, '') : null;
  // Chat apps need an absolute https address for the picture; without a base it is left out rather than guessed.
  const imageUrl = input.withImage && base ? `${base}/${shareId}/og.png` : null;
  const signup = input.signupUrl && /^https:\/\//i.test(input.signupUrl) ? input.signupUrl : DEFAULT_SIGNUP;
  const withoutTitle = template.replace(/<title>[^<]*<\/title>/i, '');
  return withoutTitle
    .replace(SHARE_META_TOKEN, () => metaTags(shareMeta(snapshot), imageUrl))
    .replace(SHARE_DATA_SLOT, (_all, open: string, close: string) => `${open}${embedJson({ snapshot, signupUrl: signup })}${close}`);
}

// ---------------------------------------------------------------------------
// The link-preview picture: what to draw, as data. The canvas drawing lives in ogImage.ts.
// ---------------------------------------------------------------------------

export interface OgSlot {
  label: string;
  /** A figure a source stands behind, or null: drawn as "Not found yet", never as a number. */
  value: string | null;
}

export interface OgLayout {
  eyebrow: string;
  title: string;
  subtitle: string;
  /** The little card drawn beside the text: the four face slots of a company card. */
  slots: OgSlot[];
  /** Company names for a deck: drawn as a small stack of cards. */
  names: string[];
}

/** Only figures a source stands behind; unknown is never drawn as a number. */
function faceSlots(metrics: readonly CompanyMetric[]): OgSlot[] {
  const stated = (type: CompanyMetric['metricType']): string | null => {
    // Only what the card face would show: a verified figure with a source, or one a person confirmed. An estimate is not drawn.
    const m = metrics.find((x) => x.metricType === type && x.value != null && (x.confidence === 'user_verified' || (x.confidence === 'verified' && (x.citations ?? []).length > 0)));
    return m ? formatMetricValue(type, m.value) : null;
  };
  const either = (a: CompanyMetric['metricType'], b: CompanyMetric['metricType']): string | null => stated(a) ?? stated(b);
  return [
    { label: METRIC_TYPE_LABELS.employees, value: stated('employees') },
    { label: 'Revenue / ARR', value: either('arr', 'revenue') },
    { label: METRIC_TYPE_LABELS.users, value: stated('users') },
    { label: METRIC_TYPE_LABELS.valuation, value: either('valuation', 'market_cap') },
  ];
}

export function ogLayout(snapshot: ShareSnapshot): OgLayout {
  if (snapshot.kind === 'card') {
    const card = snapshot.cards.find((c) => c.id === snapshot.focusCardId) ?? snapshot.cards[0];
    // A signal card (culture, vice, insight) is not a company card: it never borrows a company's name or figures.
    const company = card && isEntityCardType(card.cardType) ? snapshot.companies[0] : undefined;
    return {
      eyebrow: card ? card.cardType.replace(/_/g, ' ').toUpperCase() : 'CARD',
      title: company?.name ?? (card && !isEntityCardType(card.cardType) ? signalHeadline(card) : card?.title) ?? 'Stratemark research',
      subtitle: clip(oneLine(card?.summary ?? company?.oneLiner ?? ''), 150),
      slots: company ? faceSlots(snapshot.metrics.filter((m) => m.companyId === company.id)) : [],
      names: [],
    };
  }
  const market = snapshot.markets[0];
  return {
    eyebrow: 'DECK',
    title: market?.name ?? 'Stratemark research',
    subtitle: `${snapshot.companies.length} ${snapshot.companies.length === 1 ? 'company' : 'companies'}, every figure with its source`,
    slots: [],
    names: snapshot.companies.map((c) => c.name).slice(0, 3),
  };
}
