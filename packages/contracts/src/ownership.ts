/**
 * Ownership status provenance and display.
 *
 * Same promise as metrics: a status nothing states is not shown. Any status
 * without a usable citation is dropped (absent, not "independent"); automation
 * may never assert `user_verified`; a status that needs an acquirer and has
 * none is dropped. The label is the one short line the card and dashboard
 * header show — and an independent company shows nothing at all.
 */
import { usableCitations } from './provenance';
import type { CompanyMetric, Ownership } from './types';

const HUMAN_ONLY_NOTE = 'Human-verification claim removed automatically: only a person can mark ownership user-verified.';

/**
 * Bring an ownership record in line with the evidence rules. `fromAutomation`
 * is true at every point a record enters from a research lane; a stored
 * human-checked record passes with `false`.
 */
export function enforceOwnershipProvenance(ownership: Ownership | null | undefined, fromAutomation = false): Ownership | null {
  if (!ownership) return null;
  const citations = usableCitations(ownership.citations);
  let confidence = ownership.confidence;
  let methodNote = ownership.methodNote ?? null;
  if (fromAutomation && confidence === 'user_verified') {
    confidence = 'verified';
    methodNote = methodNote ? `${methodNote} — ${HUMAN_ONLY_NOTE}` : HUMAN_ONLY_NOTE;
  }
  // A human-checked status stands on its own; every other status needs a source.
  if (confidence !== 'user_verified' && (citations.length === 0 || confidence === 'unknown')) return null;
  const acquirer = ownership.acquirer?.trim() || undefined;
  if (ownership.status !== 'independent' && !acquirer) return null;
  // A closing date is a claim that the deal closed; a pending deal cannot carry one.
  const closedOn = ownership.status === 'acquired' ? ownership.closedOn ?? null : null;
  return {
    ...ownership,
    acquirer: ownership.status === 'independent' ? undefined : acquirer,
    closedOn,
    // Only a deal carries a price; a registry parent or independence does not.
    price: ownership.status === 'acquired' || ownership.status === 'acquisition_pending' ? ownership.price ?? null : null,
    citations,
    confidence,
    methodNote,
  };
}

function yearOf(date: string | null | undefined): string | null {
  return date && /^\d{4}/.test(date) ? date.slice(0, 4) : null;
}

/**
 * "Acquired by PepsiCo · 2025", "Acquisition by SpaceX pending",
 * "Subsidiary of Alphabet". Null for independent or unsupported records: the
 * card stays exactly as it was.
 */
export function ownershipLabel(ownership: Ownership | null | undefined): string | null {
  const o = enforceOwnershipProvenance(ownership);
  if (!o?.acquirer) return null;
  switch (o.status) {
    case 'acquired': {
      const year = yearOf(o.closedOn) ?? yearOf(o.announcedOn);
      return `Acquired by ${o.acquirer}${year ? ` · ${year}` : ''}`;
    }
    case 'acquisition_pending':
      return `Acquisition by ${o.acquirer} pending`;
    case 'subsidiary':
      return `Subsidiary of ${o.acquirer}`;
    default:
      return null;
  }
}

const DAY_MS = 86_400_000;
/** A valuation this close before a takeover is the deal, not an independent round. */
export const PRE_DEAL_WINDOW_DAYS = 90;

/** Earliest instant a partial date ("2025", "2025-03", "2025-03-17") can mean. */
function startOf(date: string | null | undefined): number | null {
  const m = date ? /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(date) : null;
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1);
  return Number.isFinite(t) ? t : null;
}

function samePrice(a: number, b: number): boolean {
  return a > 0 && b > 0 && Math.abs(a - b) <= Math.max(a, b) * 0.005;
}

/**
 * Process rule for an ACQUIRED company (ownership lives on the company, so it
 * applies wherever a company's figures are displayed or revalidated): its
 * valuation figure is withheld when
 *  (a) it equals the acquisition price (within 0.5%), or
 *  (b) its evidence is dated on/after the deal's announcement (or close when no
 *      announcement is evidenced) minus {@link PRE_DEAL_WINDOW_DAYS}, or
 *  (c) its evidence carries no date at all (no `asOf` on its quoted, reported
 *      or passage support). After an acquisition there is no independent
 *      current valuation, and an undated figure cannot be shown to pre-date the
 *      deal — it is most often the deal price itself.
 * (b) and (c) apply only when the ownership record carries a usable citation.
 * Never for a pending deal (a pre-deal round is legitimate history), never for
 * a human-verified figure, and never without a sourced acquired status. A
 * DATED round from before the window stands as history.
 */
export function ownershipWithholdsValuation(
  metric: Pick<CompanyMetric, 'metricType' | 'value' | 'confidence' | 'passageSupport' | 'reportedSupport' | 'quotedSupport'>,
  ownership: Ownership | null | undefined,
): boolean {
  if (metric.metricType !== 'valuation' || metric.value == null || metric.confidence === 'user_verified') return false;
  const o = enforceOwnershipProvenance(ownership);
  if (!o || o.status !== 'acquired') return false;
  const price = o.price?.value;
  if (price != null) {
    const values = [metric.value, metric.quotedSupport?.value, metric.reportedSupport?.value]
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.some((v) => samePrice(v, price))) return true;
  }
  if (o.citations.length === 0) return false;
  const dates = [metric.quotedSupport?.asOf, metric.reportedSupport?.asOf, metric.passageSupport?.asOf]
    .map((d) => startOf(d)).filter((t): t is number => t != null);
  // (c) Undated: nothing shows this figure pre-dates the deal.
  if (dates.length === 0) return true;
  const anchor = startOf(o.announcedOn ?? o.closedOn);
  if (anchor == null) return false;
  const floor = anchor - PRE_DEAL_WINDOW_DAYS * DAY_MS;
  return dates.some((t) => t >= floor);
}

/** Reason stamped on a valuation withheld by {@link ownershipWithholdsValuation}. */
export const DEAL_TIME_VALUATION_NOTE =
  'Not shown as a valuation: the company was acquired, and this figure matches the acquisition price, dates from the deal itself (within 90 days before the announcement), or has no date to show it came before the deal. After an acquisition there is no independent valuation.';
