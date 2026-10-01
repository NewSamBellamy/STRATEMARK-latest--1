import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { NativeResearchStart, CardWithCompany } from '@mi/contracts';
import type { LlmClient, CompanyCandidate } from '@mi/research';
import type * as Research from '@mi/research';
import { openVault } from './vault';
import { NativeResearchService } from './native-service';
import { resolveNativeWorkspaceMode } from './native-workspace-mode';

const { DatabaseSync } = createRequire(process.execPath)('node:sqlite') as typeof NodeSqlite;

const pipeline = vi.hoisted(() => ({ discover: vi.fn(), hydrate: vi.fn() }));
vi.mock('@mi/research', async (original) => ({
  ...(await original<typeof Research>()),
  discoverDeckStubs: pipeline.discover,
  hydrateCompanyCard: pipeline.hydrate,
}));
const roots: string[] = [];
const services: NativeResearchService[] = [];
const at = '2026-10-01T00:00:00.000Z';
const request: NativeResearchStart = {
  requestKey: 'native_fixture',
  scope: {
    goal: 'Test manufacturing market',
    inclusions: [],
    exclusions: [],
    region: null,
    depth: 'quick',
    seeds: [{ name: 'Alder' }],
  },
  maxCompanies: 2,
  limits: { maxRequests: 10, maxInputTokens: 100_000, maxOutputTokens: 10_000 },
};
const candidates: CompanyCandidate[] = ['Alder', 'Birch'].map((name) => ({
  name,
  domain: `${name.toLowerCase()}.example`,
  descriptor: 'Synthetic manufacturer',
  cardTypes: ['company'],
}));
const fixture = buildDataset();
const originalCard = fixture.cards.find((card) => card.cardType === 'company' && card.companyId)!;
function card(candidate: CompanyCandidate, deckId: string): CardWithCompany {
  const company = {
    ...fixture.companies.find((item) => item.id === originalCard.companyId)!,
    name: candidate.name,
  };
  return {
    card: { ...originalCard, deckId },
    company,
    metrics: fixture.metrics.filter((metric) => metric.companyId === company.id),
    viceClaims: [],
  };
}
function open(
  client: LlmClient | null = testClient(),
  notify: ConstructorParameters<typeof NativeResearchService>[2] = undefined,
  hydrationOptions: ConstructorParameters<typeof NativeResearchService>[3] = undefined,
) {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-native-service-'));
  roots.push(directory);
  const file = path.join(directory, 'vault.sqlite');
  const vault = openVault(file, 'fixture_native');
  const service = new NativeResearchService(vault, () => client, notify, {
    researchProvenance: 'synthetic_fixture',
    ...hydrationOptions,
  });
  services.push(service);
  return { service, file };
}
function testClient(): LlmClient {
  return {
    ground: vi.fn(async (_prompt, opts) => {
      const grant = opts!.usageMeter!.beginAttempt({
        kind: 'model',
        estimatedInputTokens: 50,
        maxOutputTokens: 100,
      });
      opts!.usageMeter!.settleAttempt(grant.id, { inputTokens: 30, outputTokens: 20 });
      return { text: 'Fixture research only', citations: [], queries: [] };
    }),
    structure: vi.fn(),
  };
}
beforeEach(() => {
  pipeline.discover.mockReset();
  pipeline.hydrate.mockReset();
  pipeline.discover.mockImplementation(async (_brief, client) => {
    await client.ground('Fixture discovery');
    return {
      candidates,
      cards: [],
      rejected: [],
      minimumCompaniesSatisfied: true,
      plan: {
        marketName: 'Ignored reinterpretation',
        vertical: 'Ignored',
        geography: null,
        notes: null,
        searchThemes: [],
      },
      market: {
        id: 'ignored',
        name: 'Ignored',
        scopeDefinition: { vertical: 'Ignored', geography: null, notes: null },
        refreshCadence: 'weekly',
        createdAt: at,
      },
      deck: { id: 'ignored', marketId: 'ignored', createdAt: at, lastRefreshedAt: null },
    };
  });
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
    await client.ground(`Fixture ${candidate.name}`);
    return { cards: [card(candidate, deckId)] };
  });
});
afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('accepts once, preserves the approved market, persists partial cards/events and reopens without a key', async () => {
  const client = testClient();
  const { service, file } = open(client);
  const first = service.start(request);
  expect(service.start(request).id).toBe(first.id);
  await service.waitForIdle();
  const run = service.vault.work.getRun(first.id)!;
  expect(run.status).toBe('completed');
  expect(run.usage.requests).toBe(3);
  expect(service.vault.work.getMarket(first.marketId)!.name).toBe(request.scope.goal);
  const cards = service.vault.work.listCards(first.deckId);
  expect(cards).toHaveLength(2);
  expect(
    cards.every(
      (entry) =>
        entry.card.tier === null &&
        entry.metrics.every(
          (metric) => metric.confidence !== 'verified' && metric.confidence !== 'user_verified',
        ),
    ),
  ).toBe(true);
  expect(service.vault.work.listEvents(first.id).length).toBeGreaterThan(2);
  await service.close();
  services.splice(services.indexOf(service), 1);
  const reader = openVault(file, 'fixture_native', 'reader');
  try {
    expect(reader.work.listCards(first.deckId)).toEqual(cards);
    expect(reader.work.getRun(first.id)!.status).toBe('completed');
  } finally {
    reader.close();
  }
  expect(client.ground).toHaveBeenCalledTimes(3);
});

