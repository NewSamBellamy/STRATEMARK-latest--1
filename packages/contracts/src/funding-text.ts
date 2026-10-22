/**
 * Funding facts that a round's OWN description already states.
 *
 * Everything here reads text research already produced and gives back only
 * what that text says: one round size, the names after "led by", and the
 * organisations a sourced board affiliation names. It never converts a
 * currency, never picks between two competing amounts and never fills a gap:
 * where the text is ambiguous the answer is "nothing". Pure and framework-free.
 */
import type { MissionGovernanceContent } from './types';

type Investor = NonNullable<MissionGovernanceContent['investors']>[number];
type BoardMember = NonNullable<MissionGovernanceContent['board']>[number];
type Round = NonNullable<MissionGovernanceContent['fundingRounds']>[number];

export type StatedCurrency = 'USD' | 'EUR' | 'GBP';
export interface StatedAmount {
  currency: StatedCurrency;
  /** The figure in its own currency units (105e6 for "€105M"). Not USD unless currency is USD. */
  value: number;
  /** The amount as the text wrote it, compact ("€105M", "$1.375B"). */
  display: string;
}

const SCALE: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, tn: 1e12, bn: 1e9, mn: 1e6, b: 1e9, m: 1e6, k: 1e3 };
const SCALE_LETTER: Record<string, string> = { trillion: 'T', tn: 'T', billion: 'B', bn: 'B', b: 'B', million: 'M', mn: 'M', m: 'M', thousand: 'K', k: 'K' };
const SYMBOL_CURRENCY: Record<string, StatedCurrency> = { $: 'USD', 'US$': 'USD', '€': 'EUR', '£': 'GBP' };

