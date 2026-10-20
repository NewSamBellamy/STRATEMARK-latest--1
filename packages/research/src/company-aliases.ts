import { nameTokens, registrableDomain } from './registries/shared';

/**
 * The names a source actually uses for a company. Stored names are often legal
 * or compound ("Anthropic, PBC", "SpaceX (Space Exploration Technologies
 * Corp.)", "Heineken N.V. / Heineken 0.0") while articles say "Anthropic" or
 * "SpaceX". Matching on the full stored name rejects real, sourced evidence.
 *
 * Each alias is a lower-case, suffix-free token phrase of at least 3 letters.
 */
const EXTRA_SUFFIX = new Set(['pbc', 'group', 'holdings', 'holding', 'technologies', 'labs', 'lab', 'the']);

/** "McDonald's" and "McDonalds" are one name, and "Procter & Gamble" is "Procter and Gamble". */
export const canon = (text: string): string => text.replace(/['\u2018\u2019`\u00b4]/g, '').replace(/&/g, ' and ');

function phrase(raw: string, dropExtra: boolean): string {
  const tokens = nameTokens(canon(raw));
  const kept = dropExtra ? tokens.filter((t) => !EXTRA_SUFFIX.has(t)) : tokens;
  return (kept.length ? kept : tokens).join(' ');
}

function domainLabel(websiteUrl: string | null | undefined): string | null {
  // The registrable label ("spacex" for shop.spacex.com, "carlsberg" for
  // carlsberg.co.uk), never a subdomain such as "shop" or "investors".
  const label = registrableDomain(websiteUrl)?.split('.')[0] ?? '';
  return label.length >= 4 && /^[a-z0-9-]+$/.test(label) ? label.replace(/-/g, ' ') : null;
}

/** A secondary part ("Space Exploration Technologies" in "SpaceX (…)") is an
 * alias only when it visibly overlaps the primary name or the official domain
 * label. A parenthetical PARENT ("Seedlip (Diageo plc)") or a bare legal form
 * ("Anthropic, PBC" → "PBC") must never become an alias: it would attribute the
 * parent's products and executives to the subsidiary. */
function overlaps(candidate: string[], anchors: string[]): boolean {
  return candidate.some((token) => token.length >= 3 && anchors.some((anchor) => anchor.length >= 3 &&
    (anchor.includes(token) || token.includes(anchor))));
}

export function companyAliases(rawName: string, websiteUrl?: string | null): string[] {
  // Dotted/slashed legal forms ("N.V.", "S.A.", "B.V.", "A/S") fold to their
  // suffix token ("nv", "sa", "bv", "as") so the suffix strip applies and the
  // "/" split does not cut "A/S" in half.
  const name = canon(rawName).replace(/\b([a-z])\.\s?([a-z])\.(?:\s?([a-z])\.)?/gi, '$1$2$3').replace(/\b([a-z])\/([a-z])\b/gi, '$1$2');
  const [primary = name, ...secondary] = name.split(/[/()]|,\s*|\s+[–—-]\s+/).map((p) => p.trim()).filter(Boolean);
  const label = domainLabel(websiteUrl);
  const anchors = [...nameTokens(primary).filter((t) => !EXTRA_SUFFIX.has(t)), ...(label ? label.split(' ') : [])];
  const parts = [name, primary, ...secondary.filter((part) =>
    overlaps(nameTokens(part).filter((t) => !EXTRA_SUFFIX.has(t)), anchors))];
  const out = new Set<string>();
  for (const part of parts) {
    for (const drop of [false, true]) {
      const p = phrase(part, drop);
      if (p.replace(/\s/g, '').length >= 3) out.add(p);
    }
  }
  if (label) out.add(label);
  return [...out].sort((a, b) => b.length - a.length);
}

/** Folded text for alias matching: lower case, diacritics and punctuation removed. */
function folded(text: string): string {
  return ` ${nameTokens(canon(text)).join(' ')} ` // nameTokens also drops legal suffixes; harmless for matching
    .replace(/\s+/g, ' ');
}

/**
 * Where, in the folded text, each alias is named (start and end of the match, as whole words). Folding is the same as
 * `mentionsCompany`, so positions from different aliases of the same text can be compared.
 */
export function aliasSpans(text: string, aliases: readonly string[]): Array<[number, number]> {
  const hay = folded(text);
  const spans: Array<[number, number]> = [];
  for (const alias of aliases) {
    if (!alias) continue;
    const needle = ` ${alias} `;
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) spans.push([at + 1, at + 1 + alias.length]);
  }
  return spans;
}

/** True when the text names the company by any of its aliases, as whole words. */
export function mentionsCompany(text: string, aliases: readonly string[]): boolean {
  const hay = folded(text);
  return aliases.some((alias) => hay.includes(` ${alias} `));
}