it('keeps successful company work when another company fails and reports incomplete research', async () => {
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
    if (candidate.name === 'Birch') throw new Error('Fixture provider unavailable');
    await client.ground('Fixture company');
    return { cards: [card(candidate, deckId)] };
  });
  const { service } = open();
  const run = service.start(request);
  await service.waitForIdle();
  expect(service.vault.work.getRun(run.id)!.status).toBe('failed');
  expect(service.vault.work.listCards(run.deckId)).toHaveLength(1);
  expect(
    service.vault.work.listEvents(run.id).some((event) => event.progress.message.includes('Birch')),
  ).toBe(true);
});

it('fences late provider results after cancellation and keeps the accepted run', async () => {
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  pipeline.discover.mockImplementation(async () => {
    await barrier;
    return { candidates };
  });
  const { service } = open();
  const run = service.start(request);
  const cancelled = service.control(run.id, 'cancel');
  release();
  await service.waitForIdle();
  expect(cancelled.status).toBe('cancelled');
  expect(service.vault.work.getRun(run.id)!.status).toBe('cancelled');
  expect(service.vault.work.listCards(run.deckId)).toEqual([]);
  expect(pipeline.hydrate).not.toHaveBeenCalled();
});

it('rejects missing connections before acceptance and conflicting retries without changing scope', async () => {
  const noKey = open(null);
  expect(() => noKey.service.start(request)).toThrow(/connect/i);
  expect(noKey.service.vault.work.listRuns()).toEqual([]);
  const { service } = open();
  const run = service.start(request);
  expect(() =>
    service.start({ ...request, scope: { ...request.scope, goal: 'Different market' } }),
  ).toThrow(/different scope/i);
  await service.waitForIdle();
  expect(service.vault.work.getMarket(run.marketId)!.name).toBe(request.scope.goal);
});

