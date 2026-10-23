/**
 * The Products & Roadmap tab as data: what the lineup says at a glance, which
 * products lead, which pictures may stand for a product, what changed lately,
 * and which product a roadmap item belongs to. Everything is counted or read
 * from stored, sourced research; nothing is estimated (AGENTS.md Rule 9).
 */
import type { LiveIntelItem, Product, ProductBrief, RoadmapItem } from '@mi/contracts';
import { mentionsProduct } from '@/features/export/productReportModel';
import { safeHttpUrl } from '@/lib/sourceHref';

/** How many products "Research top products" covers on its own. */
export const TOP_PRODUCTS = 3;

export const productKey = (name: string): string => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export const siblingNames = (products: readonly Product[], of: Product): string[] =>
  products.filter((p) => p !== of).map((p) => p.name);

/** The company's own host ("anthropic.com" for https://www.anthropic.com), or null. */
export function officialHost(websiteUrl: string | null | undefined): string | null {
  const href = safeHttpUrl(websiteUrl);
  if (!href) return null;
  return new URL(href).hostname.toLowerCase().replace(/^www[.]/, '');
}

/** True when `url` is on the company's own domain (or a subdomain of it). */
export function isOfficialUrl(url: string | null | undefined, websiteUrl: string | null | undefined): boolean {
  const official = officialHost(websiteUrl);
  const href = safeHttpUrl(url);
  if (!official || !href) return false;
  const host = new URL(href).hostname.toLowerCase().replace(/^www[.]/, '');
  return host === official || host.endsWith(`.${official}`);
}

/** Letters and digits of a URL path and a title as one folded, space-separated string. */
const fold = (text: string): string => ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

export type PictureKind = 'product' | 'official' | 'site';
export interface PictureCandidate { url: string; kind: PictureKind }

/**
 * Pages whose preview picture may stand for the product, best first:
 *   1. the product's own page (a URL the research recorded for it);
 *   2. an official-domain page a source named for THIS product (a citation of the
 *      product's brief whose address or title names it) - verified, never guessed;
 *   3. the company's own site, as a preview of the company, not of the product.
 * Only https pages (the preview reader refuses the rest). A guessed address is never offered.
 */
export function pictureCandidates(args: {
  product: Product; brief: ProductBrief | null; siblings?: readonly string[];
  company: { websiteUrl: string | null };
}): PictureCandidate[] {
  const { product, brief, company } = args;
  const out: PictureCandidate[] = [];
  const add = (url: string | null | undefined, kind: PictureKind) => {
    const href = safeHttpUrl(url);
    if (href && /^https:/i.test(href) && !out.some((c) => c.url === href)) out.push({ url: href, kind });
  };
  add(product.url, 'product');
  if (product.sourceUrl && isOfficialUrl(product.sourceUrl, company.websiteUrl)) add(product.sourceUrl, 'product');
  const named = (text: string) => mentionsProduct(fold(text), product.name, args.siblings ?? []);
  const pool = [
    ...(brief?.citations ?? []).map((c) => ({ url: c.url, title: c.title })),
    ...(brief?.metrics ?? []).flatMap((m) => (m.sourceUrl ? [{ url: m.sourceUrl, title: m.sourceTitle ?? '' }] : [])),
    ...(brief?.timeline ?? []).flatMap((t) => (t.sourceUrl ? [{ url: t.sourceUrl, title: t.title }] : [])),
  ];
  for (const c of pool) {
    if (isOfficialUrl(c.url, company.websiteUrl) && (named(new URL(c.url).pathname) || named(c.title))) add(c.url, 'official');
  }
  add(company.websiteUrl, 'site');
  return out;
}

export interface LineupCounts {
  total: number; live: number; beta: number; sunset: number; unstated: number;
  now: number; next: number; later: number; researched: number;
}

export function lineupCounts(products: readonly Product[], roadmap: readonly RoadmapItem[], briefs: ReadonlyMap<string, ProductBrief>): LineupCounts {
  const by = (s: Product['status']) => products.filter((p) => p.status === s).length;
  const h = (k: RoadmapItem['horizon']) => roadmap.filter((r) => r.horizon === k).length;
  return {
    total: products.length, live: by('live'), beta: by('beta'), sunset: by('sunset'), unstated: by(null),
    now: h('now'), next: h('next'), later: h('later'),
    researched: products.filter((p) => briefs.has(productKey(p.name))).length,
  };
}

