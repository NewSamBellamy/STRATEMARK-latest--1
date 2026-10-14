/**
 * SEC Form D lane — a private company's latest exempt offering, from the
 * notice the issuer itself files with the SEC under Regulation D. Free,
 * official, zero provider calls.
 *
 * Flow (over any reader: the node reader, the Worker relay, a test double):
 *   1. EDGAR's entity index resolves the company to exactly ONE registrant
 *      whose legal name (legal suffix aside) equals the company's name.
 *      Brand-named SPVs ("HII Anysphere-01, a Series of HII Anysphere LLC")
 *      never match, and two equal names refuse to pick.
 *   2. The registrant's submissions feed lists its Form D / D/A notices.
 *   3. The newest notices' structured `primary_doc.xml` are parsed to a
 *      bounded JSON record (the reader keeps only that, hashed against the
 *      whole document).
 *
 * Data integrity:
 *   - Identity: the filing's own issuer CIK and legal name must match, AND its
 *     business address (city, or state/country) must appear in the company's
 *     known headquarters. No headquarters on record → no figure.
 *   - Pooled investment funds and business-combination notices are not
 *     funding rounds of an operating company; they are skipped.
 *   - The figure is the amount SOLD in the latest offering (the latest notice
 *     of that offering, so an amendment's updated total wins). An "Indefinite"
 *     offering, an unstated or $0 amount sold, or two different offerings
 *     tied for latest produce nothing.
 *   - A Form D amount is not a priced valuation and names no round stage
 *     (no "Series D"); neither is ever derived from it.
 *   - The row is ESTIMATED tier, never verified: the amount is exactly as
 *     filed, but "latest round" is an inference — a later round the company
 *     did not file on Form D would not appear here. Funding totals are not
 *     summed from Form D notices (filings are not a complete funding history).
 */
import { z } from 'zod';
import { usableCitations, type Citation } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';
import { companyNameKey } from './market-quote';
import type { FormDFilingRow } from './sec-filings';
import { decodeSecXml, parseScheduleFilingIndex, scheduleDocumentUrl, secSubmissionsUrl, secXmlBlocks, secXmlField } from './sec-ownership';

/** Newest Form D notices parsed per company: two SEC reads at a time. */
export const MAX_FORM_D_READS = 4;
/** A "latest round" older than the evidence window is not reported as current. */
export const FORM_D_MAX_AGE_DAYS = 366;
const MAX_TEXT = 4000;
const MAX_NAME = 160;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;
const padCik = (cik: string) => cik.replace(/\D/g, '').padStart(10, '0');

/** EDGAR's entity index (the search box's company lookup): names and CIKs only. */
export function secEntityLookupUrl(companyName: string): string {
  return `https://efts.sec.gov/LATEST/search-index?keysTyped=${encodeURIComponent(companyName.trim())}`;
}

/** The structured Form D notice itself — what the reader parses and the row cites. */
export function formDDocumentUrl(cik: string, accession: string): string {
  return scheduleDocumentUrl(cik, accession);
}

const entityLookupSchema = z.object({
  hits: z.object({
    hits: z.array(z.object({
      _id: z.string().regex(/^\d{1,10}$/),
      _source: z.object({ entity: z.string().min(1).max(400) }).passthrough(),
    }).passthrough()).max(100),
  }).passthrough(),
}).passthrough();

/** The one registrant whose legal name equals the company's (legal suffix
 * aside). EDGAR appends a ticker in parentheses for listed registrants; that
 * is not part of the name. None, or two distinct CIKs, is null. */
export function secEntityMatch(lookupJson: string, companyName: string): { cik: string; name: string } | null {
  const wanted = companyNameKey(companyName);
  if (wanted.length < 3) return null;
  let doc: z.infer<typeof entityLookupSchema>;
  try { doc = entityLookupSchema.parse(JSON.parse(lookupJson)); } catch { return null; }
  const matches = new Map<string, string>();
  for (const hit of doc.hits.hits) {
    const name = hit._source.entity.replace(/\s*\([A-Z0-9.\-, ]{1,40}\)\s*$/, '').trim();
    if (companyNameKey(name) === wanted) matches.set(padCik(hit._id), name.slice(0, MAX_NAME));
  }
  if (matches.size !== 1) return null;
  const [cik, name] = [...matches.entries()][0]!;
  return { cik, name };
}