it.each([false, true])(
  'retries the original unfinished candidate without rediscovery (reopen=%s)',
  async (reopen) => {
    let failBirch = true;
    pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
      await client.ground(`Fixture ${candidate.name}`);
      if (candidate.name === 'Birch' && failBirch) throw new Error('Fixture Birch unavailable');
      return { cards: [card(candidate, deckId)] };
    });
    const client = testClient();
    const opened = open(client);
    let service = opened.service;
    const first = service.start(request);
    await service.waitForIdle();
    const failed = service.vault.work.getRun(first.id)!;
    expect(failed.status).toBe('failed');
    expect(failed.tasks?.map((task) => [task.candidate.name, task.status, task.attempts])).toEqual([
      ['Alder', 'completed', 1],
      ['Birch', 'failed', 1],
    ]);
    const alder = service.vault.work.listCards(first.deckId)[0]!;
    const charged = failed.usage;
    expect(charged.requests).toBe(3);
    pipeline.discover.mockResolvedValue({
      candidates: [candidates[0], { ...candidates[1], name: 'Cedar', domain: 'cedar.example' }],
    });
    failBirch = false;
    if (reopen) {
      // Simulate a restart after accepting retry but before dispatching its tasks.
      service.vault
        .writer()
        .work.updateRun(
          { ...failed, status: 'running', generation: failed.generation + 1 },
          failed.generation,
        );
      await service.close();
      services.splice(services.indexOf(service), 1);
      service = new NativeResearchService(
        openVault(opened.file, 'fixture_native'),
        () => client,
        undefined,
        { researchProvenance: 'synthetic_fixture' },
      );
      services.push(service);
      expect(service.vault.work.getRun(first.id)?.tasks).toEqual(failed.tasks);
      expect(service.vault.work.getRun(first.id)?.status).toBe('paused');
    }
    service.control(first.id, 'resume');
    await service.waitForIdle();
    const completed = service.vault.work.getRun(first.id)!;
    expect(completed.status).toBe('completed');
    expect(
      completed.tasks?.map((task) => [task.candidate.name, task.status, task.attempts]),
    ).toEqual([
      ['Alder', 'completed', 1],
      ['Birch', 'completed', 2],
    ]);
    expect(completed.usage).toEqual({
      requests: 4,
      inputTokens: charged.inputTokens + 30,
      outputTokens: charged.outputTokens + 20,
      complete: true,
    });
    expect(completed.limits).toEqual(request.limits);
    expect(pipeline.discover).toHaveBeenCalledTimes(1);
    expect(pipeline.hydrate.mock.calls.map(([input]) => input.candidate.name)).toEqual([
      'Alder',
      'Birch',
      'Birch',
    ]);
    expect(service.vault.work.getCard(alder.card.id)).toEqual(alder);
    expect(
      service.vault.work
        .listCards(first.deckId)
        .map((entry) => entry.company?.name)
        .sort(),
    ).toEqual(['Alder', 'Birch']);
  },
);

it('retains selected running tasks and completed outputs through pause, delayed abort and close', async () => {
  let release!: () => void;
  let saved!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  const partial = new Promise<void>((resolve) => {
    saved = resolve;
  });
  let attempts = 0;
  let pendingSignal: AbortSignal | undefined;
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId, signal }) => {
    await client.ground(`Fixture ${candidate.name}`);
    if (candidate.name === 'Birch' && ++attempts === 1) {
      pendingSignal = signal;
      await delayed;
    }
    return { cards: [card(candidate, deckId)] };
  });
  const client = testClient();
  const { service, file } = open(client, (run) => {
    if (run.tasks?.some((task) => task.candidate.name === 'Alder' && task.status === 'completed'))
      saved();
  });
  const first = service.start(request);
  await partial;
  const paused = service.control(first.id, 'pause');
  const revision = service.vault.status().revision;
  expect(service.control(first.id, 'pause')).toEqual(paused);
  expect(service.vault.status().revision).toBe(revision);
  expect(pendingSignal?.aborted).toBe(true);
  const closing = service.close();
  expect(service.close()).toBe(closing);
  release();
  await closing;
  expect(() => service.vault.status()).toThrow(/closed/i);
  services.splice(services.indexOf(service), 1);
  const restarted = new NativeResearchService(
    openVault(file, 'fixture_native'),
    () => client,
    undefined,
    { researchProvenance: 'synthetic_fixture' },
  );
  services.push(restarted);
  expect(restarted.vault.work.getRun(first.id)?.tasks).toEqual(paused.tasks);
  expect(restarted.vault.work.listCards(first.deckId)).toHaveLength(1);
  pipeline.discover.mockRejectedValue(new Error('Rediscovery must not occur'));
  restarted.control(first.id, 'resume');
  await restarted.waitForIdle();
  expect(restarted.vault.work.getRun(first.id)?.status).toBe('completed');
  expect(pipeline.discover).toHaveBeenCalledTimes(1);
  expect(pipeline.hydrate.mock.calls.map(([input]) => input.candidate.name)).toEqual([
    'Alder',
    'Birch',
    'Birch',
  ]);
  expect(restarted.vault.work.getRun(first.id)?.usage.requests).toBe(4);
});

