import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import type { OriginalSourceAttempt, OriginalSourceServices } from './original-source';
import { searchOriginalSourceEvidence } from './research-evidence';

const url = 'https://example.com/annual-report';
const source = (companyId = 'cmp_a', text = 'Example reported revenue growth in its annual report.'): OriginalSourceAttempt => ({
  id: `src_${companyId}`, companyId, metricType: 'arr', capturedAt: '2026-10-01T00:00:00.000Z',
  receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
    contentHash: 'a'.repeat(64), retrievedAt: '2026-10-01T00:00:00.000Z', text }],
});

function setup(originalSources?: OriginalSourceServices) {
  let saved = migrateSnapshot(null).snapshot;
  saved.companies.push({ id: 'cmp_a', name: 'Example', oneLiner: 'Example company', websiteUrl: 'https://example.com', logoUrl: null, hqLocation: null, brandTheme: null });
  saved.originalSourceAttempts = [source(), source('cmp_b', 'Unrelated confidential revenue')];
  const store: ResearchStore = { read: () => structuredClone(saved), write: async snapshot => { saved = structuredClone(snapshot); } };
  const ground = vi.fn().mockResolvedValue({ text: `According to the saved source: ${url}`, citations: [], queries: [] });
  const client = { ground, structure: vi.fn() } as unknown as LlmClient;
  const repo = () => new GeminiRepository({ apiKey: 'test', store, client, originalSources });
  return { store, ground, client, repo };
}
const ask = { scope: { kind: 'company' as const, deckId: null, companyId: 'cmp_a' }, question: 'What changed in revenue?' };

