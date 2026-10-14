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
import type { Ownership } from './types';

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
