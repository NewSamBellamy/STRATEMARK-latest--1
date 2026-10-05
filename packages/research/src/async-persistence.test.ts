import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import { recordResearchEvidence } from './research-evidence';
import type { LlmClient } from './types';

describe('durability before research publication', () => {
  it('does not complete a mutation before its asynchronous save commits', async () => {
    let commit!: () => void;
    const store = { read: () => null, write: vi.fn(() => new Promise<void>(resolve => { commit = resolve; })) } as ResearchStore;
    const repo = new GeminiRepository({ apiKey: 'test', store });
    let published = false;
    const mutation = repo.createMarket({ name: 'Studios' } as Parameters<GeminiRepository['createMarket']>[0]).then(() => { published = true; });
    await vi.waitFor(() => expect(commit).toBeTypeOf('function'));
    expect(published).toBe(false);
    commit();
    await mutation;
    expect(published).toBe(true);
  });

  it('propagates an asynchronous persistence failure instead of publishing success', async () => {
    const repo = new GeminiRepository({ apiKey: 'test', store: { read: () => migrateSnapshot(null).snapshot, write: async () => { throw new Error('Disk full'); } } as ResearchStore });
    await expect(repo.createMarket({ name: 'Studios' } as Parameters<GeminiRepository['createMarket']>[0])).rejects.toThrow('Disk full');
  });

  it('retains a scoped grounding response before returning it for synthesis', async () => {
    let commit!: () => void;
    const ground = vi.fn().mockResolvedValue({ text: 'Studio source', citations: [{ url: 'https://example.com', title: 'Official' }], queries: [] });
    const client = recordResearchEvidence({ ground, structure: vi.fn() } as unknown as LlmClient,
      () => new Promise<void>(resolve => { commit = resolve; }));
    let returned = false;
    const result = client.ground('question', { researchContext: { companyId: 'studio', topic: 'overview' } }).then(() => { returned = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(returned).toBe(false);
    commit();
    await result;
  });

  it('does not silently use a workspace whose startup migration failed to save', async () => {
    const legacy = { ...migrateSnapshot(null).snapshot, schemaVersion: 1 };
    const write = vi.fn(async () => { throw new Error('Migration save failed'); });
    const repo = new GeminiRepository({ apiKey: 'test', store: { read: () => legacy, write } });
    await expect(repo.ready()).rejects.toThrow('Migration save failed');
    await expect(repo.createMarket({ name: 'Studios' } as Parameters<GeminiRepository['createMarket']>[0])).rejects.toThrow('Migration save failed');
    expect(write).toHaveBeenCalledTimes(1);
  });
});