/** The products the one-click bulk research covers: the first few in researched order that have no brief yet. */
export function topToResearch(products: readonly Product[], briefs: ReadonlyMap<string, ProductBrief>, n = TOP_PRODUCTS): Product[] {
  return products.slice(0, n).filter((p) => !briefs.has(productKey(p.name)));
}

/** The product a roadmap item is about: the longest product name its title or detail names, or null. */
export function roadmapProduct(item: RoadmapItem, products: readonly Product[]): Product | null {
  const text = `${item.title} ${item.detail}`;
  const hits = products.filter((p) => mentionsProduct(text, p.name, siblingNames(products, p)));
  return hits.sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

export interface Change {
  /** ISO timestamp used for ordering. */
  at: string;
  title: string;
  url: string;
  publisher: string | null;
  product: string | null;
  origin: 'research' | 'stored';
}

/**
 * What changed lately for these products: product news the briefs found, plus
 * stored company stories that name a product (never a story that names only a
 * longer sibling). Dated, newest first, one per address.
 */
export function recentChanges(
  products: readonly Product[], briefs: ReadonlyMap<string, ProductBrief>, intel: readonly LiveIntelItem[], max = 5,
): Change[] {
  const out: Change[] = [];
  const seen = new Set<string>();
  const push = (c: Change) => {
    if (seen.has(c.url) || !Number.isFinite(Date.parse(c.at))) return;
    seen.add(c.url);
    out.push(c);
  };
  for (const p of products) {
    for (const n of briefs.get(productKey(p.name))?.news ?? []) {
      if (safeHttpUrl(n.url)) push({ at: n.publishedAt, title: n.title, url: n.url, publisher: n.publisher, product: p.name, origin: 'research' });
    }
  }
  for (const item of intel) {
    if (!safeHttpUrl(item.url)) continue;
    // The story's REPORTED date; publishedAt is when we found it and is never shown as the story's date.
    const reported = item.publishedDate ? Date.parse(item.publishedDate) : NaN;
    const at = Number.isFinite(reported) ? new Date(reported).toISOString() : null;
    const p = products.filter((x) => mentionsProduct(`${item.title} ${item.summary ?? ''}`, x.name, siblingNames(products, x)))
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (p && at) push({ at, title: item.title, url: item.url, publisher: item.publisher ?? null, product: p.name, origin: 'stored' });
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, max);
}

export type ProductStatus = NonNullable<Product['status']>;

export const STATUS_STYLE: Record<ProductStatus, string> = {
  live: 'border-emerald-300 text-emerald-700 bg-emerald-50',
  beta: 'border-amber-300 text-amber-700 bg-amber-50',
  sunset: 'border-slate-300 text-slate-600 bg-slate-100',
};
export const STATUS_LABEL: Record<ProductStatus, string> = { live: 'Live', beta: 'Beta', sunset: 'Sunset' };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * End of the period a stated target covers ("2026-03-15", "March 2026",
 * "Q3 2026", "2026 H2", "2026"), or null when the text is not a date we can
 * read with confidence. Unreadable text is never guessed at.
 */
export function targetEnd(date: string | null | undefined): Date | null {
  const s = (date ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59);
    // A date that rolled over (month 13, Feb 31) was not a real date.
    return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? d : null;
  }
  m = /^(?:Q([1-4])\s+(\d{4})|(\d{4})\s+Q([1-4]))$/i.exec(s);
  if (m) {
    const q = Number(m[1] ?? m[4]);
    return new Date(Number(m[2] ?? m[3]), q * 3, 0, 23, 59, 59);
  }
  m = /^(?:H([12])\s+(\d{4})|(\d{4})\s+H([12]))$/i.exec(s);
  if (m) {
    const h = Number(m[1] ?? m[4]);
    return new Date(Number(m[2] ?? m[3]), h * 6, 0, 23, 59, 59);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s);
  if (m) {
    const word = m[1]!.toLowerCase();
    const mi = MONTHS.findIndex((mo) => word === mo || FULL_MONTHS[MONTHS.indexOf(mo)] === word || (word === 'sept' && mo === 'sep'));
    if (mi >= 0) return new Date(Number(m[2]), mi + 1, 0, 23, 59, 59);
  }
  m = /^(\d{4})$/.exec(s);
  if (m) return new Date(Number(m[1]), 12, 0, 23, 59, 59);
  return null;
}

/** True only when a readable stated target date is already behind us. */
export function isPastDue(date: string | null | undefined, now: Date): boolean {
  const end = targetEnd(date);
  return end !== null && end.getTime() < now.getTime();
}
