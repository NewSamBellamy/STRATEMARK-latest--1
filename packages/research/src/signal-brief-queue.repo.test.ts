/**
 * Brief builds are capped at 2 in flight per workspace. Extra ones wait, and a waiting one whose card was closed (its signal
 * aborted) is dropped before it pays for anything. Fakes only; no live key.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Card } from '@mi/contracts';
import { completenessFixture } from './completeness-report.fixture';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

const NEWS = 'https://news.example/acme-fine';
const FINE = 'Acme Robotics was fined $2 million by a safety regulator in March 2024 after a warehouse robot injured a worker.';
const at = '2026-10-01T00:00:00.000Z';
const ids = ['v1', 'v2', 'v3', 'v4', 'v5'];

function setup() {
  const base = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [], opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  base.cards = [...base.cards, ...ids.map((id): Card => ({ id, deckId: 'deck_fx', companyId: 'acme', cardType: 'vice', title: 'Acme safety fine', summary: null, tier: null, tierReason: null, citations: [], keyPoints: [], createdAt: at }))];
  let saved: RepoSnapshot = base;
  const waiting: Array<() => void> = [];
  const ground = vi.fn(async () => {
    await new Promise<void>((resolve) => waiting.push(resolve));
    return { text: FINE, queries: [], citations: [{ title: 'News Example', url: NEWS }],
      grounding: { provider: 'google-search' as const, answerText: FINE, supports: [{ supportIndex: 0, text: FINE, sources: [{ chunkIndex: 0, url: NEWS, title: 'News Example' }] }] } };
  });
  const structure = vi.fn(async (_p: string, schema: ZodType<unknown>) => schema.parse({ lead: '', points: [{ text: FINE, sourceIndex: 1 }] }));
  const repo = new GeminiRepository({ apiKey: 'test', client: { ground, structure: structure as unknown as LlmClient['structure'] }, dashboardWarmup: false,
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  const releaseAll = async () => { while (waiting.length) { waiting.shift()!(); await new Promise((r) => setTimeout(r, 0)); } };
  return { repo, ground, releaseAll };
}

describe('brief build queue', () => {
  it('runs at most 2 builds at once and starts waiting ones as slots free up', async () => {
    const { repo, ground, releaseAll } = setup();
    const runs = ids.slice(0, 4).map((cardId) => repo.researchSignalBrief({ cardId }));
    await vi.waitFor(() => expect(ground).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(ground).toHaveBeenCalledTimes(2);
    await releaseAll();
    await Promise.all(runs);
    expect(ground).toHaveBeenCalledTimes(4);
  });

  it('drops a waiting build whose card was closed before its turn, without paying for it', async () => {
    const { repo, ground, releaseAll } = setup();
    const closed = new AbortController();
    const a = repo.researchSignalBrief({ cardId: 'v1' });
    const b = repo.researchSignalBrief({ cardId: 'v2' });
    const c = repo.researchSignalBrief({ cardId: 'v3', signal: closed.signal });
    const d = repo.researchSignalBrief({ cardId: 'v4' });
    await vi.waitFor(() => expect(ground).toHaveBeenCalledTimes(2));
    closed.abort();
    await expect(c).rejects.toThrow();
    await releaseAll();
    await Promise.all([a, b, d]);
    expect(ground).toHaveBeenCalledTimes(3);
    expect(await repo.peekSignalBrief('v3')).toBeNull();
  });

  it('does not start a build whose signal was already aborted', async () => {
    const { repo, ground } = setup();
    const closed = new AbortController();
    closed.abort();
    await expect(repo.researchSignalBrief({ cardId: 'v1', signal: closed.signal })).rejects.toThrow();
    expect(ground).not.toHaveBeenCalled();
  });
});
