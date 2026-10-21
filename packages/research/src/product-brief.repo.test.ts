/**
 * Product briefs in the repository: stored in the snapshot, read without
 * spending, reused without force, replaced with force, absent from shares,
 * and old snapshots without the field still load.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const SITE = 'https://acme.example/fleet-manager';
const TEXT = 'Fleet Manager has 120,000 users as of March 2025. It launched in November 2022.';
const RAW = {
  overview: 'Fleet Manager is control software for Acme robots.',
  metrics: [{ label: 'Users', value: '120,000 users', asOf: 'March 2025', sourceUrl: SITE }, { label: 'Revenue', value: '$5M', asOf: null, sourceUrl: SITE }],
  sentiment: null,
  timeline: [{ date: 'Nov 2022', title: 'Launch', detail: '', sourceUrl: SITE }],
};

function setup(initial?: (s: RepoSnapshot) => RepoSnapshot) {
  const base = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [], opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  let saved: RepoSnapshot = initial ? initial(base) : base;
  const ground = vi.fn(async () => ({ text: TEXT, queries: [], citations: [{ title: 'Fleet Manager', url: SITE }] }));
  const structure = vi.fn(async (_p: string, schema: ZodType<unknown>) => schema.parse(RAW));
  const client: LlmClient = { ground, structure: structure as unknown as LlmClient['structure'] };
  const repo = new GeminiRepository({ apiKey: 'test', client, dashboardWarmup: false,
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, ground, structure, saved: () => saved };
}

describe('product briefs in the repository', () => {
  it('peek is null before research and the stored brief after, and reading never spends', async () => {
    const { repo, ground, structure, saved } = setup();
    expect(await repo.peekProductBrief('acme', 'Fleet Manager')).toBeNull();
    expect(ground).not.toHaveBeenCalled();

    const brief = await repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    expect(brief.metrics.find((m) => m.label === 'Users')?.value).toBe('120,000 users');
    expect(brief.metrics.find((m) => m.label === 'Revenue')?.value).toBeNull(); // $5M is in no answer
    expect(ground).toHaveBeenCalledTimes(3);
    expect(structure).toHaveBeenCalledTimes(1);

    expect(await repo.peekProductBrief('acme', '  fleet   MANAGER ')).toEqual(brief);
    expect(saved().productBriefs?.acme?.['fleet manager']).toEqual(brief);
    expect(ground).toHaveBeenCalledTimes(3);
  });

  it('a second call without force returns the stored brief and does not call the client; force does', async () => {
    const { repo, ground, structure } = setup();
    const first = await repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    const again = await repo.researchProductBrief({ companyId: 'acme', productName: 'fleet manager', force: false });
    expect(again).toEqual(first);
    expect(ground).toHaveBeenCalledTimes(3);
    expect(structure).toHaveBeenCalledTimes(1);

    await repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager', force: true });
    expect(ground).toHaveBeenCalledTimes(6);
    expect(structure).toHaveBeenCalledTimes(2);
  });

  it('shares one run between simultaneous callers', async () => {
    const { repo, ground } = setup();
    const [a, b] = await Promise.all([
      repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' }),
      repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' }),
    ]);
    expect(a).toEqual(b);
    expect(ground).toHaveBeenCalledTimes(3);
  });

  it('a failed forced run keeps the stored brief', async () => {
    const { repo, ground, saved } = setup();
    const first = await repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    ground.mockRejectedValue(new Error('offline'));
    await expect(repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager', force: true })).rejects.toThrow();
    expect(await repo.peekProductBrief('acme', 'Fleet Manager')).toEqual(first);
    expect(saved().productBriefs?.acme?.['fleet manager']).toEqual(first);
  });

  it('rejects an unknown company or an empty product name without calling the client', async () => {
    const { repo, ground } = setup();
    await expect(repo.researchProductBrief({ companyId: 'nope', productName: 'Fleet Manager' })).rejects.toThrow(/Company not found/);
    await expect(repo.researchProductBrief({ companyId: 'acme', productName: '   ' })).rejects.toThrow(/Name a product/);
    expect(ground).not.toHaveBeenCalled();
  });

  it('a snapshot written before the field existed loads, and an unreadable stored brief is ignored', async () => {
    const old = setup();
    expect(old.saved().productBriefs).toBeUndefined();
    expect(await old.repo.peekProductBrief('acme', 'Fleet Manager')).toBeNull();
    expect(migrateSnapshot(old.saved()).snapshot.productBriefs).toBeUndefined();

    const broken = setup((s) => ({ ...s, productBriefs: { acme: { 'fleet manager': { companyId: 'other', productName: 1 } as never } } }));
    expect(await broken.repo.peekProductBrief('acme', 'Fleet Manager')).toBeNull();
  });

  it('exportShareSnapshot never carries briefs', async () => {
    const { repo, saved } = setup();
    await repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    const deckId = saved().decks[0]?.id;
    if (!deckId) throw new Error('fixture has no deck');
    const share = await repo.exportShareSnapshot({ deckId });
    expect(JSON.stringify(share)).not.toContain('productBriefs');
    expect(JSON.stringify(share)).not.toContain('Fleet Manager is control software');
  });
});
