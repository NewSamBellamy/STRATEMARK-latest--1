/**
 * JSON-LD Organization extraction — pure, no network. Tolerates @graph,
 * arrays, multiple script blocks, and malformed JSON (skipped).
 */
import { asRecord } from './shared';

export interface OrganizationJsonLd {
  name: string | null;
  url: string | null;
  logo: string | null;
  sameAs: string[];
  foundingDate: string | null;
  addressCountry: string | null;
  addressLocality: string | null;
  addressRegion: string | null;
  /** QID extracted from a sameAs wikidata link, if any. */
  wikidataQid: string | null;
}

const ORG_TYPE = /^(Organization|Corporation|LocalBusiness|NGO|OnlineBusiness|OnlineStore|Airline|Store|ProfessionalService|[A-Za-z]*Company)$/;

function strOf(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = strOf(item);
      if (s) return s;
    }
    return null;
  }
  const rec = asRecord(v);
  if (rec) return strOf(rec.url) ?? strOf(rec.contentUrl) ?? strOf(rec['@id']) ?? strOf(rec.name);
  return null;
}

function typesOf(node: Record<string, unknown>): string[] {
  const t = node['@type'];
  const list = typeof t === 'string' ? [t] : Array.isArray(t) ? t : [];
  return list
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.replace(/^https?:\/\/schema\.org\//, ''));
}

function collectNodes(value: unknown, out: Record<string, unknown>[], depth = 0): void {
  if (depth > 6) return;
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out, depth + 1);
    return;
  }
  const rec = asRecord(value);
  if (!rec) return;
  out.push(rec);
  if (rec['@graph']) collectNodes(rec['@graph'], out, depth + 1);
}

export function wikidataQidFromUrl(url: string): string | null {
  const m = /^https?:\/\/(?:www\.)?wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i.exec(url.trim());
  return m ? m[1]!.toUpperCase() : null;
}

export function extractOrganizationJsonLd(html: string): OrganizationJsonLd | null {
  if (!html) return null;
  const nodes: Record<string, unknown>[] = [];
  // A linear scan, not one lazy regex: a hostile page full of unterminated <script tags
  // must not make the reader quadratic.
  const starts = /<script/gi;
  const ends = /<\/script/gi;
  for (let m = starts.exec(html); m; m = starts.exec(html)) {
    const at = m.index;
    const open = html.slice(at, at + 2001).indexOf('>');
    if (open < 0) continue;
    if (!/type\s*=\s*["']?application\/ld\+json/i.test(html.slice(at, at + open))) continue;
    ends.lastIndex = at + open;
    const close = ends.exec(html);
    if (!close) break;
    try {
      collectNodes(JSON.parse(html.slice(at + open + 1, close.index).trim()), nodes);
    } catch {
      /* malformed block — skip */
    }
    starts.lastIndex = close.index;
  }
  const orgs = nodes.filter((n) => typesOf(n).some((t) => ORG_TYPE.test(t)));
  if (!orgs.length) return null;
  const org = orgs.find((n) => strOf(n.name)) ?? orgs[0]!;

  const sameAsRaw = org.sameAs;
  const sameAs = (Array.isArray(sameAsRaw) ? sameAsRaw : sameAsRaw ? [sameAsRaw] : [])
    .map((s) => strOf(s))
    .filter((s): s is string => !!s && /^https?:\/\//i.test(s));

  const addr = asRecord(Array.isArray(org.address) ? org.address[0] : org.address);
  let wikidataQid: string | null = null;
  for (const link of sameAs) {
    wikidataQid = wikidataQidFromUrl(link);
    if (wikidataQid) break;
  }
  return {
    name: strOf(org.name),
    url: strOf(org.url),
    logo: strOf(org.logo),
    sameAs,
    foundingDate: strOf(org.foundingDate),
    addressCountry: addr ? strOf(addr.addressCountry) ?? strOf(asRecord(addr.addressCountry)?.name) : null,
    addressLocality: addr ? strOf(addr.addressLocality) : null,
    addressRegion: addr ? strOf(addr.addressRegion) : null,
    wikidataQid,
  };
}
