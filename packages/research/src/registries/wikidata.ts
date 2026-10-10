/**
 * Wikidata registry adapter — identity by DOMAIN, never by name alone.
 *
 * A name search ("DJI" -> Djibouti) is only a candidate generator. A candidate
 * is accepted ONLY when its P856 official website shares the company's known
 * registrable domain, or when a JSON-LD sameAs link on the company's own site
 * already named the QID (identity.wikidataQid). Otherwise: no match, no facts.
 *
 * Facts: latest-dated P1128 (employees) and P2139 (revenue; native currency,
 * never converted, only when the unit is a known currency). asOf comes from
 * the P585 point-in-time qualifier; a claim with no date is returned flagged
 * `undated` (and only when it is the sole non-deprecated claim).
 */
import type {
  AdapterResult,
  EntityIdentity,
  IdentityEnrichment,
  IdentityEvidence,
  RegistryContext,
  RegistryFact,
  RegistrySource,
} from './types';
import { noMatch } from './types';
import { asRecord, fetchJson, registrableDomain, sameRegistrableDomain } from './shared';

const WD_API = 'https://www.wikidata.org/w/api.php';
const COMMONS_FILEPATH = 'https://commons.wikimedia.org/wiki/Special:FilePath';

/** Wikidata currency item -> ISO 4217. Unknown units yield no revenue fact. */
export const WIKIDATA_CURRENCIES: Record<string, string> = {
  Q4917: 'USD',
  Q4916: 'EUR',
  Q25224: 'GBP',
  Q8146: 'JPY',
  Q25344: 'CHF',
  Q39099: 'CNY',
  Q80524: 'INR',
  Q1104069: 'CAD',
  Q259502: 'AUD',
  Q202040: 'KRW',
  Q122922: 'SEK',
  Q132643: 'NOK',
  Q25417: 'DKK',
  Q131309: 'ILS',
  Q173117: 'BRL',
  Q190951: 'SGD',
  Q31015: 'HKD',
};

export function wikidataItemUrl(qid: string): string {
  return `https://www.wikidata.org/wiki/${qid}`;
}

type Claim = Record<string, unknown>;

function claimsOf(entity: Record<string, unknown>, prop: string): Claim[] {
  const claims = asRecord(entity.claims);
  const list = claims?.[prop];
  return Array.isArray(list) ? (list.filter((c) => asRecord(c)) as Claim[]) : [];
}

function rawValue(claim: Claim): unknown {
  return asRecord(asRecord(claim.mainsnak)?.datavalue)?.value;
}

function stringClaims(entity: Record<string, unknown>, prop: string): string[] {
  return claimsOf(entity, prop)
    .filter((c) => c.rank !== 'deprecated')
    .map((c) => rawValue(c))
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** "+2026-03-00T00:00:00Z" + precision -> "2026-03" / "2026" / "2026-03-14". */
export function wikidataTimeToAsOf(time: unknown, precision: unknown): string | null {
  if (typeof time !== 'string') return null;
  const m = /^[+-]?(\d{4,})-(\d{2})-(\d{2})/.exec(time);
  if (!m) return null;
  const [, y, mo, d] = m;
  const p = typeof precision === 'number' ? precision : 11;
  if (p <= 9) return y!;
  if (p === 10 || d === '00') return mo === '00' ? y! : `${y}-${mo}`;
  return `${y}-${mo}-${d}`;
}

function pointInTime(claim: Claim): string | null {
  const quals = asRecord(claim.qualifiers);
  const list = quals?.P585;
  if (!Array.isArray(list)) return null;
  for (const q of list) {
    const v = asRecord(asRecord(asRecord(q)?.datavalue)?.value);
    const asOf = wikidataTimeToAsOf(v?.time, v?.precision);
    if (asOf) return asOf;
  }
  return null;
}

/** Sort key so "2026-03" > "2026" > "2025-12"; comparisons are lexical on padded form. */
function asOfKey(asOf: string): string {
  const [y = '0000', mo = '99', d = '99'] = asOf.split('-');
  return `${y}-${mo}-${d}`;
}

function referenceUrl(claim: Claim): string | null {
  const refs = claim.references;
  if (!Array.isArray(refs)) return null;
  for (const ref of refs) {
    const snaks = asRecord(asRecord(ref)?.snaks);
    const list = snaks?.P854;
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      const v = asRecord(asRecord(s)?.datavalue)?.value;
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
    }
  }
  return null;
}