it('persists hydration citations as unverified source leads and passes the trusted fixture fetch', async () => {
  const lead = {
    title: 'Fixture annual report',
    url: 'https://fixture.example/report',
    credibility: 'primary' as const,
  };
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
    await client.ground(`Fixture ${candidate.name}`);
    return {
      cards: [
        { ...card(candidate, deckId), card: { ...card(candidate, deckId).card, citations: [] } },
      ],
      citations: [lead, lead],
    };
  });
  const fixtureFetch: typeof fetch = vi.fn(async () => new Response(null, { status: 404 }));
  const { service, file } = open(testClient(), undefined, { fetchImpl: fixtureFetch });
  const run = service.start(request);
  await service.waitForIdle();
  const leads = [{ ...lead, credibility: 'unknown' }];
  expect(service.vault.work.getRun(run.id)?.status).toBe('completed');
  for (const entry of service.vault.work.listCards(run.deckId))
    expect(entry.card.citations).toEqual(leads);
  expect(pipeline.hydrate.mock.calls.every(([input]) => input.fetchImpl === fixtureFetch)).toBe(
    true,
  );
  await service.close();
  services.splice(services.indexOf(service), 1);
  const reader = openVault(file, 'fixture_native', 'reader');
  try {
    expect(
      reader.work
        .listCards(run.deckId)
        .every((entry) => entry.card.citations[0]?.credibility === 'unknown'),
    ).toBe(true);
  } finally {
    reader.close();
  }
});

it('releases the vault even when a pause notification fails during shutdown', async () => {
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  pipeline.discover.mockImplementation(async () => {
    await delayed;
    return { candidates };
  });
  const { service, file } = open(testClient(), (run) => {
    if (run.status === 'paused') throw new Error('Fixture pause notification failed');
  });
  const run = service.start(request);
  const closing = service.close();
  const rejection = expect(closing).rejects.toThrow(/pause notification failed/i);
  release();
  await rejection;
  services.splice(services.indexOf(service), 1);
  const owner = openVault(file, 'fixture_native');
  try {
    expect(owner.work.getRun(run.id)?.status).toBe('paused');
  } finally {
    owner.close();
  }
});

it.each(['synthetic_fixture', 'live_provider'] as const)(
  'persists %s origin and rejects the opposite service mode before provider access',
  async (researchProvenance) => {
    pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
      await client.ground(`Fixture ${candidate.name}`);
      if (candidate.name === 'Birch') throw new Error('Incomplete fixture task');
      return { cards: [card(candidate, deckId)] };
    });
    const { service, file } = open(testClient(), undefined, { researchProvenance });
    const first = service.start(request);
    await service.waitForIdle();
    const retained = service.vault.work.getRun(first.id)!;
    expect(retained.researchProvenance).toBe(researchProvenance);
    expect(retained.status).toBe('failed');
    const revision = service.vault.status().revision;
    await service.close();
    services.splice(services.indexOf(service), 1);
    const connection = vi.fn(() => testClient());
    const opposite =
      researchProvenance === 'synthetic_fixture' ? 'live_provider' : 'synthetic_fixture';
    const wrongMode = new NativeResearchService(
      openVault(file, 'fixture_native'),
      connection,
      undefined,
      { researchProvenance: opposite },
    );
    services.push(wrongMode);
    expect(() => wrongMode.control(first.id, 'resume')).toThrow(/provenance/i);
    expect(() => wrongMode.start({ ...request, requestKey: 'new_request' })).toThrow(/provenance/i);
    expect(connection).not.toHaveBeenCalled();
    expect(wrongMode.vault.work.getRun(first.id)).toEqual(retained);
    expect(wrongMode.vault.work.listCards(first.deckId)).toHaveLength(1);
    expect(wrongMode.vault.status().revision).toBe(revision);
  },
);

it('reopens saved fixture research without the flag or a key while preserving its synthetic label', async () => {
  const { service, file } = open();
  const run = service.start(request);
  await service.waitForIdle();
  const cards = service.vault.work.listCards(run.deckId);
  await service.close();
  services.splice(services.indexOf(service), 1);
  const vault = openVault(file, 'fixture_native', 'reader');
  const mode = resolveNativeWorkspaceMode(vault.work.listRuns(), false);
  expect(mode).toEqual({ provenance: 'synthetic_fixture', writable: false });
  const connection = vi.fn(() => null);
  const reading = new NativeResearchService(vault, connection, undefined, {
    researchProvenance: 'synthetic_fixture',
    writable: mode.writable,
  });
  services.push(reading);
  expect(reading.vault.work.listCards(run.deckId)).toEqual(cards);
  expect(reading.vault.work.getRun(run.id)?.researchProvenance).toBe('synthetic_fixture');
  expect(() => reading.start(request)).toThrow(/read-only/i);
  expect(() => reading.control(run.id, 'resume')).toThrow(/read-only/i);
  expect(connection).not.toHaveBeenCalled();
});

