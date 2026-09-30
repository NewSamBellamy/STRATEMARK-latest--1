import { describe, expect, it } from 'vitest';
import {
  GeminiRepository,
  migrateSnapshot,
  type RepoSnapshot,
  type ResearchStore,
} from './repository';
import type { LlmClient } from './types';

const unusedClient = {} as LlmClient;
const ownershipLost = {
  name: 'RepositoryOwnershipLostError',
  code: 'REPOSITORY_OWNERSHIP_LOST',
};

function emptySnapshot(): RepoSnapshot {
  return migrateSnapshot(null).snapshot;
}

function replacementSnapshot(): RepoSnapshot {
  return {
    ...emptySnapshot(),
    companyMarket: { replacement_company: 'Replacement snapshot' },
  };
}

function input(name: string) {
  return {
    name,
    scopeDefinition: { vertical: 'Synthetic', geography: null, notes: null },
    refreshCadence: 'daily' as const,
  };
}

function memory(initial: RepoSnapshot = emptySnapshot(), retainAliases = false) {
  let current: RepoSnapshot | null = retainAliases ? initial : structuredClone(initial);
  const writes: RepoSnapshot[] = [];
  const store: ResearchStore = {
    read: () => (current === null || retainAliases ? current : structuredClone(current)),
    write: (next) => {
      current = retainAliases ? next : structuredClone(next);
      writes.push(structuredClone(next));
    },
  };
  return {
    store,
    writes,
    read: () => (current === null ? null : structuredClone(current)),
    replace: (next: RepoSnapshot) => {
      current = structuredClone(next);
    },
  };
}

async function expectOwnershipLost(operation: () => unknown) {
  await expect(Promise.resolve().then(operation)).rejects.toMatchObject(ownershipLost);
}

describe('legacy repository write fence', () => {
  it('allows successive writes by the current owner', async () => {
    const data = memory();
    const repo = new GeminiRepository({ client: unusedClient, store: data.store });

    const market = await repo.createMarket(input('Synthetic market'));
    await repo.updateMarketCadence(market.id, market.refreshCadence);

    expect(data.writes).toHaveLength(2);
    expect(data.read()?.markets.map((saved) => saved.name)).toEqual(['Synthetic market']);
  });

  it('preserves a replacement and permanently rejects later writes from the stale owner', async () => {
    const data = memory();
    const repo = new GeminiRepository({ client: unusedClient, store: data.store });
    const replacement = replacementSnapshot();
    data.replace(replacement);

    await expectOwnershipLost(() => repo.createMarket(input('Stale write')));
    expect(data.read()).toEqual(replacement);
    expect(data.writes).toHaveLength(0);

    await expectOwnershipLost(() => repo.createMarket(input('Second stale write')));
    expect(data.read()).toEqual(replacement);
    expect(data.writes).toHaveLength(0);
  });

  it('does not advance its baseline when a persistence attempt fails', async () => {
    const initial = emptySnapshot();
    let current = structuredClone(initial);
    let failNextWrite = true;
    const writes: RepoSnapshot[] = [];
    const store: ResearchStore = {
      read: () => structuredClone(current),
      write: (next) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new Error('Synthetic disk failure');
        }
        current = structuredClone(next);
        writes.push(structuredClone(next));
      },
    };
    const repo = new GeminiRepository({ client: unusedClient, store });

    await expect(
      Promise.resolve().then(() => repo.createMarket(input('First attempt'))),
    ).rejects.toThrow('Synthetic disk failure');
    expect(current).toEqual(initial);

    await repo.createMarket(input('Retry'));
    expect(writes).toHaveLength(1);
    expect(current.markets.map((market) => market.name)).toEqual(['Retry', 'First attempt']);
  });

  it('fences a second repository owner after the first owner commits', async () => {
    const data = memory();
    const firstOwner = new GeminiRepository({ client: unusedClient, store: data.store });
    const secondOwner = new GeminiRepository({ client: unusedClient, store: data.store });

    await firstOwner.createMarket(input('First owner'));
    const committed = data.read();
    await expectOwnershipLost(() => secondOwner.createMarket(input('Second owner')));

    expect(data.read()).toEqual(committed);
    expect(data.writes).toHaveLength(1);
  });

  it('keeps owner state separate when a store returns and retains aliases', async () => {
    const data = memory(emptySnapshot(), true);
    const repo = new GeminiRepository({ client: unusedClient, store: data.store });

    const market = await repo.createMarket(input('Aliased store'));
    await repo.updateMarketCadence(market.id, market.refreshCadence);

    expect(data.writes).toHaveLength(2);
    expect(data.read()?.markets.map((saved) => saved.name)).toEqual(['Aliased store']);
  });

  it('compares JSON content independently of object key insertion order', async () => {
    let current = emptySnapshot();
    const store: ResearchStore = {
      read: () => current,
      // JSON field order is not a change of snapshot authority.
      write: (next) => {
        current = Object.fromEntries(Object.entries(next).reverse()) as RepoSnapshot;
      },
    };
    const repo = new GeminiRepository({ client: unusedClient, store });
    await repo.createMarket(input('After migration'));
    await repo.createMarket(input('Same content, different key order'));
    expect(current.markets).toHaveLength(2);
  });

  it('checks constructor migration writes against the startup snapshot', async () => {
    const legacy = { ...emptySnapshot(), schemaVersion: 1 };
    const replacement = replacementSnapshot();
    let reads = 0;
    const writes: RepoSnapshot[] = [];
    const store: ResearchStore = {
      read: () => (reads++ === 0 ? legacy : replacement),
      write: (next) => writes.push(structuredClone(next)),
    };

    await expectOwnershipLost(() => new GeminiRepository({ client: unusedClient, store }));
    expect(writes).toHaveLength(0);
    expect(replacement).toEqual(replacementSnapshot());
  });
});
