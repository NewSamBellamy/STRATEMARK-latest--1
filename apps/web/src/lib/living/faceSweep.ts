/**
 * Face sweep — one targeted "fill card faces" pass over every company card
 * whose four face slots are not all filled.
 *
 * Why it exists: the living runtime's hunts are rationed (per-session attempt
 * cap, 10-minute retry cooldown, 3 companies per tick) because they run for
 * the whole life of an open deck. A freshly revealed deck wants the opposite
 * for ONE pass: every empty face slot gets one grounded question right now.
 * This sweep therefore keeps its own ledger-free path: it never reads or
 * writes the runtime's hunt ledger, so it neither consumes nor is blocked by
 * the per-session cap/cooldown.
 *
 * Honesty: the sweep asks the repository's existing hunt (huntCompanyMetrics)
 * with `faceSlotsOnly`, which restricts the question to metric types a face
 * slot can show, and every answer still passes the repository's gates
 * (company-named sentence, citation, estimated tier, band-not-point, etc.).
 * Nothing here proposes or writes a figure.
 */
import { isEntityCardType, type CardWithCompany, type MarketIntelRepository } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';

export interface FaceSweepTarget {
  companyId: string;
  /** The deck card, so the face can be re-read after a pass. */
  card?: CardWithCompany;
  companyName: string;
  /** Families the face still lacks a sourced figure for (employees / revenue / reach / company_value / aum). */
  missingSlots: string[];
}

export interface FaceSweepResult {
  targeted: number;
  /** Companies where the repository reported at least one newly filled figure. */
  filledCompanies: number;
  filledTypes: number;
  failed: number;
}

/** Places on the card face with no sourced figure yet (the face shows the four
 * strongest sourced figures of any type, so a company with four already needs
 * no sweep even if one metric family is missing). Signal cards have none. */
export function missingFaceSlots(card: CardWithCompany): string[] {
  if (!card.company || !isEntityCardType(card.card.cardType)) return [];
  return buildCardView(card).faceMetrics.filter((slot) => slot.metric === undefined).map((slot) => slot.key);
}

/**
 * Which kinds of figure the deck's faces are still missing, most common first:
 * the systematic gaps (a figure type that fails across many companies) stand
 * out from one-off misses, so a fix targets the process rather than a deck.
 */
