import { describe, expect, it, vi } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';
import { FACE_SWEEP_CONCURRENCY, missingFaceSlots, runFaceSweep, selectFaceSweepTargets } from './faceSweep';

const dataset = buildDataset();
const baseCard = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
const baseCompany = dataset.companies.find((c) => c.id === baseCard.companyId)!;
const seed = dataset.metrics.find((m) => m.companyId === baseCompany.id)!;
const cite = [{ title: 'Reuters', url: 'https://www.reuters.com/x', credibility: 'reputable_secondary' as const }];

function human(companyId: string, metricType: CompanyMetric['metricType'], value: number): CompanyMetric {
  return { ...seed, id: `${companyId}_${metricType}`, companyId, metricType, value, confidence: 'user_verified', citations: cite, source: cite[0]!.url };
}
function deckCard(n: number, metrics: CompanyMetric[]): CardWithCompany {
  const id = `cmp_sweep_${n}`;
  return { card: { ...baseCard, id: `card_${n}`, companyId: id },
    company: { ...baseCompany, id, name: `Sweep Co ${n}`, oneLiner: `Sweep Co ${n} sells skincare.` },
    metrics: metrics.map((m) => ({ ...m, companyId: id })), viceClaims: [] };
}
const full = (n: number) => deckCard(n, [human('x', 'employees', 40), human('x', 'arr', 2e6), human('x', 'users', 900), human('x', 'valuation', 2e7)]);

describe('face sweep selection', () => {
  it('targets only cards with an empty face slot, most empty first, and names the missing slots', () => {
    const partial = deckCard(2, [human('x', 'employees', 40), human('x', 'users', 900)]);
    const empty = deckCard(3, []);
    const targets = selectFaceSweepTargets([full(1), partial, empty]);
    expect(targets.map((t) => t.companyName)).toEqual(['Sweep Co 3', 'Sweep Co 2']);
    expect(targets[1]!.missingSlots).toEqual(['revenue', 'company_value']);
    expect(targets[0]!.missingSlots).toHaveLength(4);
    expect(missingFaceSlots(full(1))).toEqual([]);
  });

  it('skips a company whose face already shows four sourced figures, whatever their families', () => {
    // No users and no ARR, but four sourced figures: the face is full, so no hunt is spent.
    const mixed = deckCard(5, [human('x', 'employees', 40), human('x', 'valuation', 2e7),
      human('x', 'funding_total', 9e6), human('x', 'last_round', 4e6)]);
    expect(missingFaceSlots(mixed)).toEqual([]);
    expect(selectFaceSweepTargets([mixed])).toEqual([]);
  });

  it('counts a stored headcount band as a filled employees slot and shows it as a range', () => {
    const text = 'Sweep Co 4 has 51 to 100 employees.';
    const band: CompanyMetric = { ...seed, id: 'band', metricType: 'employees', value: null, confidence: 'estimated', citations: cite,
      source: cite[0]!.url, methodNote: 'band', passageSupport: null, reportedSupport: null,
      reportedBand: { provider: 'google-search', companyName: 'Sweep Co 4', basis: 'employees', low: 51, high: 100, unit: 'count', asOf: null,
        support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: cite[0]!.url, title: 'Reuters' }] } } };
    const card = deckCard(4, [band]);
    const first = buildCardView(card).profileMetrics[0]!;
    expect(first).toMatchObject({ display: '51–100', label: 'Employees (range)', confidence: 'Source reported' });
    expect(first.metric?.value).toBeNull();
    expect(missingFaceSlots(card)).toEqual(['revenue', 'reach', 'company_value']);
    // A tampered band (different company) is never shown.
    const forged = deckCard(4, [{ ...band, reportedBand: { ...band.reportedBand!, companyName: 'Someone Else' } }]);
    expect(buildCardView(forged).profileMetrics[0]!.display).toBe('Unknown');
  });
});