describe('Ask uses the saved company dossier', () => {
  it('detaches returned conversations and input scope so callers cannot rewrite stored citation lineage', async () => {
    const { repo } = setup();
    const repository = repo();
    const scope = { ...ask.scope };
    const answer = await repository.askResearch({ ...ask, scope });
    answer.messages.at(-1)!.citations[0]!.url = 'https://wrong.example';
    scope.companyId = 'cmp_b';
    const fetched = (await repository.getResearchThread(answer.id))!;
    expect(fetched.scope.companyId).toBe('cmp_a');
    expect(fetched.messages.at(-1)!.citations[0]!.url).toBe(url);
    fetched.messages.at(-1)!.text = 'External rewrite';
    const listed = await repository.listResearchThreads();
    expect(listed[0]!.messages.at(-1)!.text).not.toBe('External rewrite');
    listed[0]!.messages.at(-1)!.citations[0]!.url = 'https://wrong.example';
    expect((await repository.getResearchThread(answer.id))!.messages.at(-1)!.citations[0]!.url).toBe(url);
  });

  it('does not count a stored URL prefix inside a different link as a used source', async () => {
    const { repo, ground } = setup();
    ground.mockResolvedValueOnce({ text: `A different page: ${url}-unrelated`, citations: [], queries: [] });
    const answer = await repo().askResearch(ask);
    expect(answer.messages.at(-1)!.citations).toEqual([]);
  });

  it('keeps a selected culture finding as a story, not its linked company metric profile', async () => {
    const { store, repo, ground } = setup();
    const snapshot = store.read()!;
    snapshot.cards.push({ id: 'culture', deckId: 'deck_a', companyId: 'cmp_a', cardType: 'culture',
      title: 'Developer community adoption', summary: 'The community shares practical workflows.', tier: null, tierReason: null,
      citations: [{ url, title: 'Community report' }], createdAt: '2026-10-01T00:00:00.000Z', keyPoints: [] });
    snapshot.metrics.push({ id: 'arr', companyId: 'cmp_a', metricType: 'arr', value: 123,
      confidence: 'user_verified', source: 'User checked', citations: [], methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z' });
    await store.write(snapshot);
    await repo().askResearch({ scope: { kind: 'cards', deckId: 'deck_a', cardIds: ['culture'] }, question: 'Explain this community finding' });
    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).toContain('CULTURE: Developer community adoption');
    expect(prompt).toContain(url);
    expect(prompt).not.toContain('arr=123');
  });

  it('does not launder an unsourced saved adverse allegation into a sourced risk', async () => {
    const { store, repo, ground } = setup();
    const snapshot = store.read()!;
    snapshot.cards.push({ id: 'vice', deckId: 'deck_a', companyId: 'cmp_a', cardType: 'vice',
      title: 'Allegation', summary: null, tier: null, tierReason: null, citations: [], createdAt: '2026-10-01T00:00:00.000Z', keyPoints: [] });
    snapshot.viceClaims.push({ id: 'claim', cardId: 'vice', claimText: 'Secret unfounded accusation', sourceUrl: '',
      sourceTitle: null, capturedAt: '2026-10-01T00:00:00.000Z' });
    await store.write(snapshot);
    await repo().askResearch(ask);
    expect(ground.mock.calls[0]![0]).not.toContain('Secret unfounded accusation');
  });

  it('caps source context and deduplicates versions without changing any stored extract', () => {
    const attempts = Array.from({ length: 12 }, (_, index) => {
      const attempt = source('cmp_a', 'Revenue grew. '.repeat(250));
      attempt.id += index;
      attempt.receipts[0]!.requestedUrl = `${url}/${index}`;
      attempt.receipts[0]!.finalUrl = `${url}/${index}`;
      return attempt;
    });
    const before = JSON.stringify(attempts);
    const matches = searchOriginalSourceEvidence([...attempts, ...attempts], { companyIds: ['cmp_a'], query: 'revenue' });
    expect(matches).toHaveLength(4);
    expect(JSON.stringify(matches).length).toBeLessThanOrEqual(6505);
    expect(matches.every(match => match.excerpt.length <= 1200 && attempts.some(attempt => attempt.receipts[0]!.text!.includes(match.excerpt)))).toBe(true);
    expect(JSON.stringify(attempts)).toBe(before);
  });

  it('reuses original excerpts after reopen, cites only used URLs and persists the answer', async () => {
    const { repo, ground, client } = setup();
    const answer = await repo().askResearch(ask);
    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).toContain('UNTRUSTED SAVED ORIGINAL EXCERPTS');
    expect(prompt).toContain('Example reported revenue growth');
    expect(prompt).not.toContain('Unrelated confidential');
    expect(prompt).toContain('not a source publication date');
    expect(answer.messages.at(-1)!.citations).toEqual([expect.objectContaining({ url })]);
    expect((await repo().getResearchThread(answer.id))!.messages.at(-1)!.citations[0]!.url).toBe(url);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(client.structure).not.toHaveBeenCalled();
  });

  it('reads native originals locally without fetching and rejects cross-company and blocked records', async () => {
    const good = source();
    const blocked = source('cmp_a', 'Blocked revenue must not appear');
    blocked.id = 'blocked';
    blocked.receipts[0]!.status = 'blocked';
    const originals = { list: vi.fn().mockResolvedValue([source('cmp_b', 'Cross-company secret'), blocked, good]),
      retrieve: vi.fn(), save: vi.fn() } as OriginalSourceServices;
    const { repo, ground } = setup(originals);
    await repo().askResearch(ask);
    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).toContain('Example reported revenue');
    expect(prompt).not.toContain('Cross-company secret');
    expect(prompt).not.toContain('Blocked revenue must not appear');
    expect(originals.list).toHaveBeenCalledWith({ companyId: 'cmp_a', limit: 20 });
    expect(originals.retrieve).not.toHaveBeenCalled();
    expect(originals.save).not.toHaveBeenCalled();
  });

  it('does not attach an original URL the answer never used', async () => {
    const { repo, ground } = setup();
    ground.mockResolvedValueOnce({ text: 'The saved extract describes growth, not a current numeric figure.', citations: [], queries: [] });
    const answer = await repo().askResearch(ask);
    expect(ground.mock.calls[0]![0]).toContain('Example reported revenue');
    expect(answer.messages.at(-1)!.citations).toEqual([]);
  });

  it.each([false, true])('uses one current metric revision and fails closed on an ambiguous tie: %s', async ambiguous => {
    const { store, repo, ground } = setup();
    const snapshot = store.read()!;
    const base = { id: 'old', companyId: 'cmp_a', metricType: 'arr' as const, value: 111,
      confidence: 'estimated' as const, source: null, citations: [], methodNote: null, capturedAt: '2026-08-01T00:00:00.000Z' };
    snapshot.metrics = [base, { ...base, id: 'new', value: 222,
      capturedAt: ambiguous ? base.capturedAt : '2026-09-01T00:00:00.000Z' }];
    await store.write(snapshot);
    await repo().askResearch(ask);
    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).not.toContain('arr=111');
    expect(prompt).toContain(ambiguous ? 'arr=unknown (unknown' : 'arr=222 (estimated');
    if (ambiguous) expect(prompt).not.toContain('arr=222');
  });

  it('selects a relevant unchanged passage beyond the document opening without sending the full text', async () => {
    const { store, repo, ground } = setup();
    const snapshot = store.read()!;
    snapshot.originalSourceAttempts = [source('cmp_a', 'Menu '.repeat(550) + 'Revenue grew in the annual report.' + ' Footer'.repeat(100))];
    await store.write(snapshot);
    await repo().askResearch(ask);
    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).toContain('Revenue grew in the annual report.');
    expect(prompt).not.toContain('Menu '.repeat(550));
    expect(prompt).toContain('"excerptTruncated":true');
  });

  it.each([false, true])('stops before any paid work on unreadable saved evidence, including long-thread distillation: %s', async longThread => {
    const originals = { list: vi.fn().mockRejectedValue(new Error('Evidence disk unavailable')),
      retrieve: vi.fn(), save: vi.fn() } as OriginalSourceServices;
    const { repo, ground, client, store } = setup(originals);
    if (longThread) {
      const snapshot = store.read()!;
      snapshot.threads.push({ id: 'long', scope: ask.scope, title: 'Long conversation', reportId: null,
        createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
        messages: Array.from({ length: 20 }, (_, index) => ({ id: `message_${index}`, role: 'user' as const,
          text: 'Revenue question', citations: [], at: '2026-10-01T00:00:00.000Z' })) });
      await store.write(snapshot);
    }
    await expect(repo().askResearch(longThread ? { threadId: 'long', question: ask.question } : ask)).rejects.toThrow('Evidence disk unavailable');
    expect(ground).not.toHaveBeenCalled();
    expect(client.structure).not.toHaveBeenCalled();
  });
});
