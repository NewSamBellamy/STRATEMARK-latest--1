/**
 * One registry of publishers for the Source check (PLAN-CRAAP 1.5). It does not
 * replace `classifySource` (whose outputs are frozen and snapshot-tested in
 * source-classification.test.ts); it adds the finer tier the Source check shows
 * and the per-metric fit. A test keeps the two in agreement.
 *
 * Tiers: 1 regulator/filing, 2 the company itself or a wire service, 3 independent
 * editorial, 4 data/analyst/aggregator, 5 community/sponsored/unknown/junk.
 *
 * Pure: no clock, no network.
 */
import type { MetricType } from './enums';

export type PublisherTier = 1 | 2 | 3 | 4 | 5;
export type PublisherFit = 'strong' | 'acceptable' | 'weak';

const REGULATORS = [
  'sec.gov', 'uscourts.gov', 'companieshouse.gov.uk', 'find-and-update.company-information.service.gov.uk',
  'sedarplus.ca', 'hkexnews.hk', 'irs.gov', 'europa.eu', 'fca.org.uk', 'nerc.gov', 'ferc.gov',
];

/** Press-release wire services: the company's own words, copied widely. */
export const WIRE_HOSTS = [
  'businesswire.com', 'prnewswire.com', 'globenewswire.com', 'accesswire.com', 'einpresswire.com', 'prweb.com', 'newsfilecorp.com',
];

const EDITORIAL = [
  'reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'apnews.com', 'nytimes.com', 'bbc.com', 'bbc.co.uk', 'economist.com',
  'cnbc.com', 'forbes.com', 'fortune.com', 'marketwatch.com', 'barrons.com', 'washingtonpost.com', 'theguardian.com',
  'axios.com', 'businessinsider.com', 'nikkei.com', 'scmp.com', 'techcrunch.com', 'theinformation.com', 'venturebeat.com',
  'wired.com', 'arstechnica.com', 'electrek.co', 'cleantechnica.com', 'utilitydive.com', 'pv-magazine.com',
  'energy-storage.news', 'greentechmedia.com', 'power-eng.com',
];

const DATA_AND_ANALYSTS = [
  'crunchbase.com', 'pitchbook.com', 'tracxn.com', 'cbinsights.com', 'sacra.com', 'statista.com', 'similarweb.com',
  'stockanalysis.com', 'macrotrends.net', 'companiesmarketcap.com', 'morningstar.com', 'factset.com', 'marketscreener.com',
  'finance.yahoo.com', 'gartner.com', 'idc.com', 'counterpointresearch.com', 'canalys.com', 'mckinsey.com', 'bcg.com',
  'deloitte.com', 'pwc.com', 'ey.com', 'iea.org', 'irena.org', 'woodmac.com', 'woodmackenzie.com', 'trendforce.com',
  'yolegroup.com', 'sensortower.com', 'tradingview.com', 'investing.com', 'wisesheets.io', 'simplywall.st', 'spglobal.com',
  'globaldata.com',
];

const COMMUNITY = [
  'reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'quora.com', 'stocktwits.com',
  'github.com', 'wikipedia.org',
];

export const PUBLISHER_REGISTRY: Readonly<Record<string, PublisherTier>> = Object.freeze({
  ...Object.fromEntries(REGULATORS.map((h) => [h, 1 as const])),
  ...Object.fromEntries(WIRE_HOSTS.map((h) => [h, 2 as const])),
  ...Object.fromEntries(EDITORIAL.map((h) => [h, 3 as const])),
  ...Object.fromEntries(DATA_AND_ANALYSTS.map((h) => [h, 4 as const])),
  ...Object.fromEntries(COMMUNITY.map((h) => [h, 5 as const])),
});

/** Lowercased host without `www.`, or null when the value is not a usable URL or domain. */
export function registryHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch { return null; }
}

const belongs = (host: string, domain: string): boolean => host === domain || host.endsWith(`.${domain}`);

/** The registry entry a host falls under (its own or a parent domain), or null. */
export function registeredDomain(host: string): string | null {
  return Object.keys(PUBLISHER_REGISTRY).find((domain) => belongs(host, domain)) ?? null;
}

export const isWireHost = (host: string): boolean => WIRE_HOSTS.some((domain) => belongs(host, domain));

/** Wire datelines retained text carries even when the page is a reprint on another domain. */
export const WIRE_DATELINE = /\/PRNewswire\/|\(\s*BUSINESS WIRE\s*\)|\/GLOBE ?NEWSWIRE\/|\/PRNewswire-|\(ACCESSWIRE\)|\(EINPresswire\.com\)|\(PRWEB\)|\(NEWSFILE CORP\.?\)/i;

/**
 * Tier of a source. The company's own site is tier 2; a host in no list is tier 5
 * (unknown). Opaque grounding redirects have no host and are tier 5 too.
 */
export function publisherTier(url: string, officialWebsite?: string | null): PublisherTier {
  const host = registryHost(url);
  if (!host) return 5;
  const official = registryHost(officialWebsite);
  const registered = registeredDomain(host);
  if (registered) return PUBLISHER_REGISTRY[registered]!;
  if (official && belongs(host, official)) return 2;
  return 5;
}

/**
 * How well a publisher tier fits the metric (default: strong = regulator, acceptable =
 * company/editorial, weak = data aggregators and unknown). Overrides per PLAN-CRAAP 1.5.
 */
export function publisherFit(tier: PublisherTier, metric: MetricType): PublisherFit {
  if (metric === 'market_cap') return tier === 1 || tier === 4 ? 'strong' : tier === 2 || tier === 3 ? 'acceptable' : 'weak';
  if (metric === 'market_share') return tier === 1 || tier === 4 ? 'strong' : tier === 2 || tier === 3 ? 'acceptable' : 'weak';
  if (metric === 'funding_total' || metric === 'last_round') return tier === 1 ? 'strong' : tier <= 4 ? 'acceptable' : 'weak';
  return tier === 1 ? 'strong' : tier === 2 || tier === 3 ? 'acceptable' : 'weak';
}

/** Reprints that name their agency, so they are one reporter's copy, not new corroboration. */
const AGENCY_REPRINT: ReadonlyArray<readonly [RegExp, string]> = [
  [/\(\s*Reuters\s*\)\s*[-–—]/i, 'reuters'],
  [/\(\s*AP\s*\)\s*[-–—]/i, 'ap'],
];
const COMPANY_VOICE = /\b(?:according to the company|the company (?:said|says|stated|announced|reported)|said in a (?:press release|statement))\b/i;

/**
 * Who a source speaks for, for counting independent sources (PLAN-CRAAP 1.6): the
 * company itself (its site, wires, wire datelines, "according to the company"
 * text), a named agency, a regulator, else the registrable domain. Wire copy is
 * never independent: five reprints of one press release are one `company` source.
 */
export function independenceKey(url: string, text: string | null | undefined, officialWebsite?: string | null): string {
  const host = registryHost(url);
  if (!host) return 'unknown';
  const body = text ?? '';
  const official = registryHost(officialWebsite);
  if ((official && belongs(host, official)) || isWireHost(host) || WIRE_DATELINE.test(body) || COMPANY_VOICE.test(body)) return 'company';
  const agency = AGENCY_REPRINT.find(([pattern]) => pattern.test(body));
  if (agency) return agency[1];
  if (publisherTier(url, officialWebsite) === 1) return `regulator:${host}`;
  return registeredDomain(host) ?? host.split('.').slice(-2).join('.');
}