// ---------------------------------------------------------------------------
// One structured Form D notice → its offering facts.

export interface FormDDocument {
  form: 'D' | 'D/A';
  live: boolean;
  cik: string;
  entityName: string;
  city: string | null;
  /** EDGAR state/country code (CA, NY, X0 …) and its description (CALIFORNIA, UNITED KINGDOM …). */
  state: string | null;
  stateDescription: string | null;
  industryGroup: string | null;
  pooledFund: boolean;
  businessCombination: boolean;
  isAmendment: boolean;
  previousAccession: string | null;
  dateOfFirstSale: string | null;
  firstSaleYetToOccur: boolean;
  securities: string[];
  /** Dollars as filed; 'Indefinite' when the issuer states no fixed size. */
  totalOfferingAmount: number | 'Indefinite' | null;
  totalAmountSold: number | null;
  signatureDate: string | null;
}

const SECURITY_TYPES: ReadonlyArray<[string, string]> = [
  ['isEquityType', 'Equity'], ['isDebtType', 'Debt'], ['isOptionToAcquireType', 'Option, warrant or other right'],
  ['isSecurityToBeAcquiredType', 'Security to be acquired on exercise'], ['isPooledInvestmentFundType', 'Pooled investment fund interests'],
  ['isTenantInCommonType', 'Tenant-in-common'], ['isMineralPropertyType', 'Mineral property'], ['isOtherType', 'Other'],
];

