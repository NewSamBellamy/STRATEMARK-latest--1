import { describe, expect, it, vi } from 'vitest';
import { completenessFixture } from './completeness-report.fixture';
import { selectOriginalSourceAttempts, type OriginalSourceAttempt } from './original-source';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const page = (id: string, companyId: string): OriginalSourceAttempt => ({ id, companyId, metricType: 'company_profile',
  capturedAt: '2026-10-10T00:00:00.000Z', receipts: [{ requestedUrl: 'https://acme.example/about', finalUrl: 'https://acme.example/about',
    text: 'Acme Robotics employs 120 people.', status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-10T00:00:00.000Z' }] });

/** The fixture deck plus Acme Robotics again, as a second deck would add it (new id, same site). */
function twinWorkspace(): RepoSnapshot {
  const snap = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  const acme = snap.companies.find((c) => c.id === 'acme')!;
  snap.companies.push({ ...acme, id: 'acme_2' });
  return snap;
}

/** The desktop shape: saved pages live in their own file store, not in the workspace snapshot. */
function desktopRepo(pages: OriginalSourceAttempt[]) {
  let saved = twinWorkspace();
  const store = [...pages];
  const save = vi.fn(async (attempt: OriginalSourceAttempt) => { store.push(structuredClone(attempt)); });
  const repo = new GeminiRepository({ apiKey: 'test', client: { structure: vi.fn(), ground: vi.fn() } as unknown as LlmClient,
    originalSources: { retrieve: vi.fn(), save, list: async (input) => selectOriginalSourceAttempts(store, input) },
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, save, store, saved: () => saved };
}

describe('a company researched in another deck lends its saved pages', () => {
  it('on desktop, the twin\'s saved pages come from the page store and are filed under the new company', async () => {
    const { repo, store } = desktopRepo([page('p1', 'acme'), page('p2', 'acme')]);
    // The two pages in the page store, not the stale page row left in the snapshot.
    expect(await repo.reuseCompanyEvidence('acme_2')).toBe(2);
    const lent = store.filter((row) => row.companyId === 'acme_2');
    expect(lent).toHaveLength(2);
    expect(lent[0]!.receipts[0]!.text).toBe('Acme Robotics employs 120 people.');
    expect(lent.every((row) => !['p1', 'p2'].includes(row.id))).toBe(true);
    expect(await repo.getOriginalSourceEvidence({ companyId: 'acme_2' })).toHaveLength(2);
  });

  it('on desktop, a company with saved pages of its own borrows nothing', async () => {
    const { repo, save } = desktopRepo([page('p1', 'acme'), page('own', 'acme_2')]);
    expect(await repo.reuseCompanyEvidence('acme_2')).toBe(0);
    expect(save).not.toHaveBeenCalled();
  });

  it('in the browser, where pages live in the workspace, lending still works and saves once', async () => {
    let saved = twinWorkspace();
    saved.originalSourceAttempts = [page('p1', 'acme')];
    const write = vi.fn(async (next: RepoSnapshot) => { saved = structuredClone(next); });
    const repo = new GeminiRepository({ apiKey: 'test', client: { structure: vi.fn(), ground: vi.fn() } as unknown as LlmClient,
      originalSourceReader: vi.fn(), store: { read: () => structuredClone(saved), write } });
    await repo.ready(); write.mockClear();
    expect(await repo.reuseCompanyEvidence('acme_2')).toBe(1);
    expect(saved.originalSourceAttempts?.filter((row) => row.companyId === 'acme_2')).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