interface PickedClaim {
  amount: number;
  unitQid: string | null;
  asOf: string | null;
  reference: string | null;
}

function quantityOf(claim: Claim): { amount: number; unitQid: string | null } | null {
  const v = asRecord(rawValue(claim));
  if (!v || typeof v.amount !== 'string') return null;
  const amount = Number(v.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = typeof v.unit === 'string' ? /Q\d+$/.exec(v.unit)?.[0] ?? null : null;
  return { amount, unitQid: unit };
}

/**
 * Latest-dated non-deprecated claim wins. With no dated claim, a single
 * undated claim is returned (flagged by asOf null); several undated claims are
 * ambiguous and yield nothing rather than a guess.
 */
export function pickLatestClaim(
  entity: Record<string, unknown>,
  prop: string,
  accept: (unitQid: string | null) => boolean = () => true,
): PickedClaim | null {
  const usable: PickedClaim[] = [];
  for (const claim of claimsOf(entity, prop)) {
    if (claim.rank === 'deprecated') continue;
    const q = quantityOf(claim);
    if (!q || !accept(q.unitQid)) continue;
    usable.push({ amount: q.amount, unitQid: q.unitQid, asOf: pointInTime(claim), reference: referenceUrl(claim) });
  }
  const dated = usable.filter((u) => u.asOf);
  if (dated.length) {
    dated.sort((a, b) => asOfKey(b.asOf!).localeCompare(asOfKey(a.asOf!)));
    const top = dated[0]!;
    // Same-date conflicting values are ambiguous.
    const tied = dated.filter((d) => d.asOf === top.asOf && d.amount !== top.amount);
    return tied.length ? null : top;
  }
  const distinct = new Set(usable.map((u) => `${u.amount}|${u.unitQid}`));
  return usable.length && distinct.size === 1 ? usable[0]! : null;
}

function commonsUrl(fileName: string): string {
  return `${COMMONS_FILEPATH}/${encodeURIComponent(fileName.replace(/ /g, '_'))}`;
}

function tickerOf(entity: Record<string, unknown>): string | undefined {
  const direct = stringClaims(entity, 'P249')[0];
  if (direct) return direct;
  for (const claim of claimsOf(entity, 'P414')) {
    const list = asRecord(claim.qualifiers)?.P249;
    if (!Array.isArray(list)) continue;
    const v = asRecord(asRecord(list[0])?.datavalue)?.value;
    if (typeof v === 'string' && v) return v;
  }
  return undefined;
}

function buildResult(
  qid: string,
  entity: Record<string, unknown>,
  identity: IdentityEvidence,
): AdapterResult {
  const sourceUrl = wikidataItemUrl(qid);
  const apiUrl = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
  const facts: RegistryFact[] = [];

  const emp = pickLatestClaim(entity, 'P1128');
  if (emp) {
    facts.push({
      registry: 'wikidata',
      metric: 'employees',
      metricType: 'employees',
      value: emp.amount,
      band: null,
      unit: 'employees',
      asOf: emp.asOf,
      undated: emp.asOf === null,
      sourceUrl,
      apiUrl,
      referenceUrl: emp.reference,
      cardFaceSafe: true,
      methodNote: `Wikidata ${qid} (P1128 number of employees${emp.asOf ? `, point in time ${emp.asOf}` : ', undated'}${emp.reference ? `; cited reference ${emp.reference}` : ''})`,
      identity,
    });
  }

  const rev = pickLatestClaim(entity, 'P2139', (u) => !!u && u in WIKIDATA_CURRENCIES);
  if (rev && rev.unitQid) {
    const currency = WIKIDATA_CURRENCIES[rev.unitQid]!;
    facts.push({
      registry: 'wikidata',
      metric: 'revenue',
      metricType: null,
      value: rev.amount,
      band: null,
      unit: currency,
      asOf: rev.asOf,
      undated: rev.asOf === null,
      sourceUrl,
      apiUrl,
      referenceUrl: rev.reference,
      cardFaceSafe: true,
      methodNote: `Wikidata ${qid} (P2139 total revenue, ${currency}, native currency not converted${rev.asOf ? `, point in time ${rev.asOf}` : ', undated'}${rev.reference ? `; cited reference ${rev.reference}` : ''})`,
      identity,
    });
  }

  const enrichment: IdentityEnrichment = { wikidataQid: qid };
  const logo = stringClaims(entity, 'P154')[0];
  if (logo) enrichment.logoUrl = commonsUrl(logo);
  const lei = stringClaims(entity, 'P1278')[0];
  if (lei) enrichment.lei = lei;
  const ticker = tickerOf(entity);
  if (ticker) enrichment.ticker = ticker;
  const website = stringClaims(entity, 'P856')[0];
  if (website) enrichment.website = website;

  return { status: 'matched', facts, enrichment };
}

interface EntitiesResponse {
  entities?: Record<string, Record<string, unknown>>;
}

async function getEntities(ids: string[], ctx: RegistryContext): Promise<Record<string, Record<string, unknown>>> {
  if (!ids.length) return {};
  const url = `${WD_API}?origin=*&format=json&action=wbgetentities&props=claims&ids=${ids.join('|')}`;
  const json = (await fetchJson(url, ctx)) as EntitiesResponse;
  return json.entities ?? {};
}

export const wikidataSource: RegistrySource = {
  id: 'wikidata',
  applies: () => true,
  async lookup(identity: EntityIdentity, ctx: RegistryContext): Promise<AdapterResult> {
    const domain = registrableDomain(identity.domain);
    const knownQid = identity.wikidataQid && /^Q\d+$/i.test(identity.wikidataQid) ? identity.wikidataQid.toUpperCase() : null;
    if (!domain && !knownQid) return noMatch('no known domain or sameAs QID to confirm identity');

    // 1. A QID named by the company's own JSON-LD sameAs is accepted outright.
    if (knownQid) {
      const entities = await getEntities([knownQid], ctx);
      const entity = entities[knownQid];
      if (entity && !entity.missing) {
        return buildResult(knownQid, entity, { kind: 'jsonld-sameas', qid: knownQid });
      }
    }
    if (!domain) return noMatch('sameAs QID not found on Wikidata');

    // 2. Name search only generates candidates; domain decides.
    const searchUrl = `${WD_API}?origin=*&format=json&action=wbsearchentities&language=en&type=item&limit=7&search=${encodeURIComponent(identity.name)}`;
    const search = asRecord(await fetchJson(searchUrl, ctx));
    const hits = Array.isArray(search?.search) ? (search!.search as unknown[]) : [];
    const ids = hits
      .map((h) => asRecord(h)?.id)
      .filter((id): id is string => typeof id === 'string' && /^Q\d+$/.test(id))
      .slice(0, 7);
    if (!ids.length) return noMatch('no Wikidata candidates for name');

    const entities = await getEntities(ids, ctx);
    const accepted: Array<{ qid: string; entity: Record<string, unknown>; matchedOn: string }> = [];
    for (const qid of ids) {
      const entity = entities[qid];
      if (!entity) continue;
      const site = stringClaims(entity, 'P856').find((w) => sameRegistrableDomain(w, domain));
      if (site) accepted.push({ qid, entity, matchedOn: site });
    }
    if (!accepted.length) return noMatch(`no candidate's P856 website matches ${domain}`);
    if (accepted.length > 1) return noMatch(`ambiguous: ${accepted.length} candidates share ${domain}`);
    const hit = accepted[0]!;
    return buildResult(hit.qid, hit.entity, { kind: 'domain-match', domain, matchedOn: hit.matchedOn });
  },
};