describe('face sweep run', () => {
  it('asks the hunt for face slots only, once per target, with concurrency 6 and no repeat budget', async () => {
    const cards = Array.from({ length: 10 }, (_, i) => deckCard(i + 10, []));
    cards.push(full(99));
    let active = 0, peak = 0;
    const huntCompanyMetrics = vi.fn(async (_id: string, _options?: unknown) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      // The pass fills the face, so no escalated retry follows.
      return { filledTypes: ['employees' as const], metrics: full(1).metrics, retieredCardIds: [] };
    });
    const recoverSavedCompanyMetrics = vi.fn(async () => ({ filledTypes: [], metrics: [], retieredCardIds: [] }));
    const done: string[] = [];
    const result = await runFaceSweep(cards, { repo: { huntCompanyMetrics, recoverSavedCompanyMetrics }, onCompany: (t) => { done.push(t.companyId); } });
    expect(FACE_SWEEP_CONCURRENCY).toBe(6);
    expect(peak).toBe(6);
    expect(huntCompanyMetrics).toHaveBeenCalledTimes(10);
    for (const call of huntCompanyMetrics.mock.calls) expect(call[1]).toEqual({ faceSlotsOnly: true });
    expect(huntCompanyMetrics.mock.calls.map((c) => c[0])).not.toContain('cmp_sweep_99');
    expect(new Set(done).size).toBe(10);
    expect(result).toEqual({ targeted: 10, filledCompanies: 10, filledTypes: 10, failed: 0 });
  });

  it('retries an empty first pass once with an escalated search, and only then', async () => {
    const cards = [deckCard(1, []), deckCard(2, [])];
    const huntCompanyMetrics = vi.fn(async (id: string, options?: { escalation?: number }) =>
      ({ filledTypes: id === 'cmp_sweep_1' && options?.escalation === 1 ? ['users' as const] : [], metrics: [], retieredCardIds: [] }));
    const result = await runFaceSweep(cards, { repo: { huntCompanyMetrics }, concurrency: 1 });
    expect(huntCompanyMetrics.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ['cmp_sweep_1', { faceSlotsOnly: true }], ['cmp_sweep_1', { faceSlotsOnly: true, escalation: 1 }],
      ['cmp_sweep_2', { faceSlotsOnly: true }], ['cmp_sweep_2', { faceSlotsOnly: true, escalation: 1 }],
    ]);
    expect(result).toEqual({ targeted: 2, filledCompanies: 1, filledTypes: 1, failed: 0 });
  });

  it('escalates when a pass fills something but the face is still short', async () => {
    const huntCompanyMetrics = vi.fn(async (_id: string, options?: { escalation?: number }) => ({
      filledTypes: [options?.escalation ? 'users' as const : 'employees' as const],
      metrics: deckCard(1, [human('x', 'employees', 40)]).metrics, retieredCardIds: [] }));
    await runFaceSweep([deckCard(1, [])], { repo: { huntCompanyMetrics }, concurrency: 1 });
    expect(huntCompanyMetrics.mock.calls.map((c) => c[1])).toEqual([{ faceSlotsOnly: true }, { faceSlotsOnly: true, escalation: 1 }]);
  });

  it('a failing company is counted and skipped; stop signal halts new work', async () => {
    const cards = [deckCard(1, []), deckCard(2, []), deckCard(3, [])];
    const huntCompanyMetrics = vi.fn(async (id: string) => {
      if (id === 'cmp_sweep_1') throw new Error('provider down');
      return { filledTypes: [], metrics: [], retieredCardIds: [] };
    });
    const result = await runFaceSweep(cards, { repo: { huntCompanyMetrics }, concurrency: 1 });
    expect(result).toMatchObject({ targeted: 3, failed: 1, filledCompanies: 0 });
    let stop = false;
    const stopped = vi.fn(async () => { stop = true; return { filledTypes: [], metrics: [], retieredCardIds: [] }; });
    await runFaceSweep(cards, { repo: { huntCompanyMetrics: stopped }, concurrency: 1, shouldStop: () => stop });
    expect(stopped).toHaveBeenCalledTimes(1);
  });
});

describe('face sweep run — batched', () => {
  const none = { filledTypes: [], metrics: [], retieredCardIds: [] };
  it('recovers free first, asks ONE batched search for the faces still empty, and escalates only faces still short', async () => {
    const cards = Array.from({ length: 12 }, (_, i) => deckCard(i + 1, []));
    const order: string[] = [];
    // Free recovery fills company 12's whole face: it is never searched for.
    const recoverSavedCompanyMetrics = vi.fn(async (id: string) => { order.push(`recover:${id}`);
      return id === 'cmp_sweep_12' ? { filledTypes: ['employees' as const], metrics: full(12).metrics, retieredCardIds: [] } : none; });
    const huntFaceSlotsBatch = vi.fn(async (ids: readonly string[]) => { order.push('batch');
      // Companies 1-5 come back full, 6-10 empty; 11 was left out (the caller hunts it alone).
      return Object.fromEntries(ids.filter((id) => id !== 'cmp_sweep_11').map((id) => [id, Number(id.split('_')[2]) <= 5
        ? { filledTypes: ['employees' as const, 'arr' as const], metrics: full(1).metrics, retieredCardIds: [] } : none])); });
    const huntCompanyMetrics = vi.fn(async (_id: string, _options?: unknown) => none);
    const result = await runFaceSweep(cards, { repo: { huntCompanyMetrics, recoverSavedCompanyMetrics, huntFaceSlotsBatch } });
    expect(huntFaceSlotsBatch).toHaveBeenCalledTimes(1);
    expect(huntFaceSlotsBatch.mock.calls[0]![0]).toHaveLength(11);
    expect(huntFaceSlotsBatch.mock.calls[0]![0]).not.toContain('cmp_sweep_12');
    expect(order.indexOf('batch')).toBe(12);
    const calls = huntCompanyMetrics.mock.calls.map((c) => [c[0], c[1]]);
    // Batched companies still short get ONE escalated search; none repeats the plain pass.
    for (const n of [6, 7, 8, 9, 10]) expect(calls).toContainEqual([`cmp_sweep_${n}`, { faceSlotsOnly: true, escalation: 1 }]);
    for (const n of [1, 2, 3, 4, 5, 12]) expect(calls.map((c) => c[0])).not.toContain(`cmp_sweep_${n}`);
    expect(calls.filter((c) => c[0] !== 'cmp_sweep_11')).toHaveLength(5);
    // The company the batch left out is hunted alone, plain then escalated.
    expect(calls.filter((c) => c[0] === 'cmp_sweep_11')).toEqual([['cmp_sweep_11', { faceSlotsOnly: true }], ['cmp_sweep_11', { faceSlotsOnly: true, escalation: 1 }]]);
    expect(result).toMatchObject({ targeted: 12, filledCompanies: 6, filledTypes: 11, failed: 0 });
  });

  it('a failed batch falls back to a hunt per company', async () => {
    const huntFaceSlotsBatch = vi.fn(async () => { throw new Error('quota'); });
    const huntCompanyMetrics = vi.fn(async (_id: string, _options?: unknown) => none);
    await runFaceSweep([deckCard(1, []), deckCard(2, [])], { repo: { huntCompanyMetrics, huntFaceSlotsBatch } });
    expect(huntCompanyMetrics.mock.calls.map((c) => c[1])).toContainEqual({ faceSlotsOnly: true });
    expect(huntCompanyMetrics).toHaveBeenCalledTimes(4);
  });
});
