/**
 * Wikidata headshots: a real Commons portrait (P18) for a person, accepted ONLY
 * when the entity is a human (P31=Q5) demonstrably tied to the company — via
 * employer / position / officer claims, or a description naming the company.
 * A namesake at another company is rejected; no match → null (initials stay).
 * Free and keyless (wbsearchentities / wbgetentities, origin=*).
 */

export interface WikidataShot {
  thumb: string;
  sourceUrl: string;
}

type Fetch = typeof fetch;

const API = 'https://www.wikidata.org/w/api.php';
const LEGAL_SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|llc|ltd|limited|plc|pbc|sas|sa|gmbh|ag|nv|bv|se|ab|oy|spa|srl|holdings?|group)\b\.?/gi;
/** Claims on the PERSON that tie them to an organisation. */
const LINK_PROPS = ['P108', 'P39', 'P488', 'P1037', 'P3320', 'P463'] as const;

/** "Anthropic, PBC" -> "anthropic"; strips legal suffixes and punctuation. */
export function companyAliases(companyName: string, aliases: string[] = []): string[] {
  const out = new Set<string>();
  for (const raw of [companyName, ...aliases]) {
    const a = raw.replace(LEGAL_SUFFIX, ' ').replace(/[^\p{L}\p{N}\s&.-]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    if (a.length >= 3) out.add(a);
  }
  return [...out];
}

/** Whole-word containment so "Meta" never matches "Metadata". */
export function mentionsAny(text: string, aliases: string[]): boolean {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s&.-]/gu, ' ').replace(/\s+/g, ' ')} `;
  return aliases.some((a) => t.includes(` ${a} `) || t.includes(` ${a}.`) || t.includes(` ${a}'s `));
}

interface Snak { mainsnak?: { datavalue?: { value?: unknown } } }
interface Entity {
  id?: string;
  labels?: Record<string, { value: string }>;
  aliases?: Record<string, Array<{ value: string }>>;
  descriptions?: Record<string, { value: string }>;
  claims?: Record<string, Snak[]>;
}

const qidsOf = (e: Entity, prop: string): string[] =>
  (e.claims?.[prop] ?? [])
    .map((c) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id)
    .filter((x): x is string => typeof x === 'string');

const isHuman = (e: Entity) => qidsOf(e, 'P31').includes('Q5');

function p18(e: Entity): string | null {
  const v = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
  return typeof v === 'string' && v.trim() ? v : null;
}

const labelText = (e: Entity): string =>
  [e.labels?.en?.value ?? '', ...(e.aliases?.en ?? []).map((a) => a.value)].join(' | ');

async function getJson<T>(f: Fetch, params: Record<string, string>): Promise<T | null> {
  try {
    const qs = new URLSearchParams({ format: 'json', origin: '*', ...params });
    const res = await f(`${API}?${qs.toString()}`, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** The pure decision: first candidate that is a verified human of this company with a photo. */
export function pickVerifiedPerson(
  candidates: Entity[],
  orgEntities: Record<string, Entity>,
  personName: string,
  aliases: string[],
): { file: string; qid: string } | null {
  const full = personName.trim().toLowerCase();
  for (const e of candidates) {
    if (!isHuman(e)) continue;
    const file = p18(e);
    if (!file || !e.id) continue;
    // Name must match the label (or an alias) exactly — no near-miss people.
    const names = [e.labels?.en?.value, ...(e.aliases?.en ?? []).map((a) => a.value)]
      .filter((x): x is string => !!x).map((x) => x.trim().toLowerCase());
    if (!names.includes(full)) continue;
    const linked = LINK_PROPS.flatMap((p) => qidsOf(e, p));
    const viaClaims = linked.some((q) => mentionsAny(labelText(orgEntities[q] ?? {}), aliases));
    const viaDescription = mentionsAny(e.descriptions?.en?.value ?? '', aliases);
    if (viaClaims || viaDescription) return { file, qid: e.id };
  }
  return null;
}

export const commonsThumb = (file: string): string =>
  `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=256`;

export async function fetchWikidataHeadshot(
  personName: string,
  companyName: string,
  companyAliasList: string[] = [],
  f: Fetch = fetch,
): Promise<WikidataShot | null> {
  const aliases = companyAliases(companyName, companyAliasList);
  if (!personName.trim() || aliases.length === 0) return null;
  const search = await getJson<{ search?: Array<{ id: string }> }>(f, {
    action: 'wbsearchentities', search: personName.trim(), language: 'en', type: 'item', limit: '5',
  });
  const ids = (search?.search ?? []).map((s) => s.id).filter(Boolean);
  if (ids.length === 0) return null;
  const people = await getJson<{ entities?: Record<string, Entity> }>(f, {
    action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|descriptions|claims', languages: 'en',
  });
  const candidates = ids.map((id) => people?.entities?.[id]).filter((e): e is Entity => !!e);
  const orgIds = [...new Set(candidates.filter(isHuman).flatMap((e) => LINK_PROPS.flatMap((p) => qidsOf(e, p))))].slice(0, 50);
  let orgs: Record<string, Entity> = {};
  if (orgIds.length > 0) {
    const r = await getJson<{ entities?: Record<string, Entity> }>(f, {
      action: 'wbgetentities', ids: orgIds.join('|'), props: 'labels|aliases', languages: 'en',
    });
    orgs = r?.entities ?? {};
  }
  const hit = pickVerifiedPerson(candidates, orgs, personName, aliases);
  if (!hit) return null;
  return {
    thumb: commonsThumb(hit.file),
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(hit.file.replace(/ /g, '_'))}`,
  };
}
