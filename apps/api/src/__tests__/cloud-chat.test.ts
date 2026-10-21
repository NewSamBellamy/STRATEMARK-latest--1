import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardWithCompany, ResearchThread } from '@mi/contracts';
import { createApp } from '../app';
import { readEnv } from '../env';
import { CloudDeckService, MockFirebaseAdapter } from '../lib/CloudDeckService';
import { MemoryDataStore } from '../lib/firestoreStore';
import { resolveClient } from '../lib/client';
import { prepareCloudChat, cloudChatSchema } from '../lib/cloudChat';

vi.mock('../lib/client', async original => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...await original<typeof import('../lib/client')>(), resolveClient: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());

const sourceUrl = 'https://example.com/report';
const headers = { Authorization: 'Bearer valid_token', 'X-Stratemark-Token': 'app-token', 'Content-Type': 'application/json' };
const scope = { kind: 'company', deckId: 'deck_test', companyId: 'company_test' };
async function setup(cap = '10') {
  const store = new MemoryDataStore();
  const auth = new MockFirebaseAdapter();
  const service = new CloudDeckService(store, auth, auth);
  const env = readEnv({ GEMINI_API_KEY: 'test', APP_TOKEN: 'app-token', DAILY_CAP_USD: cap });
  const app = createApp(env, { store, cloudDeckService: service, forceMemoryStore: true });
  const ground = vi.fn().mockResolvedValue({ text: `Revenue grew: ${sourceUrl}`, citations: [], queries: [] });
  const structure = vi.fn();
  vi.mocked(resolveClient).mockReturnValue({ client: { ground, structure }, keySource: 'server' });
  await service.saveDeck('user_123', 'deck_test', {
    deck: { id: 'deck_test', marketId: 'deck_test' }, market: { id: 'deck_test', name: 'Test market' },
    cards: [{ card: { id: 'card_test', companyId: 'company_test', deckId: 'deck_test', cardType: 'company', tier: null, tierReason: null, title: 'Example', summary: '', keyPoints: [], citations: [], createdAt: '2026-10-01' },
      company: { id: 'company_test', name: 'Example', oneLiner: 'Example company', websiteUrl: 'https://example.com', logoUrl: null, hqLocation: null, brandTheme: null }, metrics: [], viceClaims: [] }] as CardWithCompany[],
    companySourceAttempts: [{ id: 'src_12345678-1234-1234-1234-123456789abc', companyId: 'company_test', metricType: 'company_profile', capturedAt: '2026-10-01T00:00:00.000Z',
      receipts: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-01T00:00:00.000Z', text: 'Example revenue grew in its annual report.' }] }],
  });
  const post = (body: unknown, requestHeaders: Record<string, string> = headers) => app.request('/api/research/chat', { method: 'POST', headers: requestHeaders, body: JSON.stringify(body) });
  return { app, store, service, env, post, ground, structure };
}

describe('cloud Ask journey and security boundary', () => {
  it('uses the shared repository without touching legacy global Firebase', async () => {
    const { store, ground, structure } = await setup();
    const chat = await prepareCloudChat(store, 'user_123', cloudChatSchema.parse({ scope, question: 'Revenue?' }));
    expect((await chat.answer({ ground, structure })).messages).toHaveLength(2);
  });
  it('rejects unauthenticated cloud chat before client resolution or paid work', async () => {
    const { post, ground } = await setup();
    const response = await post({ scope, question: 'Revenue?' }, { ...headers, Authorization: '' });
    expect(response.status).toBe(401);
    expect(resolveClient).not.toHaveBeenCalled();
    expect(ground).not.toHaveBeenCalled();
  });

  it('rejects a valid user reading another user deck before paid work', async () => {
    const { post, ground } = await setup();
    const response = await post({ scope, question: 'Revenue?' }, { ...headers, Authorization: 'Bearer valid_other_user' });
    expect(response.status).toBe(404);
    expect(ground).not.toHaveBeenCalled();
  });

  it.each([
    { scope, question: '' },
    { scope, question: 'x'.repeat(8001) },
    { scope: { ...scope, companyId: 'outside_company' }, question: 'Revenue?' },
    { scope: { kind: 'cards', deckId: 'deck_test', cardIds: ['outside_card'] }, question: 'Revenue?' },
    { scope, question: 'Revenue?', attachments: { reportIds: ['unsupported_report'] } },
  ])('rejects invalid or unavailable scope/attachments before research', async input => {
    const { post, ground } = await setup();
    expect((await post(input)).status).toBe(400);
    expect(ground).not.toHaveBeenCalled();
  });

  it('returns the app thread contract, retains originals/citations, and supports reopen/continue', async () => {
    const { post, app, ground, structure, env, store, service } = await setup();
    const response = await post({ scope, question: 'What changed in revenue?' });
    expect(response.status).toBe(200);
    const thread = await response.json() as ResearchThread;
    expect(thread.id).toMatch(/^thr_/);
    expect(thread.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(thread.messages[1]!.citations).toEqual([{ title: 'example.com', url: sourceUrl, credibility: 'unknown' }]);
    expect(ground.mock.calls[0]![0]).toContain('UNTRUSTED SAVED ORIGINAL EXCERPTS');
    expect(ground.mock.calls[0]![0]).toContain('Example revenue grew');
    expect(structure).not.toHaveBeenCalled();
    const reopened = createApp(env, { store, cloudDeckService: service, forceMemoryStore: true });
    const get = await reopened.request(`/api/research/threads/${thread.id}`, { headers });
    expect(await get.json()).toEqual(thread);
    const next = await post({ threadId: thread.id, question: 'What does that mean?' });
    expect(next.status).toBe(200);
    expect((await next.json() as ResearchThread).messages).toHaveLength(4);
    const list = await app.request('/api/research/threads?deckId=deck_test', { headers });
    expect((await list.json() as { threads: ResearchThread[] }).threads[0]!.messages).toHaveLength(4);
  });

  it('hides other users threads and rejects cross-deck scope changes', async () => {
    const { post, app, ground } = await setup();
    const first = await post({ scope, question: 'Revenue?' });
    expect(first.status).toBe(200);
    const thread = await first.json() as ResearchThread;
    const response = await post({ threadId: thread.id, question: 'Revenue?' }, { ...headers, Authorization: 'Bearer valid_other_user' });
    expect(response.status).toBe(404);
    expect((await app.request(`/api/research/threads/${thread.id}`, { headers: { ...headers, Authorization: 'Bearer valid_other_user' } })).status).toBe(404);
    expect((await post({ threadId: thread.id, scope: { ...scope, deckId: 'other' }, question: 'Revenue?' })).status).toBe(400);
    expect(ground).toHaveBeenCalledTimes(1);
  });

  it('checks the existing spend cap before any cloud answer', async () => {
    const { post, ground } = await setup('0.001');
    expect((await post({ scope, question: 'Revenue?' })).status).toBe(429);
    expect(ground).not.toHaveBeenCalled();
  });

  it('meters server answer calls so later questions cannot bypass the cap', async () => {
    const { post, ground, structure } = await setup('0.06');
    vi.mocked(resolveClient).mockImplementation(options => ({ keySource: 'server', client: {
      ground: async (...args) => { options.onCall?.({ model: 'test', kind: 'ground' }); return ground(...args); }, structure,
    } }));
    expect((await post({ scope, question: 'Revenue?' })).status).toBe(200);
    expect((await post({ scope, question: 'Another question' })).status).toBe(429);
    expect(ground).toHaveBeenCalledTimes(1);
  });

  it('requires spend authorization and never persists a caller key', async () => {
    const { post, store } = await setup();
    const { 'X-Stratemark-Token': _token, ...noSpend } = headers;
    expect((await post({ scope, question: 'Revenue?' }, noSpend)).status).toBe(401);
    expect(resolveClient).not.toHaveBeenCalled();
    expect((await post({ scope, question: 'Revenue?' }, { ...noSpend, 'X-Gemini-Key': 'caller-test-key' })).status).toBe(200);
    expect(resolveClient).toHaveBeenCalledWith(expect.objectContaining({ callerKey: 'caller-test-key' }));
    expect(JSON.stringify(await store.listResearchThreads('user_123'))).not.toContain('caller-test-key');
  });

  it('rejects expired cloud entitlement but preserves readable saved history', async () => {
    const { post, store, ground, app } = await setup();
    const record = (await store.getDeck('deck_test'))!;
    await store.saveDeck('deck_free', { ...record, userId: 'user_free', deck: { id: 'deck_free' }, market: { id: 'deck_free' } });
    await store.saveResearchThread('user_free', { id: 'thr_free', scope: { kind: 'deck', deckId: 'deck_free' }, title: 'Saved question', reportId: null,
      messages: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }, 0);
    expect((await post({ scope: { ...scope, deckId: 'deck_free' }, question: 'Revenue?' }, { ...headers, Authorization: 'Bearer valid_free_token' })).status).toBe(402);
    expect(ground).not.toHaveBeenCalled();
    expect((await app.request('/api/research/threads/thr_free', { headers: { ...headers, Authorization: 'Bearer valid_free_token' } })).status).toBe(200);
  });

  it('does not spend when the user question cannot be retained', async () => {
    const { post, ground, store } = await setup();
    vi.spyOn(store, 'saveResearchThread').mockRejectedValueOnce(new Error('Storage unavailable'));
    expect((await post({ scope, question: 'Revenue?' })).status).toBe(503);
    expect(ground).not.toHaveBeenCalled();
    expect(await store.listResearchThreads('user_123')).toEqual([]);
  });

  it('retains the question on model failure and never invents a successful answer', async () => {
    const { post, ground, store } = await setup();
    ground.mockRejectedValueOnce(new Error('Provider unavailable'));
    expect((await post({ scope, question: 'Revenue?' })).status).toBe(503);
    const saved = await store.listResearchThreads('user_123');
    expect(saved[0]!.thread.messages.map(message => message.role)).toEqual(['user']);
  });

  it('does not echo a provider or storage credential in failures', async () => {
    const { post, ground } = await setup();
    ground.mockRejectedValueOnce(new Error('Sensitive test credential must not appear'));
    const response = await post({ scope, question: 'Revenue?' });
    expect(await response.text()).not.toContain('Sensitive test credential');
  });

  it('does not attach another user conversation or a deleted deck conversation', async () => {
    const { post, app, ground, store } = await setup();
    const first = await post({ scope, question: 'Revenue?' });
    const thread = await first.json() as ResearchThread;
    await store.deleteDeck('deck_test');
    expect((await app.request(`/api/research/threads/${thread.id}`, { headers })).status).toBe(404);
    expect((await post({ threadId: thread.id, question: 'Revenue?' })).status).toBe(404);
    expect(ground).toHaveBeenCalledTimes(1);
  });

  it('discards a late answer instead of overwriting a newer conversation', async () => {
    const { post, ground, store } = await setup();
    const first = await post({ scope, question: 'Revenue?' });
    const thread = await first.json() as ResearchThread;
    let finish!: (value: { text: string; citations: never[]; queries: never[] }) => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => { started = resolve; });
    ground.mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const pending = post({ threadId: thread.id, question: 'Older slow question' });
    await waiting;
    expect((await post({ threadId: thread.id, question: 'Newer fast question' })).status).toBe(200);
    finish({ text: 'Older late answer', citations: [], queries: [] });
    expect((await pending).status).toBe(409);
    const saved = (await store.getResearchThread('user_123', thread.id))!;
    expect(saved.thread.messages.at(-1)!.text).toBe(`Revenue grew: ${sourceUrl}`);
    expect(saved.thread.messages.some(message => message.text === 'Older late answer')).toBe(false);
    expect(saved.thread.messages.filter(message => message.role === 'user')).toHaveLength(3);
  });
});
