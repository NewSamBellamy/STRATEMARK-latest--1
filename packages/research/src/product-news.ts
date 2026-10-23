/**
 * "What's new" for one product: dated news stories from the free search lanes.
 *
 * No model is called and nothing is written: a story's title is the publisher's
 * own headline, verbatim, its date is the feed's, its link is the feed's. What
 * this module adds is a set of deterministic gates (AGENTS.md Rule 9), so a page
 * about one product never shows a story about another:
 *   - the story must be dated, not in the future, and recent (default 180 days);
 *   - the headline (or its summary) must name the product as a WHOLE WORD, and
 *     the company by a real alias (a product called "Operator" is not news
 *     until the company is named too), unless the product's own name already
 *     carries the company's;
 *   - a longer sibling product that contains this name ("Claude Code" for
 *     "Claude") does not count: removing the sibling's name must still leave a
 *     mention of the product itself;
 *   - rumour, leak and speculation wording is dropped: only reported fact is shown;
 *   - one story per address and per near-identical headline; newest first.
 * A failed lane is "could not look", never "nothing found".
 */
import type { Company, ProductNewsItem } from '@mi/contracts';
import { companyAliases, mentionsCompany } from './company-aliases';
import { displayName } from './live-intel';
import { moveUrlKey, movePublishedAt } from './company-moves';
import type { WebSearchFn, WebSearchResult } from './web-search';

export const PRODUCT_NEWS_MAX = 6;
export const PRODUCT_NEWS_WINDOW_DAYS = 180;

const escapeRe = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (name: string, flags = 'iu'): RegExp =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(name.trim()).replace(/\s+/g, '\\s+')}(?=$|[^\\p{L}\\p{N}])`, flags);

/** True when `text` names the product as a whole word. Names under 3 letters never match (too ambiguous). */
export function namesProduct(text: string, name: string, siblings: readonly string[] = []): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  let rest = text;
  // A longer product of the same company that contains this name ("Claude Code" for "Claude") is not this product.
  const longer = siblings.map((s) => s.trim()).filter((s) => s.length > n.length && wordRe(n).test(s)).sort((a, b) => b.length - a.length);
  for (const sibling of longer) rest = rest.replace(wordRe(sibling, 'giu'), ' ');
  return wordRe(n).test(rest);
}

/** Reported rumour, leak and speculation: not news about a product, whatever it names. */
const RUMOUR = /\b(?:rumou?rs?|rumou?red|leaks?|leaked|leaking|speculat\w*|reportedly|allegedly|insiders?|supposedly|unconfirmed|could\s+(?:launch|release|debut)|may\s+(?:launch|release|debut)|might\s+(?:launch|release|debut)|said\s+to|sources\s+say|tipped|teas(?:er|es|ing))\b/i;

export function isRumour(text: string): boolean {
  return RUMOUR.test(text);
}

export function productNewsQueries(company: Pick<Company, 'name'>, productName: string): string[] {
  const c = displayName(company.name);
  const p = productName.trim();
  const full = p.toLowerCase().includes(c.toLowerCase()) ? `"${p}"` : `"${c}" "${p}"`;
  return [`${full} launch OR update OR release OR announces OR pricing`, full];
}

export interface ProductNewsArgs {
  company: Pick<Company, 'id' | 'name' | 'websiteUrl'>;
  productName: string;
  /** Other product names of the same company, so "Claude Code" news is not shown on "Claude". */
  siblings?: readonly string[];
  /** Lanes in order (news feed first, then the general web index); all are asked, results merge. */
  searches: ReadonlyArray<WebSearchFn | null | undefined>;
  now?: Date;
  windowDays?: number;
  signal?: AbortSignal;
}

export interface ProductNewsResult {
  items: ProductNewsItem[];
  /** True only when at least one query on at least one lane really answered. A failure says nothing about whether news exists. */
  searched: boolean;
}

/** Whether one search row is a recent, dated, un-rumoured story about THIS product of THIS company. */
export function gateNewsRow(row: WebSearchResult, args: Pick<ProductNewsArgs, 'company' | 'productName' | 'siblings' | 'windowDays'>, now: Date): ProductNewsItem | null {
  const url = moveUrlKey(row.url);
  const title = row.title?.replace(/\s+/g, ' ').trim();
  const publishedAt = movePublishedAt(row.published, now);
  if (!url || !/^https:\/\//i.test(row.url) || !title || !publishedAt) return null;
  const age = now.getTime() - Date.parse(publishedAt);
  if (age > (args.windowDays ?? PRODUCT_NEWS_WINDOW_DAYS) * 86_400_000) return null;
  const aliases = companyAliases(args.company.name, args.company.websiteUrl);
  const snippet = (row.snippet ?? '').replace(/\s+/g, ' ').trim();
  const text = `${title} ${snippet}`;
  // The headline itself must carry the product: a summary alone may be about a neighbouring story.
  if (!namesProduct(title, args.productName, args.siblings)) return null;
  const carriesCompany = mentionsCompany(args.productName, aliases) || mentionsCompany(text, aliases);
  if (!carriesCompany) return null;
  if (isRumour(title) || isRumour(snippet)) return null;
  return { title: title.slice(0, 300), url: row.url.slice(0, 600), publisher: row.publisher?.trim().slice(0, 120) || null, publishedAt, snippet: snippet.slice(0, 300) };
}

const headlineKey = (title: string): string => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function findProductNews(args: ProductNewsArgs): Promise<ProductNewsResult> {
  const now = args.now ?? new Date();
  const lanes = args.searches.filter((l): l is WebSearchFn => typeof l === 'function');
  const queries = productNewsQueries(args.company, args.productName);
  let searched = false;
  const rows: WebSearchResult[] = [];
  for (const lane of lanes) {
    if (args.signal?.aborted) break;
    const answered = await Promise.all(queries.map((q) =>
      lane(q, { news: true, sinceDays: args.windowDays ?? PRODUCT_NEWS_WINDOW_DAYS }).then((r) => ({ r }), () => null)));
    for (const a of answered) if (a) { searched = true; rows.push(...a.r); }
  }
  const seenUrl = new Set<string>();
  const seenHeadline = new Set<string>();
  const items: ProductNewsItem[] = [];
  for (const row of rows) {
    const item = gateNewsRow(row, args, now);
    if (!item) continue;
    const key = moveUrlKey(item.url)!;
    const headline = headlineKey(item.title);
    if (seenUrl.has(key) || seenHeadline.has(headline)) continue;
    seenUrl.add(key);
    seenHeadline.add(headline);
    items.push(item);
  }
  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { items: items.slice(0, PRODUCT_NEWS_MAX), searched };
}
