import { afterEach, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

function setup() {
  let saved = migrateSnapshot(null).snapshot;
  saved.companies.push({ id: 'cmp', name: 'Example', websiteUrl: 'https://example.com', oneLiner: 'Legacy',
    logoUrl: null, hqLocation: null, brandTheme: null });
  const store: ResearchStore = { read: () => structuredClone(saved), write: async value => { saved = structuredClone(value); } };
  const ground = vi.fn(); const structure = vi.fn();
  const repository = new GeminiRepository({ apiKey: 'test-placeholder', store, client: { ground, structure } as unknown as LlmClient });
  return { repository, store, ground, structure };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(['ground', 'structure'] as const)('aborts a hung %s after 90s and frees the flight for an explicit retry', async phase => {
  vi.useFakeTimers();
  const s = setup(); let signal: AbortSignal | undefined;
  if (phase === 'ground') s.ground.mockImplementation((_prompt, opts) => {
    signal = opts?.signal; return new Promise(() => undefined);
  });
  else {
    s.ground.mockResolvedValue({ text: 'Example history', citations: [{ url: 'https://example.com/history', title: 'History' }], queries: [] });
    s.structure.mockImplementation((_prompt, _schema, opts) => { signal = opts?.signal; return new Promise(() => undefined); });
  }
  let error: Error | undefined;
  void s.repository.getDashboardTab('cmp', 'history').catch(value => { error = value; });
  const joined = s.repository.getDashboardTab('cmp', 'history', true).catch(value => value);
  await vi.advanceTimersByTimeAsync(89999);
  expect(error).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  expect(error).toMatchObject({ name: 'TimeoutError', message: 'Dashboard research timed out after 90 seconds.' });
  expect(await joined).toMatchObject({ name: 'TimeoutError' });
  expect(signal?.aborted).toBe(true);
  expect(s.store.read()!.dashboards.cmp?.history).toBeUndefined();
  expect(s.ground).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  s.ground.mockResolvedValue({ text: 'Example history', citations: [{ url: 'https://example.com/history', title: 'History' }], queries: [] });
  s.structure.mockResolvedValue({ founderStory: 'Source-reported company story.', timeline: [], quotes: [] });
  expect((await s.repository.getDashboardTab('cmp', 'history'))?.content.founderStory).toContain('company story');
  expect(s.ground).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not let a late provider overwrite newer successful dashboard research', async () => {
  vi.useFakeTimers();
  const s = setup(); let finish!: (value: unknown) => void;
  s.ground.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let error: Error | undefined;
  void s.repository.getDashboardTab('cmp', 'history').catch(value => { error = value; });
  await vi.advanceTimersByTimeAsync(90000);
  expect(error?.name).toBe('TimeoutError');
  s.ground.mockResolvedValue({ text: 'Current', citations: [], queries: [] });
  s.structure.mockResolvedValue({ founderStory: 'Current story', timeline: [], quotes: [] });
  await s.repository.getDashboardTab('cmp', 'history');
  finish({ text: 'Stale', citations: [], queries: [] });
  await vi.advanceTimersByTimeAsync(1000);
  expect(s.structure).toHaveBeenCalledTimes(1);
  expect(s.store.read()!.dashboards.cmp!.history!.content).toHaveProperty('founderStory', 'Current story');
  expect(vi.getTimerCount()).toBe(0);
});