// A letter right before the sign (A$, C$, HK$, NZ$, R$) is another dollar or a real: never read it as US dollars.
const AMOUNT = /(?<![A-Za-z])(US\$|[$€£])\s?(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|tn|bn|mn|[bmk])?(?![A-Za-z])/gi;
/** Words before an amount that make it a valuation, a comparison or a running total, not the round size. */
const BEFORE_NOT_ROUND = /\b(valu\w*|worth|at|post-?money|pre-?money|from|than|over|above|surpass\w*|exceed\w*|reach\w*|hit|total\w*|cumulative\w*|bring\w*|brought)\b[^.;,]*$/i;
/** Text right after an amount that makes it a running total ("$300 million to date"), not the round size. */
const AFTER_TOTAL = /^[^.;]{0,25}?\b(?:in\s+total|in\s+all|to\s+date|so\s+far|overall|cumulative)\b/i;
/** A range connector right after an amount ("$20-25 million", "$2 to $3 billion"): a range is not one round size. */
const RANGE_AFTER = /^\s*(?:-|–|—|\bto\b|\bor\b)\s*(?:US\$|[$€£])?\s?\d/i;
/** The same connector right before an amount that has another amount ahead of it. */
const RANGE_BEFORE = /(?:US\$|[$€£])\s?\d[\d,]*(?:\.\d+)?\s*(?:trillion|billion|million|thousand|tn|bn|mn|[bmk])?\s*(?:-|–|—|\bto\b|\bor\b)\s*$/i;
/** A parenthesised "~$113M" is the writer's own conversion of the amount before it, not a second amount. */
const APPROX_GLOSS = /\(\s*(?:~|≈|approx\w*\.?|about|roughly|around)\s*$/i;
/** Words after an amount that say what it measures (revenue, a valuation, a headcount), not the round. */
const AFTER_NOT_ROUND = /^\s*(?:in\s+)?(?:annuali[sz]ed|annual|arr\b|revenue|recurring|bookings|sales|valuation|post-?money|pre-?money|market cap|users|customers|employees|commitment)/i;

/** Every currency amount in the text that is the round size, one per distinct value (a repeated mention counts once). */
export function statedRoundAmounts(text: string): StatedAmount[] {
  const found: StatedAmount[] = [];
  for (const m of text.matchAll(AMOUNT)) {
    const start = m.index ?? 0;
    const before = text.slice(Math.max(0, start - 40), start);
    const after = text.slice(start + m[0].length, start + m[0].length + 40);
    if (APPROX_GLOSS.test(before) || BEFORE_NOT_ROUND.test(before) || AFTER_NOT_ROUND.test(after) || AFTER_TOTAL.test(after)) continue;
    if (RANGE_AFTER.test(after) || RANGE_BEFORE.test(before)) continue;
    const symbol = m[1]!.toUpperCase() === 'US$' ? 'US$' : m[1]!;
    const digits = m[2]!;
    const scaleWord = m[3]?.toLowerCase();
    const value = Number(digits.replaceAll(',', '')) * (SCALE[scaleWord ?? ''] ?? 1);
    if (!Number.isFinite(value) || value <= 0) continue;
    const currency = SYMBOL_CURRENCY[symbol]!;
    if (found.some((a) => a.currency === currency && a.value === value)) continue;
    found.push({ currency, value, display: `${symbol === 'US$' ? '$' : symbol}${digits}${scaleWord ? SCALE_LETTER[scaleWord] ?? '' : ''}` });
  }
  return found;
}

/** The one round size the text states, or null when it states none or several. */
export function statedRoundAmount(text: string): StatedAmount | null {
  const all = statedRoundAmounts(text);
  return all.length === 1 ? all[0]! : null;
}

/** Wording of a funding event (a title reading "Series C Financing", "Raises ... round"). */
export function isFundingWording(title: string): boolean {
  return /\b(pre-?seed|seed|series [a-z]\+?|funding|financing|round|raises?|raised|tender offer)\b/i.test(title);
}

// The list ends at the first full stop, except one that closes an initial ("T. Rowe Price", "J.P. Morgan").
const LED_BY = /\b(?:co-?led|led)\s+by\s+((?:[^.;()]|(?<=\b[A-Z])\.)+)/i;
/** Where the list of leads ends: the next clause ("at a ... valuation", "with participation from..."). */
const LEAD_END = /\s(?:at|as|with|to|for|in|from|on|which|after|valuing|bringing|while|following|alongside|plus)\s/i;
const NAME_TOKEN = /^[A-Z0-9][\p{L}\p{N}&.'’-]*$/u;

/** The organisations named after "led by" / "co-led by" in the text; names that are not plain proper names are dropped. */
export function statedLeadInvestors(text: string): string[] {
  const tail = LED_BY.exec(text)?.[1];
  if (!tail) return [];
  const list = tail.split(LEAD_END)[0] ?? '';
  const names = list
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 1);
  const out: string[] = [];
  for (const name of names) {
    const tokens = name.split(/\s+/);
    if (tokens.length > 5 || !tokens.every((token) => NAME_TOKEN.test(token))) continue;
    if (!out.some((seen) => seen.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

const GENERIC = /^(?:capital|ventures?|partners?|fund|funds|group|holdings?|investments?|management|asset|global|the|and|of|inc|llc|ltd|corp|corporation|company|technologies|technology|labs?|ai)$/i;
const keyWords = (name: string): string[] =>
  name.normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 2 && !GENERIC.test(word));

/** The same organisation allowing for a short form ("Lightspeed" and "Lightspeed Venture Partners"). */
export function sameOrganisation(a: string, b: string): boolean {
  const wa = keyWords(a);
  const wb = keyWords(b);
  if (wa.length === 0 || wb.length === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  const [small, large] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return small.every((word) => large.includes(word));
}

/** An affiliation that is a person's job or school, not an organisation that could hold a board seat for its money. */
const NOT_A_BACKER = /\b(ceo|cto|cfo|coo|chief|founder|co-?founder|president|chair(?:man|woman|person)?|professor|prof\.|lecturer|director|employee|engineer|scientist|researcher|advisor|adviser|independent|retired|former|university|institute|school|college|academy|government|ministry|foundation|laborator(?:y|ies))\b/i;
const LEADING_ROLE = /^(?:(?:general|managing|venture|operating)\s+)?partner\s*(?:,|\bat\b|\bof\b|[-–—@])\s*/i;
/** Text that names a role, not an organisation ("Board Member", "Investor", a bare "Partner"). */
const ROLE_ONLY = /^(?:board(?:\s+(?:member|observer|director))?|observer|investor|partner|member|trustee|independent)$/i;
/** An organisation whose name says it invests: the only kind a board seat can even hint at as a backer. */
const INVESTMENT_FIRM = /\b(capital|ventures?|partners|fund|funds|investments?|holdings|vc|equity|asset management)\b/i;

/** The organisation a board affiliation names ("Partner, Lightspeed" gives "Lightspeed"); null for a job, a school or the company itself. */
export function organisationOfAffiliation(affiliation: string | null | undefined, companyName?: string): string | null {
  const text = (affiliation ?? '').trim().replace(LEADING_ROLE, '').trim();
  if (text.length < 2 || text.length > 60 || /[()]/.test(text) || NOT_A_BACKER.test(text) || ROLE_ONLY.test(text)) return null;
  const tokens = text.split(/\s+/);
  if (tokens.length > 6 || !tokens.every((token) => NAME_TOKEN.test(token))) return null;
  if (companyName && sameOrganisation(text, companyName)) return null;
  return text;
}

/**
 * The investor list a company's own sourced data supports: the investors
 * research already listed, plus every lead named on a round. Derived entries
 * keep kind "other" (the data does not say what kind of money they are) and
 * their note says which fact they come from. Nothing else is added.
 *
 * A board seat says nothing about who put money in (a director's employer is
 * not a backer: Disney is not an investor in Microsoft), so board affiliations
 * are only read when the caller asks (`includeBoardAffiliations`), and even then
 * only an organisation whose name says it invests. The beta leaves it off.
 */
export function deriveInvestors(input: {
  companyName?: string;
  board?: readonly BoardMember[];
  fundingRounds?: readonly Round[];
  investors?: readonly Investor[];
  includeBoardAffiliations?: boolean;
}): Investor[] {
  const out: Investor[] = (input.investors ?? []).map((investor) => ({ ...investor }));
  const add = (name: string, note: string) => {
    if (out.some((existing) => sameOrganisation(existing.name, name))) return;
    out.push({ name, kind: 'other', note });
  };
  for (const round of input.fundingRounds ?? []) {
    const label = round.round.trim();
    for (const lead of round.leadInvestors ?? []) {
      const name = lead.trim();
      if (name) add(name, `Led ${label || 'a reported round'}${round.date?.trim() ? ` (${round.date.trim()})` : ''}.`);
    }
  }
  if (input.includeBoardAffiliations) {
    for (const member of input.board ?? []) {
      const org = organisationOfAffiliation(member.affiliation, input.companyName);
      if (org && INVESTMENT_FIRM.test(org)) add(org, `Affiliation of board member ${member.name}.`);
    }
  }
  return out;
}