function dollars(raw: string | null): number | null {
  if (!raw || !/^\d{1,15}(?:\.\d{1,2})?$/.test(raw.trim())) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const calendarDate = (value: string | null): string | null => value && datePattern.test(value) &&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value ? value : null;

/** Parse a structured Form D `primary_doc.xml`. Anything that is not a Form D
 * notice is null — never a partial guess. */
export function parseFormDXml(xml: string): FormDDocument | null {
  if (!/<(?:\w+:)?edgarSubmission\b/.test(xml)) return null;
  const doc = xml.replace(/<!--[^]*?-->/g, '').replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
  const form = secXmlField(doc, 'submissionType');
  if (form !== 'D' && form !== 'D/A') return null;
  const issuer = secXmlBlocks(doc, 'primaryIssuer')[0];
  const offering = secXmlBlocks(doc, 'offeringData')[0];
  if (!issuer || !offering) return null;
  const cik = secXmlField(issuer, 'cik');
  const entityName = secXmlField(issuer, 'entityName');
  if (!cik || !/^\d{1,10}$/.test(cik) || !entityName) return null;
  const address = secXmlBlocks(issuer, 'issuerAddress')[0] ?? '';
  const industry = secXmlBlocks(offering, 'industryGroup')[0] ?? '';
  const industryGroup = secXmlField(industry, 'industryGroupType');
  const filing = secXmlBlocks(offering, 'typeOfFiling')[0] ?? '';
  const firstSale = secXmlBlocks(filing, 'dateOfFirstSale')[0] ?? '';
  const types = secXmlBlocks(offering, 'typesOfSecuritiesOffered')[0] ?? '';
  const securities = SECURITY_TYPES.filter(([tag]) => secXmlField(types, tag) === 'true').map(([, label]) => label);
  const amounts = secXmlBlocks(offering, 'offeringSalesAmounts')[0] ?? '';
  const offered = secXmlField(amounts, 'totalOfferingAmount');
  const previous = secXmlField(filing, 'previousAccessionNumber');
  const bounded = (value: string | null, max = MAX_NAME) => value ? decodeSecXml(value).slice(0, max) : null;
  return {
    form,
    live: secXmlField(doc, 'testOrLive') === 'LIVE',
    cik: padCik(cik),
    entityName: entityName.slice(0, MAX_NAME),
    city: bounded(secXmlField(address, 'city'), 80),
    state: bounded(secXmlField(address, 'stateOrCountry'), 8),
    stateDescription: bounded(secXmlField(address, 'stateOrCountryDescription'), 80),
    industryGroup: bounded(industryGroup, 80),
    pooledFund: industryGroup === 'Pooled Investment Fund' || securities.includes('Pooled investment fund interests'),
    businessCombination: secXmlField(offering, 'isBusinessCombinationTransaction') === 'true',
    isAmendment: secXmlField(filing, 'isAmendment') === 'true',
    previousAccession: previous && accessionPattern.test(previous) ? previous : null,
    dateOfFirstSale: calendarDate(secXmlField(firstSale, 'value')),
    firstSaleYetToOccur: secXmlField(firstSale, 'yetToOccur') === 'true',
    securities,
    totalOfferingAmount: offered && /^indefinite$/i.test(offered) ? 'Indefinite' : dollars(offered),
    totalAmountSold: dollars(secXmlField(amounts, 'totalAmountSold')),
    signatureDate: calendarDate(secXmlField(secXmlBlocks(offering, 'signatureBlock')[0] ?? '', 'signatureDate')),
  };
}

const formDDocumentSchema = z.object({
  form: z.enum(['D', 'D/A']),
  live: z.boolean(),
  cik: z.string().regex(/^\d{10}$/),
  entityName: z.string().min(1).max(MAX_NAME),
  city: z.string().max(80).nullable(),
  state: z.string().max(8).nullable(),
  stateDescription: z.string().max(80).nullable(),
  industryGroup: z.string().max(80).nullable(),
  pooledFund: z.boolean(),
  businessCombination: z.boolean(),
  isAmendment: z.boolean(),
  previousAccession: z.string().regex(accessionPattern).nullable(),
  dateOfFirstSale: z.string().regex(datePattern).nullable(),
  firstSaleYetToOccur: z.boolean(),
  securities: z.array(z.string().max(60)).max(SECURITY_TYPES.length),
  totalOfferingAmount: z.union([z.number().nonnegative(), z.literal('Indefinite')]).nullable(),
  totalAmountSold: z.number().nonnegative().nullable(),
  signatureDate: z.string().regex(datePattern).nullable(),
}).strict();

/** Validate the reader's retained Form D JSON. */
export function parseFormDDocument(text: string): FormDDocument | null {
  try { return formDDocumentSchema.parse(JSON.parse(text)); } catch { return null; }
}

/** The EDGAR archive coordinates of a primary_doc.xml URL. */
function documentCoordinates(raw: string): { cik: string; accessionDigits: string } | null {
  try {
    const url = new URL(raw);
    const match = /^\/Archives\/edgar\/data\/(\d{1,10})\/(\d{18})\/primary_doc\.xml$/.exec(url.pathname);
    return url.protocol === 'https:' && url.hostname === 'www.sec.gov' && !url.search && !url.hash && match
      ? { cik: padCik(match[1]!), accessionDigits: match[2]! } : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Identity.

const words = (raw: string) => ` ${raw.toUpperCase().normalize('NFKC').replace(/[^A-Z0-9]+/g, ' ').trim()} `;

/** The filing's business address agrees with the company's known headquarters:
 * its city, or its state/country written out, appears in the HQ text. A
 * two-letter code alone is not evidence (CA is California and Canada). */
export function formDAddressMatches(document: Pick<FormDDocument, 'city' | 'stateDescription'>, hqLocation: string | null | undefined): boolean {
  if (!hqLocation?.trim()) return false;
  const hq = words(hqLocation);
  return [document.city, document.stateDescription].some((part) => {
    const needle = part ? words(part).trim() : '';
    return needle.length >= 3 && hq.includes(` ${needle} `);
  });
}

// ---------------------------------------------------------------------------
// The observation.

export interface FormDLastRoundObservation {
  /** Total amount sold in the latest offering, USD as filed. */
  value: number;
  /** The round's date: first sale when stated, else the notice's filing date. */
  asOf: string;
  dateBasis: 'first_sale' | 'filing';
  form: 'D' | 'D/A';
  filingDate: string;
  accession: string;
  totalOfferingAmount: number;
  entityName: string;
  documentUrl: string;
  receipt: OriginalSourceReceipt;
  citations: Citation[];
  methodNote: string;
}

function validReceipt(source: OriginalSourceReceipt, nowMs: number): boolean {
  return source.status === 'retrieved' && source.httpStatus === 200 && source.format === undefined && !source.truncated &&
    /^[a-f0-9]{64}$/.test(source.contentHash ?? '') && typeof source.text === 'string' && source.text.length > 0 &&
    source.text.length <= MAX_TEXT && Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) <= nowMs;
}

const usd = (value: number) => `$${value.toLocaleString('en-US')}`;

/**
 * Deterministic, from retained receipts only: the issuer's latest Form D
 * offering and the amount sold in it. `rows` are the issuer's notices from its
 * submissions feed (they carry each notice's filing date); `receipts` are the
 * parsed notices the reader retained. Null whenever identity, offering type,
 * amount, date or uniqueness is not established.
 */
export function formDLastRoundObservation(input: {
  companyName: string;
  hqLocation: string | null | undefined;
  cik: string;
  rows: readonly FormDFilingRow[];
  receipts: readonly OriginalSourceReceipt[];
  nowMs?: number;
}): FormDLastRoundObservation | null {
  const nowMs = input.nowMs ?? Date.now();
  const wanted = companyNameKey(input.companyName);
  const cik = padCik(input.cik);
  if (!Number.isFinite(nowMs) || wanted.length < 3 || !/^\d{10}$/.test(cik)) return null;
  const today = new Date(nowMs).toISOString().slice(0, 10);

  type Notice = { row: FormDFilingRow; doc: FormDDocument; receipt: OriginalSourceReceipt; url: string };
  const notices: Notice[] = [];
  for (const row of input.rows) {
    if (!accessionPattern.test(row.accession) || !datePattern.test(row.filingDate) || row.filingDate > today) return null;
    const url = formDDocumentUrl(cik, row.accession);
    const receipt = input.receipts.find((r) => r.finalUrl === url && validReceipt(r, nowMs));
    const coordinates = receipt ? documentCoordinates(receipt.finalUrl!) : null;
    const doc = receipt ? parseFormDDocument(receipt.text!) : null;
    // A notice that cannot be read, or is not the registrant's own filing
    // about itself, might be the newer offering: no partial answers.
    if (!receipt || !doc || coordinates?.cik !== cik || coordinates.accessionDigits !== row.accession.replace(/-/g, '') ||
      doc.cik !== cik || doc.form !== row.form) return null;
    if (doc.live) notices.push({ row, doc, receipt, url });
  }
  // Pooled funds and mergers are not an operating company's funding round.
  const offerings = notices.filter((n) => !n.doc.pooledFund && !n.doc.businessCombination);
  if (offerings.length === 0) return null;

  // Group amendments with the offering they amend (chains resolve through the
  // notices read; an unread original still keys its amendments together).
  const byAccession = new Map(offerings.map((n) => [n.row.accession, n]));
  const offeringKey = (notice: Notice): string => {
    let current = notice;
    for (let hop = 0; hop < 8 && current.doc.isAmendment && current.doc.previousAccession; hop++) {
      const previous = byAccession.get(current.doc.previousAccession);
      if (!previous) return current.doc.previousAccession;
      current = previous;
    }
    return current.row.accession;
  };
  const groups = new Map<string, Notice[]>();
  for (const notice of offerings) {
    const key = offeringKey(notice);
    groups.set(key, [...(groups.get(key) ?? []), notice]);
  }
  const latestNotice = (group: Notice[]) => [...group].sort((a, b) =>
    b.row.filingDate.localeCompare(a.row.filingDate) || b.row.accession.localeCompare(a.row.accession))[0]!;
  const dated = [...groups.values()].map((group) => {
    const latest = latestNotice(group);
    const firstSale = latest.doc.dateOfFirstSale ?? group.map((n) => n.doc.dateOfFirstSale).find(Boolean) ?? null;
    return { latest, asOf: firstSale ?? latest.row.filingDate, dateBasis: firstSale ? 'first_sale' as const : 'filing' as const };
  }).sort((a, b) => b.asOf.localeCompare(a.asOf));
  const chosen = dated[0]!;
  // Two different offerings tied for latest: which one is "the round" is not
  // stated anywhere, so nothing is reported.
  if (dated.length > 1 && dated[1]!.asOf === chosen.asOf) return null;

  const { doc, row, receipt, url } = chosen.latest;
  if (companyNameKey(doc.entityName) !== wanted || !formDAddressMatches(doc, input.hqLocation)) return null;
  if (doc.firstSaleYetToOccur) return null;
  if (typeof doc.totalOfferingAmount !== 'number' || doc.totalOfferingAmount <= 0) return null;
  if (doc.totalAmountSold === null || doc.totalAmountSold <= 0 || doc.totalAmountSold > doc.totalOfferingAmount) return null;
  if (chosen.asOf > today || nowMs - Date.parse(`${chosen.asOf}T00:00:00.000Z`) > FORM_D_MAX_AGE_DAYS * 86400000) return null;

  const dateText = chosen.dateBasis === 'first_sale'
    ? `first sale ${chosen.asOf}` : `first-sale date not stated; dated by the filing, ${row.filingDate}`;
  const citations = usableCitations([{
    title: `SEC Form ${row.form} — ${doc.entityName} (filed ${row.filingDate}; ${dateText})`,
    url, credibility: 'primary',
  }]);
  if (!citations.length) return null;
  const amended = row.form === 'D/A' ? ', the latest amendment of this offering' : '';
  const methodNote = `Amount sold in ${doc.entityName}'s latest SEC Form D offering: ${usd(doc.totalAmountSold)} of ` +
    `${usd(doc.totalOfferingAmount)} offered (Form ${row.form} filed ${row.filingDate}, accession ${row.accession}${amended}; ` +
    `${dateText}). Issuer-filed under Regulation D. Not a priced valuation, and the filing does not name the round's stage; ` +
    `a later round the company did not file on Form D would not appear here.`;
  return {
    value: doc.totalAmountSold, asOf: chosen.asOf, dateBasis: chosen.dateBasis, form: row.form, filingDate: row.filingDate,
    accession: row.accession, totalOfferingAmount: doc.totalOfferingAmount, entityName: doc.entityName,
    documentUrl: url, receipt, citations, methodNote,
  };
}

const receiptText = (receipt: OriginalSourceReceipt) => receipt.status === 'retrieved' && receipt.text ? receipt.text : null;

/**
 * The whole lane over any reader: entity lookup → submissions feed → the
 * newest Form D notices → the deterministic observation. Null when the
 * company is not a single matching registrant, files no Form D, or the
 * observation is not established. Reads stay a handful per company.
 */
export async function findFormDLastRound(
  company: { name: string; hqLocation: string | null | undefined },
  read: (url: string) => Promise<OriginalSourceReceipt>,
  nowMs?: number,
): Promise<FormDLastRoundObservation | null> {
  // Identity needs an address to compare against; without one, spend no reads.
  if (!company.hqLocation?.trim() || companyNameKey(company.name).length < 3) return null;
  const lookupText = receiptText(await read(secEntityLookupUrl(company.name)));
  const entity = lookupText ? secEntityMatch(lookupText, company.name) : null;
  if (!entity) return null;
  const indexText = receiptText(await read(secSubmissionsUrl(entity.cik)));
  const index = indexText ? parseScheduleFilingIndex(indexText) : null;
  if (!index || index.cik !== entity.cik || companyNameKey(index.name) !== companyNameKey(company.name)) return null;
  const rows = index.formDFilings.slice(0, MAX_FORM_D_READS);
  if (rows.length === 0) return null;
  const receipts: OriginalSourceReceipt[] = [];
  // Two at a time: a courtesy to EDGAR's fair-access limit.
  for (let i = 0; i < rows.length; i += 2) {
    receipts.push(...await Promise.all(rows.slice(i, i + 2).map((row) => read(formDDocumentUrl(entity.cik, row.accession)))));
  }
  // An unread notice might be the newer offering; reporting an older one in
  // its place would mislabel the latest round. No partial answers.
  if (receipts.some((r) => !receiptText(r))) return null;
  // The clock is read after the reads: a receipt stamped during this call is
  // not "from the future".
  return formDLastRoundObservation({ companyName: company.name, hqLocation: company.hqLocation, cik: entity.cik, rows, receipts,
    nowMs: nowMs ?? Date.now() });
}
