/**
 * A company the person confirmed from a link joins an existing deck through the
 * same expandDeck path a hunt uses, without any discovery search, and never twice.
 * Fakes only.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));

function setup() {
  const prompts: string[] = [];
  const client: LlmClient = {
    ground: vi.fn(async (prompt: string) => {
      prompts.push(prompt);
      return { text: 'Sunrun is a residential solar company.', queries: [], citations: [{ title: 'Sunrun', url: 'https://www.sunrun.com/' }] };
    }),
    structure: vi.fn(async (_prompt: string, schema: ZodType<unknown>) => schema.parse({ companies: [], metrics: {}, facts: {} })) as unknown as LlmClient['structure'],
  };
  let saved = migrateSnapshot(null).snapshot;
  const repo = new GeminiRepository({
    apiKey: 'test-placeholder', client,
    store: { read: () => structuredClone(saved), write: async (next: RepoSnapshot) => { saved = structuredClone(next); } },
  });
  return { repo, client, prompts };
}

describe('expandDeck with a named company', () => {
  it('adds that company without a discovery search, and not again once it is in the deck', async () => {
    const { repo, prompts } = setup();
    const market = await repo.createMarket({ name: 'Residential solar', scopeDefinition: { vertical: 'Solar', geography: null, notes: null }, refreshCadence: 'weekly' });
    const focus = { company: { name: 'Sunrun', domain: 'https://www.sunrun.com/', descriptor: 'Residential solar' } };
    const first = await repo.expandDeck(market.id, focus);
    expect(first.added).toBe(1);
    // No "find companies" search ran: every grounded prompt is about Sunrun itself.
    expect(prompts.some((p) => /REAL operating companies/.test(p))).toBe(false);
    const deck = (await repo.getDeckByMarket(market.id))!;
    const rows = await repo.listCards(deck.id);
    expect(rows.map((r) => r.company?.name)).toContain('Sunrun');

    const again = await repo.expandDeck(market.id, focus);
    expect(again.added).toBe(0);
    expect((await repo.listCards(deck.id)).filter((r) => r.company?.name === 'Sunrun')).toHaveLength(rows.filter((r) => r.company?.name === 'Sunrun').length);
  });

  it('exposes the link reader, which refuses a private address and saves nothing', async () => {
    const { repo, client } = setup();
    const out = await repo.identifyCompanyFromLink({ url: 'http://192.168.0.1/admin' });
    expect(out).toMatchObject({ status: 'unidentified', kind: null });
    expect(client.ground).not.toHaveBeenCalled();
    expect(await repo.listMarkets()).toEqual([]);
  });
});
