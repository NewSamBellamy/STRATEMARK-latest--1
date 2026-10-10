import { reportedMetricSupportSchema, usableCitations, validMetricVerificationValue,
  type CompanyMetric, type MetricType, type ReportedMetricSupport } from '@mi/contracts';
import type { ProviderGrounding } from './types';
import type { EnrichmentOut } from './schemas';

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sentences = (text: string) => text.split(/(?<=[.!?])\s+(?=[A-Z])/);
const plain = (text: string) => text.replace(/[*_`]/g, '')
  .replace(/^\s*Original source:\s*https?:\/\/[^\n]+\n/i, '')
  .replace(/^\s*(?:[-•]|\d+[.)])\s*/, '')
  .trim().replace(/^(?:Company Description|Headquarters Location|Headcount \/ Number of Employees|Employees(?: \(Headcount\))?|Annual Revenue(?: & Recurring Revenue \(ARR\))?|Valuation|Market Capitalization|Users \/ Customers|Official Website)(?::|\r?\n)\s*/i, '').trim();
/** Sentence-initial identity forms for a stored company name. Deck names mix
 * display, legal and DBA forms ("Radiant Nuclear (Radiant Industries, Inc.)",
 * "BWX Technologies, Inc. (BWXT)") while grounded answers open with whichever
 * form the source used. Every alias IS the company, so breadth here only
 * decides which truthful sentence-initial subject we accept — the anchor
 * (sentence-initial + citation) stays shut. */
const entityAliases = (name: string): string[] => {
  const forms = new Set<string>();
  const add = (value: string | undefined) => {
    const cleaned = stripCorporateSuffix((value ?? '').trim());
    if (cleaned.length >= 4) forms.add(cleaned);
  };
  add(name);
  const paren = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    add(paren[1]);
    add(paren[2]);
  }
  return [...forms];
};
const entity = (text: string, name: string) => {
  const body = plain(text);
  // Lookahead, not \b: aliases ending in a legal abbreviation ("...Co.")
  // are followed by a non-word character in prose, where \b never holds.
  return entityAliases(name).some(alias => new RegExp(`^${escape(alias)}(?:['’]s)?(?![\\p{L}\\p{N}])`, 'iu').test(body));
};

// Legal suffixes and short forms whose period never ends a sentence. A
// splitter that stops at "Inc." would cut the subject off its own claim —
// "Equinix, Inc. holds…" would expand to nothing but "Inc. holds…".
const NOT_SENTENCE_END =
  /(?:^|[\s('"])(?:inc|incorporated|corp(?:oration)?|ltd|limited|co|llc|llp|plc|pbc|gmbh|ag|sa|sas|nv|bv|ab|lp|u\.?s|u\.?k|eu|mr|mrs|ms|dr|prof|sr|jr|st|no|vol|approx|est|cf|vs|etc|al)\.$/i;

function isSentenceEnd(text: string, i: number): boolean {
  const ch = text[i]!;
  if (ch !== '.' && ch !== '!' && ch !== '?') return false;
  // A period between digits is a decimal or a version number.
  if (ch === '.' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '')) return false;
  // Punctuation runs (ellipsis, "!?", quotes) collapse into one boundary.
  if (/[.!?]/.test(text[i + 1] ?? '')) return false;
  const head = text.slice(Math.max(0, i - 16), i + 1);
  if (NOT_SENTENCE_END.test(head)) return false;
  // A single capitalized letter before the period is an initial ("Robert Q.").
  if (/(?:^|[\s('"])\p{Lu}\.$/u.test(head)) return false;
  return true;
}

/** Grounding support spans are source-backed fragments, not sentences: the
 * provider routinely marks only the supported clause, leaving the sentence's
 * subject outside the span ("Equinix, Inc." → support starts at "holds…").
 * Subject-anchored identity binding fails closed on such fragments, so real
 * reported figures are dropped. Locate the fragment in the answer text and
 * extend to the enclosing sentence boundaries — the result is verbatim answer
 * text, so provider attribution is untouched. Returns the fragment unchanged
 * when it cannot be located or already is a whole sentence. */
/** Locate the fragment's true position. Provider offsets win when they
 * validate; otherwise containment aliases (one support's text prefixing
 * another's) must not win, so the rightmost occurrence is preferred over the
 * first. */
function locateFragment(fragment: string, answerText: string, startIndex?: number): number {
  if (Number.isSafeInteger(startIndex) && startIndex! >= 0 &&
    answerText.slice(startIndex!, startIndex! + fragment.length) === fragment) return startIndex!;
  const last = answerText.lastIndexOf(fragment);
  if (last >= 0) return last;
  return answerText.indexOf(fragment);
}

export function sentenceAround(fragment: string, answerText?: string, startIndex?: number): string {
  if (!answerText || !fragment.trim()) return fragment;
  const at = locateFragment(fragment, answerText, startIndex);
  if (at < 0) return fragment;
  // Never expand across a paragraph break: catalog answers pack unrelated
  // metric sections into one text, and the blank line is the only separator —
  // merging them would let one section's disqualifier (mixed contractors,
  // speculative language) veto a clean claim in the next.
  const paragraphStart = answerText.lastIndexOf('\n\n', at) + 1;
  const paragraphEndIdx = answerText.indexOf('\n\n', at);
  const paragraphEnd = paragraphEndIdx < 0 ? answerText.length : paragraphEndIdx;
  // Extension beyond the fragment stops at the fragment's line: catalog
  // sections are line- or paragraph-separated without ending punctuation, so
  // crossing a line break would merge unrelated sections into one "sentence".
  // A multi-line fragment itself stays whole.
  let start = paragraphStart;
  for (let i = at - 1; i >= paragraphStart; i--) {
    if (answerText[i] === '\n') { start = i + 1; break; }
    if (isSentenceEnd(answerText, i)) { start = i + 1; break; }
  }
  const fragmentEnd = at + fragment.length;
  if (fragmentEnd <= paragraphEnd && isSentenceEnd(answerText, fragmentEnd - 1)) {
    return answerText.slice(start, fragmentEnd).replace(/^[\r\n]+/, '');
  }
  let end = paragraphEnd;
  for (let i = fragmentEnd; i < paragraphEnd; i++) {
    if (answerText[i] === '\n') { end = i; break; }
    if (isSentenceEnd(answerText, i)) { end = i + 1; break; }
  }
  return answerText.slice(start, end).replace(/^[\r\n]+/, '');
}

/** Answer-level identity for catalog-style retained evidence. The retained
 * profile answer names its subject in the header while each metric section
 * stays anonymous, so a claim sentence that opens with a measurement label
 * and names no known rival may bind to the answer's subject — but only when
 * the answer's header actually names the subject and a deck roster was
 * supplied. The label requirement fails closed: a sentence opening with a
 * bare proper noun (typically another company the roster may not contain)
 * is never attributed. Roster absence disables the anonymous path entirely. */
export interface ReportedIdentityContext {
  answerText?: string;
  otherCompanies?: readonly string[];
}

const stripCorporateSuffix = (name: string) =>
  name.replace(/[,]?\s+(?:Inc\.?|Incorporated|Ltd\.?|Limited|LLC|Corporation|Corp\.?|PBC|GmbH|SAS|SA|AG|PLC|Co\.?)$/i, '').trim();

const mentionsCompany = (text: string, name: string) => {
  const alias = stripCorporateSuffix(name);
  if (alias && new RegExp(`(?<![\\p{L}\\p{N}])${escape(alias)}(?![\\p{L}\\p{N}])`, 'iu').test(text)) return true;
  return name.length > 0 && new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'iu').test(text);
};

// A catalog section's claim sentence opens with its measurement label, after
// markdown decoration ("### Headcount & Factual Proxy Anchors…"). Decoration is
// skipped, then the label is required: anything else — most importantly another
// company's name — fails closed, because the roster cannot vouch for entities
// it does not know.
const anonymousClaimLabel =
  /^[#>\-*•|\s]*(?:revenue\b|arr\b|annual(?:ized)?\b|employees?\b|headcount\b|users\b|customers\b|valuation\b|market cap(?:italization)?\b|estimated headcount|historical booked|funding round valuation|fiscal[- ]?year\b|booked\b)/i;

const GENERIC_NAME_TOKENS = /^(?:inc|llc|ltd|limited|corporation|corp|company|co|group|holdings|the|plc|ag|sa|sas|gmbh|pbc)$/i;

const rivalAliases = (name: string): string[] => {
  const alias = stripCorporateSuffix(name);
  const candidates = [alias, name].filter(form => form.length > 0);
  const first = alias.split(/\s+/)[0] ?? '';
  // Colloquial short forms: "Meta Platforms, Inc." is written "Meta" in prose.
  if (first.length >= 4 && !GENERIC_NAME_TOKENS.test(first) && first !== alias) candidates.push(first);
  return candidates;
};

const rivalMatcher = (companyName: string, others?: readonly string[]): RegExp | null => {
  if (!Array.isArray(others)) return null;
  const subjectAlias = stripCorporateSuffix(companyName);
  if (!subjectAlias) return null;
  const subjectForms = new Set([subjectAlias.toLowerCase(), companyName.toLowerCase()]);
  const subjectFirst = subjectAlias.split(/\s+/)[0] ?? '';
  const patterns: string[] = [];
  for (const name of others) {
    if (!name) continue;
    for (const candidate of rivalAliases(name)) {
      const form = candidate.toLowerCase();
      if (subjectForms.has(form) || (subjectFirst.length >= 4 && form === subjectFirst.toLowerCase())) continue;
      patterns.push(`(?<![\\p{L}\\p{N}])${escape(candidate)}(?![\\p{L}\\p{N}])`);
    }
  }
  if (!patterns.length) return null;
  return new RegExp(patterns.join('|'), 'iu');
};
function host(url: string | null): string | null {
  try { return url ? new URL(url).hostname.replace(/^www\./, '') : null; } catch { return null; }
}
const basisPatterns: Record<string, RegExp> = {
  arr: /\b(?:ARR|annual recurring revenue)\b/i,
  // Corporate prose usually says "total consolidated annual revenues" — the
  // modifier can precede "annual" and the noun is usually plural. Without both
  // orders, the standard 10-K phrasing matches no basis at all.
  annual_revenue: /\b(?:annual (?:(?:consolidated|total|net) )?revenues?|(?:(?:consolidated|total|net) )?annual revenues?|revenue (?:for|of) (?:the )?(?:fiscal )?year)\b/i,
  employees: /\b(?:employees|headcount|workforce|full[- ]time personnel|full[- ]time staff|employed)\b/i,
  users: /\busers\b/i, active_users: /\bactive users\b/i,
  monthly_active_users: /\bmonthly active users\b/i, daily_active_users: /\bdaily active users\b/i,
  customers: /\bcustomers\b/i, paying_customers: /\bpaying customers\b/i,
  valuation: /\bvaluation|valued at\b/i, market_cap: /\bmarket cap(?:italization)?\b/i,
  market_share: /\bmarket share\b/i,
  aum: /\b(?:AUM|assets under management)\b/i,
};
const speculativeValuation = /\b(?:preliminary|discussions|talks|seeking|targeting|proposed|potential|considering|negotiating)\b/i;

// A count immediately followed by a locative phrase belongs to that region or
// subset ("13,716 employees globally, with 5,917 based in the Americas") —
// never to the whole company. The window stays tight: the qualifier must sit
// right after the numeral, so the company-wide figure ("13,716 employees
// worldwide") is never caught by a later breakdown's wording.
const LOCATIVE_AFTER_NUMBER =
  /^\s*(?:based\s+in|in\s+(?:the\s+)?(?:americas?|emea|apac|asia(?:[- ]pacific)?|us|u\.s\.?|europe)|across\s+(?:the\s+)?(?:americas?|emea|apac|asia|us|u\.s\.?|europe)|outside\s+(?:the\s+)?(?:us|u\.s\.?|americas?))\b/i;

function hasDate(text: string, date: string): boolean {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return false;
  const month = parsed.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const day = parsed.getUTCDate(), year = parsed.getUTCFullYear();
  return text.includes(date) || new RegExp(`\\b(?:${month} ${day}(?:st|nd|rd|th)?[,]? ${year}|${day} ${month} ${year})\\b`, 'i').test(text);
}

function hasNumber(text: string, value: number, unit: ReportedMetricSupport['unit'], definition: string): boolean {
  if (unit === 'USD' && /\b(?:CAD|AUD|HKD|SGD|NZD|Canadian dollars?|Australian dollars?)\b|(?:C|A|HK|S|NZ)\$/i.test(text)) return false;
  // Match reported figures, not other numerals such as dates or page counts.
  // "$65+ billion" separates the scale with an optional plus; without the
  // tolerant separator the figure would parse as 65 unscaled dollars.
  const pattern = /(?:\b(USD|US dollars?)\s*|(US\$|\$)\s*)?(\d[\d,]*(?:\.\d+)?)\s*\+?\s*(trillion|billion|million|thousand|[kmbt]\b)?\s*(USD|US dollars?|%|percent|employees|users|customers)?/gi;
  for (const match of text.matchAll(pattern)) {
    const magnitude = match[4]?.toLowerCase();
    const multiplier = magnitude ? ({ trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, t: 1e12, b: 1e9, m: 1e6, k: 1e3 }[magnitude] ?? 1) : 1;
    const number = Number(match[3]!.replace(/,/g, '')) * multiplier;
    if (number !== value) continue;
    if (unit === 'USD' && !(match[1] || match[2] || /USD|US dollar/i.test(match[5] ?? ''))) continue;
    if (unit === 'percent' && !/%|percent/i.test(match[5] ?? '')) continue;
    if (unit === 'count' && (match[1] || match[2] || /USD|dollar|%|percent/i.test(match[5] ?? ''))) continue;
    const start = match.index!, end = start + match[0].trimEnd().length;
    if (definition === 'employees' &&
      LOCATIVE_AFTER_NUMBER.test(text.slice(end, end + 24))) continue;
    // Bind completed valuations separately from later financing discussions in
    // the same provider segment. This check is local to this candidate number.
    if (definition === 'valuation' && speculativeValuation.test(text.slice(0, start).split(/[;,]/).at(-1) ?? '')) continue;
    const mentions = Object.entries(basisPatterns).flatMap(([basis, expression]) =>
      [...text.matchAll(new RegExp(expression.source, 'gi'))].map(mention => {
        const left = mention.index!, right = left + mention[0].length;
        const distance = right < start ? start - right : left > end ? left - end : 0;
        const bridge = right < start ? text.slice(right, start) : left > end ? text.slice(end, left) : '';
        return { basis, distance, bridge };
      }));
    const nearest = Math.min(...mentions.map(mention => mention.distance));
    if (!mentions.some(mention => mention.basis === definition && mention.distance === nearest && nearest <= 30 &&
      // A bridge crossing another number means the basis word belongs to that
      // number ("December 31, 2025 (comprising 5,917 employees…)" must not
      // date-anchor 31 or 2025 as employee counts), not to this candidate.
      !/\d/.test(mention.bridge) &&
      !/\b(?:and|as of|year|ended|date|versus|compared)\b|[;.!?]/i.test(mention.bridge))) continue;
    return true;
  }
  return false;
}

/** Only literal business dates, never a filing/publication/retrieval timestamp. */
export function businessDates(text: string): string[] {
  const dates: string[] = [];
  const pattern = /\b(?:as of|(?:fiscal )?year ended|reporting date(?: was| is)?)\s+(\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{1,2}(?:st|nd|rd|th)?[,]? \d{4})\b/g;
  for (const match of text.matchAll(pattern)) {
    const parsed = new Date(match[1]!.replace(/(\d)(?:st|nd|rd|th)/, '$1'));
    if (Number.isFinite(parsed.getTime())) dates.push(parsed.toISOString().slice(0, 10));
  }
  return [...new Set(dates)];
}

/** Repair a missing model selector from literal, per-claim provider attribution.
 * No fuzzy estimates, user populations, new calls or original-verification claim.
 * Multiple values for the same latest period are ambiguous and stay unknown. */
function recoverOmittedClaim(companyName: string, website: string | null, type: MetricType,
  grounding?: ProviderGrounding, otherCompanies?: readonly string[]) {
  if (!grounding || !['arr', 'employees', 'valuation', 'market_cap', 'market_share', 'aum', 'users'].includes(type)) return undefined;
  const choices: Array<{ value: number; selector: NonNullable<NonNullable<EnrichmentOut['metrics']['arr']>['reportedClaim']> }> = [];
  for (const support of grounding.supports) {
    if (!grounding.answerText.includes(support.text)) continue;
    // Labels are presentation, not measurement evidence (ARR in a heading must
    // not relabel the annual-revenue claim beneath it). Keep support untouched;
    // read the claim from the full sentence the fragment came from.
    const text = plain(sentenceAround(support.text, grounding.answerText, support.startIndex));
    // Omitted employee extraction cannot resolve a passage mixing employees
    // with contractors/contingent workers. Prefer a separate clean segment.
    if (type === 'employees' && /\b(?:including|includes|include|with)\b[^.!?\n]{0,100}\b(?:contractors?|contract workers?|contingent workers?)\b/i.test(text)) continue;
    // A mixed completed/speculative paragraph needs an explicit claim selector;
    // omission recovery must not guess which financing context is current.
    if (type === 'valuation' && speculativeValuation.test(text)) continue;
    const dates = businessDates(text);
    if (dates.length > 1) continue;
    // Annual revenue and ARR share a slot, but remain distinct candidates.
    // Do not let the presence of ARR hide annual revenue in the same segment.
    const candidates: Array<NonNullable<ReportedMetricSupport['definition']>> =
      type === 'arr' ? ['arr', 'annual_revenue'] : [type];
    const definitions = candidates.filter(definition => basisPatterns[definition]?.test(text));
    const unit = type === 'employees' || type === 'users' ? 'count' : type === 'market_share' ? 'percent' : 'USD';
    const pattern = /(?:\bUSD\s*|US\$|\$)?\s*(\d[\d,]*(?:\.\d+)?)\s*\+?\s*(trillion|billion|million|thousand|[kmbt]\b)?/gi;
    for (const match of text.matchAll(pattern)) {
      // Parenthetical breakdowns are not company-wide employee candidates.
      // Only omission recovery skips them; selected claims use the validator.
      if (type === 'employees' && [...text.slice(0, match.index!)].reduce((depth, char) =>
        char === '(' ? depth + 1 : char === ')' ? Math.max(0, depth - 1) : depth, 0) > 0) continue;
      // So are immediately localized counts ("5,917 based in the Americas"):
      // the regional breakdown can appear as a comma list, not only in parens.
      if (type === 'employees' &&
        LOCATIVE_AFTER_NUMBER.test(text.slice(match.index! + match[0].length, match.index! + match[0].length + 24))) continue;
      const scale = match[2]?.toLowerCase();
      const value = Number(match[1]!.replace(/,/g, '')) * (scale ? ({ trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, t: 1e12, b: 1e9, m: 1e6, k: 1e3 }[scale] ?? 1) : 1);
      const asOf = dates[0] ?? null;
      for (const definition of definitions) {
        const proof = reportedMetricSupportSchema.safeParse({ provider: grounding.provider, companyName, basis: type, value, unit, definition, asOf, support });
        if (!proof.success || !reportedMetricCitations(companyName, website, { metricType: type, value, reportedSupport: proof.data },
          { answerText: grounding.answerText, otherCompanies }).length) continue;
        choices.push({ value, selector: { sourceUrl: support.sources[0]!.url, quote: support.text, asOf, basis: type, unit, definition } });
      }
    }
  }
  const latest = choices.map(row => row.selector.asOf ?? '').sort().at(-1);
  const finalists = choices.filter(row => (row.selector.asOf ?? '') === latest);
  return new Set(finalists.map(row => `${row.value}:${row.selector.definition}`)).size === 1 ? finalists[0] : undefined;
}

/** Shared publication/reopen check. This lane never grants verified confidence. */
export function reportedMetricCitations(companyName: string, website: string | null,
  metric: Pick<CompanyMetric, 'metricType' | 'value' | 'reportedSupport'>, identity?: ReportedIdentityContext) {
  const parsed = reportedMetricSupportSchema.safeParse(metric.reportedSupport);
  if (!parsed.success) return [];
  const proof = parsed.data, type = metric.metricType;
  if (proof.companyName !== companyName || proof.basis !== type || proof.value !== metric.value ||
    !validMetricVerificationValue(type, metric.value) || metric.value === 0 ||
    (['employees', 'users'].includes(type) && !Number.isSafeInteger(metric.value))) return [];
  const definition = proof.definition ?? type;
    // User populations are always reported AS OF a date or period in any source
  // worth citing. A users claim with no reporting date ('1B active users',
  // full stop) is the unverifiable mega-figure the red team flagged: it
  // stays unknown rather than rendering with authority it never earned.
  if (type === 'users' && !proof.asOf) return [];
if (type === 'users' && /\b(?:users engaging with|AI-powered features|across its .{0,30}suite|active base of .{0,30}devices)\b/i.test(proof.support.text)) return [];
  if ((type === 'arr' && !['arr', 'annual_revenue'].includes(definition)) ||
    (type === 'users' && !['users', 'active_users', 'monthly_active_users', 'daily_active_users', 'customers', 'paying_customers'].includes(definition)) ||
    (!['arr', 'users'].includes(type) && definition !== type)) return [];
  if (proof.unit !== (['arr', 'valuation', 'market_cap', 'aum'].includes(type) ? 'USD' : type === 'market_share' ? 'percent' : 'count')) return [];
  const pattern = basisPatterns[definition];
  const citations = usableCitations(proof.support.sources, website ?? undefined);
  const expected = host(website);
  const official = expected && citations.some(source => {
    const actual = host(source.url);
    return actual === expected || actual?.endsWith(`.${expected}`);
  });
  // A bare metric clause may use an official company domain for identity. A
  // sentence explicitly naming someone else cannot use that exception.
  // Catalog-style retained answers name the subject in their header region
  // while metric sections stay anonymous: when the header names this company,
  // a sentence that OPENS with a measurement label and names no rival deck
  // company binds to the subject. Any other opening (typically a bare proper
  // noun the roster may not contain) fails closed.
  const rivals = rivalMatcher(companyName, identity?.otherCompanies);
  const answerAnchored = !!identity?.answerText && !!rivals &&
    mentionsCompany(identity.answerText.slice(0, 240), companyName);
  // An expanded support can begin with a lead-in ("For the fiscal year ended
  // December 31, 2025, Equinix, Inc. generated …"), so the subject is present
  // but not sentence-initial. When a roster is known, a sentence that names
  // the subject BEFORE its measurement basis and names no roster rival binds
  // to the subject; without a roster there is nothing to fail closed against,
  // so this path stays disabled.
  const namedBeforeBasis = rivals && identity?.otherCompanies ? (sentence: string) => {
    if (rivals!.test(sentence)) return false;
    // Alias set, not the raw stored name: sources open with the legal or DBA
    // form ("Contemporary Amperex Technology Co., Limited") while the deck
    // stores the display form ("...(CATL)"); without the set the subject is
    // never found and every claim fails closed.
    const subjectForms = entityAliases(companyName).map(escape).join('|');
    const subjectAt = new RegExp(`(?<![\\p{L}\\p{N}])(?:${subjectForms})(?![\\p{L}\\p{N}])`, 'iu').exec(sentence)?.index;
    const firstBasisAt = basisPatterns[definition] ? new RegExp(basisPatterns[definition]!.source, 'i').exec(sentence)?.index : undefined;
    return subjectAt !== undefined && firstBasisAt !== undefined && subjectAt < firstBasisAt;
  } : null;
  const claims = sentences(sentenceAround(proof.support.text, identity?.answerText, proof.support.startIndex)).map(plain).filter(sentence => entity(sentence, companyName) ||
    (official && /^(?:annual revenue|ARR|annual recurring revenue|headcount|employees|users|customers|valuation|market cap)\b/i.test(sentence)) ||
    (answerAnchored && anonymousClaimLabel.test(sentence) && !rivals!.test(sentence)) ||
    (namedBeforeBasis?.(sentence) ?? false));
  if (!pattern || !claims.some(sentence => pattern.test(sentence) && hasNumber(sentence, proof.value, proof.unit, definition) &&
    // A subsequent discussion/reporting clause cannot date a completed round.
    (!proof.asOf || definition !== 'valuation' || sentence.split(/,\s+(?:with|while|but)\b/i).some(clause =>
      hasNumber(clause, proof.value, proof.unit, definition) && hasDate(clause, proof.asOf!))) &&
    (!proof.asOf || !businessDates(proof.support.text).length || businessDates(proof.support.text).includes(proof.asOf)) &&
    (!proof.asOf || hasDate(sentence, proof.asOf) ||
      sentences(proof.support.text).some(context => /^(?:reporting date|as of|for (?:the )?year ended)\b/i.test(plain(context)) && hasDate(context, proof.asOf!))) &&
    (!proof.periodStart || hasDate(proof.support.text, proof.periodStart)) &&
    // A sentence naming a partner/customer is not an attributed company figure.
    !/\b(?:partners? with|invested in|customer of|competitor|(?:said|stated|reported|announced) that|its subsidiary|its division)\b/i.test(sentence) &&
    (!proof.asOf || !/\b(?:article published|page published|retrieved|accessed|updated on)\b/i.test(sentence)) &&
    (definition !== 'users' || !/\b(?:active|monthly|daily|weekly|customers|registered|downloads|followers)\b/i.test(sentence)))) return [];
  return citations;
}

/** Display-side recheck for estimated rows already accepted by the full
 * identity-aware gate at write time. The claim-sentence gates need the
 * retained answer text, which card views do not carry — re-running without it
 * would show every fragment-recovered figure as Unknown. This verifies
 * everything that does not depend on identity: schema, subject match,
 * basis/definition/unit/value coherence, and usable stored citations. */
export function reportedSupportCitations(companyName: string, website: string | null,
  metric: Pick<CompanyMetric, 'metricType' | 'value' | 'reportedSupport' | 'citations'>) {
  const parsed = reportedMetricSupportSchema.safeParse(metric.reportedSupport);
  if (!parsed.success) return [];
  const proof = parsed.data, type = metric.metricType;
  if (proof.companyName !== companyName || proof.basis !== type || proof.value !== metric.value ||
    !validMetricVerificationValue(type, metric.value) || metric.value === 0 ||
    (['employees', 'users'].includes(type) && !Number.isSafeInteger(metric.value))) return [];
  const definition = proof.definition ?? type;
  if ((type === 'arr' && !['arr', 'annual_revenue'].includes(definition)) ||
    (type === 'users' && !['users', 'active_users', 'monthly_active_users', 'daily_active_users', 'customers', 'paying_customers'].includes(definition)) ||
    (!['arr', 'users'].includes(type) && definition !== type)) return [];
  if (proof.unit !== (['arr', 'valuation', 'market_cap', 'aum'].includes(type) ? 'USD' : type === 'market_share' ? 'percent' : 'count')) return [];
    // User populations are always reported AS OF a date or period in any source
  // worth citing. A users claim with no reporting date ('1B active users',
  // full stop) is the unverifiable mega-figure the red team flagged: it
  // stays unknown rather than rendering with authority it never earned.
  if (type === 'users' && !proof.asOf) return [];
if (type === 'users' && /\b(?:users engaging with|AI-powered features|across its .{0,30}suite|active base of .{0,30}devices)\b/i.test(proof.support.text)) return [];
  return usableCitations(metric.citations, website ?? undefined);
}

/** Model fields select claims only; support is copied from the provider, never JSON. */
export function reportedCompanyMetrics(input: { companyId: string; companyName: string; website: string | null;
  enrichment: EnrichmentOut; text: string; grounding?: ProviderGrounding; capturedAt: string; includeUnknowns?: boolean;
  identity?: ReportedIdentityContext }): CompanyMetric[] {
  const identity: ReportedIdentityContext = {
    answerText: input.identity?.answerText ?? (input.grounding?.provider === 'google-search' ? input.grounding.answerText : undefined),
    otherCompanies: input.identity?.otherCompanies,
  };
  const trusted = input.grounding?.provider === 'google-search' && input.grounding.answerText.trim() === input.text.trim()
    ? input.grounding : undefined;
  const types = new Set<MetricType>(Object.keys(input.enrichment.metrics) as MetricType[]);
  // market_cap belongs with valuation in the always-audited set: it is a core
  // profile slot, recovery supports it, and omitting it here made the free
  // saved-evidence lane structurally unable to fill it.
  if (input.includeUnknowns !== false) for (const type of ['employees', 'arr', 'users', 'valuation', 'market_cap', 'market_share'] as const) types.add(type);
  return [...types].map(type => {
    const row: CompanyMetric = { id: `met_${input.companyId}_${type}`, companyId: input.companyId, metricType: type,
      value: null, confidence: 'unknown', source: null, citations: [], methodNote: 'No provider-supported reported claim.',
      capturedAt: input.capturedAt, lastVerifiedAt: null, passageSupport: null, reportedSupport: null };
    const proposedMetric = input.enrichment.metrics[type];
    // A number without a selector is still an omitted extraction. Recover
    // independently from provider evidence, never by trusting that number.
    // An explicit but rejected selector must not silently trigger recovery.
    const recovered = proposedMetric?.value == null || (!proposedMetric.reportedClaim && !proposedMetric.passageSupport)
      ? recoverOmittedClaim(input.companyName, input.website, type, trusted, identity.otherCompanies) : undefined;
    const proposal = recovered ? { value: recovered.value, reportedClaim: recovered.selector } : proposedMetric;
    const selector = proposal?.reportedClaim ?? ('passageSupport' in (proposal ?? {}) ? proposedMetric?.passageSupport : undefined);
    if (proposal?.value == null || !selector || selector.basis !== type) return row;
    for (const support of trusted?.supports ?? []) {
      // Recovery chose a specific provider segment. A broader duplicate may
      // contain the same quote but carry the mixed scope we deliberately skipped.
      if (recovered && support.text !== recovered.selector.quote) continue;
      // A selector quote may span past a truncated support fragment; the
      // sentence-expanded form is the same verbatim answer text.
      const expanded = sentenceAround(support.text, trusted!.answerText, support.startIndex);
      if (!trusted!.answerText.includes(support.text) || !selector.quote ||
        (!support.text.includes(selector.quote) && !expanded.includes(selector.quote)) ||
        !support.sources.some(source => source.url === selector.sourceUrl)) continue;
      const proof = reportedMetricSupportSchema.safeParse({ provider: trusted!.provider, companyName: input.companyName,
        basis: type, value: proposal.value, unit: selector.unit, asOf: selector.asOf,
        definition: selector.definition,
        periodStart: selector.periodStart && hasDate(support.text, selector.periodStart) ? selector.periodStart : undefined,
        support: structuredClone(support) });
      if (!proof.success) continue;
      const proposed = { ...row, value: proposal.value, reportedSupport: proof.data };
      const citations = reportedMetricCitations(input.companyName, input.website, proposed, identity);
      if (!citations.length) continue;
      return { ...proposed, confidence: 'estimated', citations, source: citations[0]!.url,
        methodNote: `Source reported ${proof.data.definition ?? type} (${proof.data.asOf ? `as of ${proof.data.asOf}` : 'undated; reporting date not published'}); provider-grounded, not verified against an original.` };
    }
    return row;
  });
}

export function providerCompanySummary(companyName: string, website: string | null, text: string, grounding?: ProviderGrounding) {
  if (grounding?.provider !== 'google-search' || grounding.answerText.trim() !== text.trim()) return null;
  for (const support of grounding.supports) {
    if (!grounding.answerText.includes(support.text)) continue;
    const summary = sentences(sentenceAround(support.text, grounding.answerText, support.startIndex)).map(plain).find(sentence => entity(sentence, companyName) && sentence.length >= 30 && sentence.length <= 500 &&
      !(/\d/.test(sentence) && /\b(?:valuation|valued at|funding round|market cap(?:italization)?|annual revenue|ARR|headcount|employees)\b|[$€£]/i.test(sentence)) &&
      // The verb gate keeps label/boilerplate lines out; it must describe what
      // companies actually SAY about themselves. "NuScale designs and
      // commercializes SMR technology" failed this gate for one missing word —
      // the ideal sourced one-liner, rejected while weaker sentences passed.
      /\b(?:builds?|provides?|develops?|designs?|manufactures?|commercializes?|delivers?|specializes?|focuses?|operates?|offers?|serves?|makes?|sells?|is a|is an|is headquartered)\b/i.test(sentence));
    const citations = usableCitations(support.sources, website ?? undefined);
    if (summary && citations.length) return { summary, citations };
  }
  return null;
}
