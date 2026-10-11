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

/** One target per company with at least one empty face slot, most-empty first. */
export function selectFaceSweepTargets(cards: readonly CardWithCompany[]): FaceSweepTarget[] {
  const seen = new Set<string>();
  const targets: FaceSweepTarget[] = [];
  for (const card of cards) {
    if (!card.company || seen.has(card.company.id)) continue;
    seen.add(card.company.id);
    const missingSlots = missingFaceSlots(card);
    if (missingSlots.length > 0) targets.push({ companyId: card.company.id, companyName: card.company.name, missingSlots });
  }
  return targets.sort((a, b) => b.missingSlots.length - a.missingSlots.length);
}

export interface FaceSweepDeps {
  repo: Pick<MarketIntelRepository, 'huntCompanyMetrics' | 'recoverSavedCompanyMetrics'>;
  concurrency?: number;
  /** Called after each company finishes (success or failure). */
  onCompany?(target: FaceSweepTarget, outcome: { filled: number; failed: boolean }): void | Promise<void>;
  shouldStop?(): boolean;
}

export const FACE_SWEEP_CONCURRENCY = 4;

/**
 * Run the sweep over `cards`. Free recovery from saved evidence goes first per
 * company (no provider spend), then one `faceSlotsOnly` grounded hunt. A
 * thrown company is counted and skipped; it never aborts the sweep.
 */
export async function runFaceSweep(cards: readonly CardWithCompany[], deps: FaceSweepDeps): Promise<FaceSweepResult> {
  const targets = selectFaceSweepTargets(cards);
  const result: FaceSweepResult = { targeted: targets.length, filledCompanies: 0, filledTypes: 0, failed: 0 };
  const limit = Math.max(1, Math.floor(deps.concurrency ?? FACE_SWEEP_CONCURRENCY));
  let next = 0;
  const worker = async () => {
    while (next < targets.length && !deps.shouldStop?.()) {
      const target = targets[next++]!;
      let filled = 0;
      let failed = false;
      if (deps.repo.recoverSavedCompanyMetrics) {
        try { filled += (await deps.repo.recoverSavedCompanyMetrics(target.companyId)).filledTypes.length; } catch { /* the hunt still runs */ }
      }
      if (deps.repo.huntCompanyMetrics) {
        try { filled += (await deps.repo.huntCompanyMetrics(target.companyId, { faceSlotsOnly: true })).filledTypes.length; }
        catch { failed = true; }
      }
      if (failed) result.failed += 1;
      if (filled > 0) { result.filledCompanies += 1; result.filledTypes += filled; }
      try { await deps.onCompany?.(target, { filled, failed }); } catch { /* reporting must not stop the sweep */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, targets.length) }, worker));
  return result;
}