it('forbids dispatch when writable is false, including an empty workspace', () => {
  const client = testClient();
  const { service } = open(client, undefined, {
    researchProvenance: 'live_provider',
    writable: false,
  });
  expect(() => service.start(request)).toThrow(/read-only/i);
  expect(client.ground).not.toHaveBeenCalled();
  expect(pipeline.discover).not.toHaveBeenCalled();
  expect(service.vault.work.listRuns()).toEqual([]);
  expect(service.vault.status().revision).toBe(0);
});

it('defaults new research to live_provider and rechecks the whole workspace before starting', async () => {
  const { service, file } = open(testClient(), undefined, { researchProvenance: 'live_provider' });
  const first = service.start(request);
  await service.waitForIdle();
  await service.close();
  services.splice(services.indexOf(service), 1);
  const connection = vi.fn(() => testClient());
  const defaultMode = new NativeResearchService(openVault(file, 'fixture_native'), connection);
  services.push(defaultMode);
  const next = defaultMode.start({ ...request, requestKey: 'default_mode_request' });
  await defaultMode.waitForIdle();
  expect(defaultMode.vault.work.getRun(next.id)?.researchProvenance).toBe('live_provider');
  const work = defaultMode.vault.writer().work;
  const market = { ...defaultMode.vault.work.getMarket(first.marketId)!, id: 'synthetic_market' };
  const deck = {
    ...defaultMode.vault.work.getDeckByMarket(first.marketId)!,
    id: 'synthetic_deck',
    marketId: market.id,
  };
  work.acceptRun(
    {
      ...defaultMode.vault.work.getRun(first.id)!,
      id: 'synthetic_run',
      marketId: market.id,
      deckId: deck.id,
      requestKey: 'synthetic_request',
      researchProvenance: 'synthetic_fixture',
      status: 'queued',
      tasks: undefined,
      usage: { requests: 0, inputTokens: 0, outputTokens: 0, complete: false },
    },
    market,
    deck,
  );
  connection.mockClear();
  expect(() => defaultMode.start({ ...request, requestKey: 'mixed_workspace_request' })).toThrow(
    /provenance/i,
  );
  expect(() => defaultMode.control(next.id, 'resume')).toThrow(/provenance/i);
  expect(connection).not.toHaveBeenCalled();
});

it('keeps older untagged saved research readable without resuming or relabelling it', async () => {
  const { service, file } = open();
  const first = service.start(request);
  await service.waitForIdle();
  const cards = service.vault.work.listCards(first.deckId);
  const stored = service.vault.work.getRun(first.id)!;
  const { researchProvenance: _provenance, ...old } = stored;
  const legacy = { ...old, status: 'paused' as const, generation: old.generation + 1 };
  await service.close();
  services.splice(services.indexOf(service), 1);
  const db = new DatabaseSync(file);
  try {
    db.prepare('UPDATE work_runs SET body=?,status=?,generation=? WHERE id=?').run(
      JSON.stringify(legacy),
      legacy.status,
      legacy.generation,
      legacy.id,
    );
  } finally {
    db.close();
  }
  const vault = openVault(file, 'fixture_native');
  const revision = vault.status().revision;
  expect(resolveNativeWorkspaceMode(vault.work.listRuns(), false)).toEqual({
    provenance: 'unclassified',
    writable: false,
  });
  const connection = vi.fn(() => testClient());
  const reading = new NativeResearchService(vault, connection);
  services.push(reading);
  expect(reading.vault.work.listCards(first.deckId)).toEqual(cards);
  expect(() => reading.control(first.id, 'resume')).toThrow(/provenance/i);
  expect(() => reading.control(first.id, 'cancel')).toThrow(/provenance/i);
  expect(() => reading.start({ ...request, requestKey: 'legacy_resume' })).toThrow(/provenance/i);
  expect(reading.vault.work.getRun(first.id)).toEqual(legacy);
  expect(reading.vault.status().revision).toBe(revision);
  expect(connection).not.toHaveBeenCalled();
});
