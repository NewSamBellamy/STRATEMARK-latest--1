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
  return desktopRepoFrom(twinWorkspace(), [...pages]);
}

function desktopRepoFrom(start: RepoSnapshot, store: OriginalSourceAttempt[]) {
  let saved = structuredClone(start);
  // Like the desktop store, it accepts only src_<uuid> ids.
  const save = vi.fn(async (attempt: OriginalSourceAttempt) => {
    if (!/^src_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(attempt.id)) throw new Error('Invalid original-source attempt.');
    store.push(structuredClone(attempt));
  });
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

  it('two lending passes at once lend once, and a repeat lends nothing again', async () => {
    const start = twinWorkspace();
    start.researchEvidence = [{ id: 'ev_a', companyId: 'acme', companyName: 'Acme Robotics', topic: 'company_briefing',
      capturedAt: '2026-10-10T00:00:00.000Z', text: 'Acme Robotics builds warehouse robots.', citations: [], queries: [] }] as RepoSnapshot['researchEvidence'];
    const store = [page('p1', 'acme')];
    const { repo: fresh } = desktopRepoFrom(start, store);
    expect(await Promise.all([fresh.reuseCompanyEvidence('acme_2'), fresh.reuseCompanyEvidence('acme_2')])).toEqual([2, 0]);
    expect(await fresh.reuseCompanyEvidence('acme_2')).toBe(0);
    expect(store.filter((row) => row.companyId === 'acme_2')).toHaveLength(1);
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

describe('only a true twin lends its saved pages and notes', () => {
  const note = (companyId: string, companyName: string, text: string) => ({ id: `ev_${companyId}_${text.length}`, companyId, companyName,
    topic: 'company_briefing', capturedAt: '2026-10-10T00:00:00.000Z', text, citations: [], queries: [] });

  it('a different company on the same shared host (two LinkedIn pages) lends nothing', async () => {
    const start = twinWorkspace();
    start.companies.find((c) => c.id === 'acme')!.websiteUrl = 'https://www.linkedin.com/company/acme-robotics';
    const stranger = start.companies.find((c) => c.id === 'acme_2')!;
    stranger.name = 'Beacon Freight'; stranger.websiteUrl = 'https://www.linkedin.com/company/beacon-freight';
    start.researchEvidence = [note('acme', 'Acme Robotics', 'Acme Robotics builds warehouse robots.')] as RepoSnapshot['researchEvidence'];
    const store = [page('p1', 'acme')];
    const { repo, saved } = desktopRepoFrom(start, store);
    expect(await repo.reuseCompanyEvidence('acme_2')).toBe(0);
    expect(store.filter((row) => row.companyId === 'acme_2')).toHaveLength(0);
    expect(saved().researchEvidence?.filter((e) => e.companyId === 'acme_2') ?? []).toHaveLength(0);
  });

  it('a same-name company with its own, different website lends nothing', async () => {
    const start = twinWorkspace();
    start.companies.find((c) => c.id === 'acme_2')!.websiteUrl = 'https://acme-robotics.example';
    const store = [page('p1', 'acme')];
    const { repo } = desktopRepoFrom(start, store);
    expect(await repo.reuseCompanyEvidence('acme_2')).toBe(0);
    expect(store.filter((row) => row.companyId === 'acme_2')).toHaveLength(0);
  });

  it('a twin lends its own notes but not a note about another company filed under it', async () => {
    const start = twinWorkspace();
    start.researchEvidence = [note('acme', 'Acme Robotics', 'Acme Robotics builds warehouse robots.'),
      note('acme', 'Beacon Freight', 'Beacon Freight raised a Series B.')] as RepoSnapshot['researchEvidence'];
    const { repo, saved } = desktopRepoFrom(start, [page('p1', 'acme')]);
    await repo.reuseCompanyEvidence('acme_2');
    expect(saved().researchEvidence?.filter((e) => e.companyId === 'acme_2').map((e) => e.text)).toEqual(['Acme Robotics builds warehouse robots.']);
  });

  it('the same site written with www and a trailing slash is still the twin', async () => {
    const start = twinWorkspace();
    start.companies.find((c) => c.id === 'acme_2')!.websiteUrl = 'https://www.acme.example/';
    const store = [page('p1', 'acme')];
    const { repo } = desktopRepoFrom(start, store);
    expect(await repo.reuseCompanyEvidence('acme_2')).toBe(1);
  });
});
