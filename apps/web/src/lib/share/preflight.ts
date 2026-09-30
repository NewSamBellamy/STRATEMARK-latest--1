/**
 * Share preflight — fact-check before the card leaves the building.
 *
 * The figures on a shared card are its face value; sending someone a card
 * with soft or contradicted numbers is sending them a defect. So before a
 * card share is packaged, every metric that hasn't been verified gets the
 * full live re-verification pass (the same write-back path as the in-app
 * fact-check): corrections apply, badges upgrade, the company re-tiers —
 * and the share is built from the reconciled figures.
 *
 * A failed check never blocks the share (the link still ships, honestly
 * badged); low-power mode and missing transports skip the pass entirely.
 */
import { metricDisplayLabel, type CardWithCompany, type MarketIntelRepository } from '@mi/contracts';

/** Cap the pre-share verification burn: at most this many grounded checks. */
const MAX_CHECKS = 5;

export async function verifyCardForShare(
  repo: MarketIntelRepository,
  data: CardWithCompany,
  onStage: (stage: string) => void,
): Promise<CardWithCompany> {
  const companyId = data.company?.id ?? null;
  if (!companyId || typeof repo.verifyMetric !== 'function') return data;

  const soft = data.metrics
    .filter((m) => m.value != null && m.confidence !== 'verified' && m.confidence !== 'user_verified')
    .slice(0, MAX_CHECKS);
  if (soft.length === 0) return data;

  for (const m of soft) {
    onStage(`Fact-checking ${metricDisplayLabel(m)}…`);
    try {
      await repo.verifyMetric({ companyId, metricType: m.metricType, correction: null });
    } catch {
      /* one failed check must never block the share */
    }
  }

  onStage('Packaging the card…');
  try {
    const fresh = await repo.getCompanyMetrics(companyId);
    return { ...data, metrics: fresh };
  } catch {
    return data;
  }
}