export function gapsByKind(cards: readonly CardWithCompany[]): Array<{ label: string; companies: number }> {
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (!card.company || seen.has(card.company.id) || !isEntityCardType(card.card.cardType)) continue;
    seen.add(card.company.id);
    for (const slot of buildCardView(card).faceMetrics) {
      if (slot.metric === undefined) counts.set(slot.label, (counts.get(slot.label) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([label, companies]) => ({ label, companies }))
    .sort((a, b) => b.companies - a.companies || a.label.localeCompare(b.label));
}

/** One target per company with at least one empty face slot, most-empty first. */
export function selectFaceSweepTargets(cards: readonly CardWithCompany[]): FaceSweepTarget[] {
  const seen = new Set<string>();
  const targets: FaceSweepTarget[] = [];
  for (const card of cards) {
    if (!card.company || seen.has(card.company.id)) continue;
    seen.add(card.company.id);
    const missingSlots = missingFaceSlots(card);
    if (missingSlots.length > 0) targets.push({ companyId: card.company.id, companyName: card.company.name, missingSlots, card });
  }
  return targets.sort((a, b) => b.missingSlots.length - a.missingSlots.length);
}

export interface FaceSweepDeps {
  repo: Pick<MarketIntelRepository, 'huntCompanyMetrics' | 'recoverSavedCompanyMetrics' | 'huntFaceSlotsBatch' | 'huntFacesFromSearch' | 'reuseCompanyEvidence'>;
  concurrency?: number;
  /** Called after each company finishes (success or failure). */
  onCompany?(target: FaceSweepTarget, outcome: FaceSweepOutcome): void | Promise<void>;
  shouldStop?(): boolean;
}

/** One company's sweep. `searched`: a paid face search ran for it (the batch or
 * its own plain hunt). `stopped`: research was paused before its escalated pass. */
export interface FaceSweepOutcome { filled: number; failed: boolean; searched: boolean; stopped: boolean }

export const FACE_SWEEP_CONCURRENCY = 6;

/**
 * Run the sweep over `cards`. Free recovery from saved evidence goes first
 * (no provider spend). Then, where the repository can batch, ONE grounded
 * search covers up to ten companies' empty face slots (a search per company
 * paid the per-call fee each time; the per-company gates are unchanged), and
 * only a face still short after it gets one escalated search of its own.
 * Without batching each company gets one `faceSlotsOnly` hunt and one
 * escalated retry when that leaves the face short. A thrown company is
 * counted and skipped; it never aborts the sweep.
 */
export async function runFaceSweep(cards: readonly CardWithCompany[], deps: FaceSweepDeps): Promise<FaceSweepResult> {
  const targets = selectFaceSweepTargets(cards);
  const result: FaceSweepResult = { targeted: targets.length, filledCompanies: 0, filledTypes: 0, failed: 0 };
  const limit = Math.max(1, Math.floor(deps.concurrency ?? FACE_SWEEP_CONCURRENCY));
  const pool = async (work: (target: FaceSweepTarget) => Promise<void>) => {
    let next = 0;
    const worker = async () => { while (next < targets.length && !deps.shouldStop?.()) await work(targets[next++]!); };
    await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
  };
  const short = (target: FaceSweepTarget, metrics: CardWithCompany['metrics']) =>
    !target.card || missingFaceSlots({ ...target.card, metrics }).length > 0;

  const recovered = new Map<string, number>();
  const stillShort = new Set(targets.map((t) => t.companyId));
  // Bound: the app's repository is a class instance, and a detached method call loses `this`.
  const batch = deps.repo.huntFaceSlotsBatch?.bind(deps.repo);
  const fromSearch = deps.repo.huntFacesFromSearch?.bind(deps.repo);
  const searchFilled = new Map<string, number>();
  // A twin of this company researched in another deck lends its saved evidence
  // first (free), so recovery below can re-derive figures instead of paying for them.
  const reuse = async (target: FaceSweepTarget) => {
    if (!deps.repo.reuseCompanyEvidence) return;
    try { await deps.repo.reuseCompanyEvidence(target.companyId); } catch { /* recovery still runs */ }
  };
  let batched: Record<string, Awaited<ReturnType<NonNullable<MarketIntelRepository['huntCompanyMetrics']>>>> = {};
  if (batch && deps.repo.huntCompanyMetrics) {
    // Free recovery for every company first, so the batched search asks only for what is still empty.
    if (deps.repo.recoverSavedCompanyMetrics) {
      const recover = deps.repo.recoverSavedCompanyMetrics.bind(deps.repo);
      await pool(async (target) => {
        await reuse(target);
        try {
          const out = await recover(target.companyId);
          recovered.set(target.companyId, out.filledTypes.length);
          if (out.filledTypes.length > 0 && !short(target, out.metrics)) stillShort.delete(target.companyId);
        } catch { /* the hunt still runs */ }
      });
    }
    const ids = targets.map((t) => t.companyId).filter((id) => stillShort.has(id));
    if (ids.length > 0 && !deps.shouldStop?.()) {
      // Search-first (no model call, no paid search): a search engine's own snippets fill what
      // they state outright, so the batched grounded search below asks only for what is still empty.
      if (fromSearch) {
        try {
          for (const [id, out] of Object.entries(await fromSearch(ids))) searchFilled.set(id, out.filledTypes.length);
        } catch { /* the grounded search still runs */ }
      }
      try { batched = await batch(ids); } catch { /* each company is hunted alone below */ }
    }
  }

  await pool(async (target) => {
    let filled = (recovered.get(target.companyId) ?? 0) + (searchFilled.get(target.companyId) ?? 0);
    let failed = false;
    let searched = false;
    let stopped = false;
    if (!batch && deps.repo.recoverSavedCompanyMetrics) {
      await reuse(target);
      try { filled += (await deps.repo.recoverSavedCompanyMetrics(target.companyId)).filledTypes.length; } catch { /* the hunt still runs */ }
    }
    const first = batched[target.companyId];
    if (first && deps.repo.huntCompanyMetrics) {
      filled += first.filledTypes.length;
      searched = true;
      // The batched search was this face's plain pass: only a face still short gets one escalated search.
      if (short(target, first.metrics) && deps.shouldStop?.()) stopped = true;
      else if (short(target, first.metrics)) {
        try { filled += (await deps.repo.huntCompanyMetrics(target.companyId, { faceSlotsOnly: true, escalation: 1 })).filledTypes.length; }
        catch { failed = true; }
      }
    } else if (deps.repo.huntCompanyMetrics && (!batch || stillShort.has(target.companyId))) {
      try {
        const first = await deps.repo.huntCompanyMetrics(target.companyId, { faceSlotsOnly: true });
        filled += first.filledTypes.length;
        searched = true;
        // A face still short after the first pass gets one escalated pass
        // (filings, trade press, funding news) before it settles on "Not found yet".
        const stillMissing = first.filledTypes.length === 0 || !target.card ||
          missingFaceSlots({ ...target.card, metrics: first.metrics }).length > 0;
        if (stillMissing && deps.shouldStop?.()) stopped = true;
        else if (stillMissing) {
          filled += (await deps.repo.huntCompanyMetrics(target.companyId, { faceSlotsOnly: true, escalation: 1 })).filledTypes.length;
        }
      } catch { failed = true; }
    }
    if (failed) result.failed += 1;
    if (filled > 0) { result.filledCompanies += 1; result.filledTypes += filled; }
    try { await deps.onCompany?.(target, { filled, failed, searched, stopped }); } catch { /* reporting must not stop the sweep */ }
  });
  return result;
}
