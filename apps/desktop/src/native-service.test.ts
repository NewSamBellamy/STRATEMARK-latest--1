import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import type * as NodeSqlite from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { NativeResearchStart, CardWithCompany } from '@mi/contracts';
import { sourceVersionRecordSchema, evidencePassageRecordSchema } from '@mi/contracts';
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
function sourceCards(urls: string[], duplicateRole = false) {
  pipeline.discover.mockImplementation(async () => ({ candidates: [candidates[0]] }));
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
    await client.ground('Fixture company');
    const data = card(candidate, deckId);
    data.card.citations = urls.map((url, index) => ({
      title: `Source ${index}`,
      url,
      credibility: 'unknown',
    }));
    return {
      cards: duplicateRole
        ? [data, { ...data, card: { ...data.card, cardType: 'infrastructure' } }]
        : [data],
    };
  });
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

it('saves and unsaves cards keylessly in a live writable workspace without changing research', async () => {
  const { service, file } = open(testClient(), undefined, { researchProvenance: 'live_provider' });
  const run = service.start(request);
  await service.waitForIdle();
  const cards = service.vault.work.listCards(run.deckId);
  const retainedRun = service.vault.work.getRun(run.id);
  const events = service.vault.work.listEvents(run.id);
  await service.close();
  services.splice(services.indexOf(service), 1);
  const connection = vi.fn(() => null);
  const saving = new NativeResearchService(openVault(file, 'fixture_native'), connection);
  services.push(saving);
  const selected = cards[0]!;
  const saved = saving.saveCard(selected.card.id);
  expect(saved).toEqual({ cardId: selected.card.id, savedAt: expect.any(String) });
  expect(saving.vault.work.listSavedCards()).toEqual([selected]);
  const revision = saving.vault.status().revision;
  expect(saving.saveCard(selected.card.id)).toEqual(saved);
  expect(saving.vault.status().revision).toBe(revision);
  await saving.close();
  services.splice(services.indexOf(saving), 1);
  const reopened = new NativeResearchService(openVault(file, 'fixture_native'), connection);
  services.push(reopened);
  expect(reopened.vault.work.listSavedCards()).toEqual([selected]);
  expect(reopened.unsaveCard(selected.card.id)).toBeUndefined();
  expect(reopened.vault.work.listSavedCards()).toEqual([]);
  const unsavedRevision = reopened.vault.status().revision;
  reopened.unsaveCard(selected.card.id);
  expect(reopened.vault.status().revision).toBe(unsavedRevision);
  expect(reopened.vault.work.listCards(run.deckId)).toEqual(cards);
  expect(reopened.vault.work.getRun(run.id)).toEqual(retainedRun);
  expect(reopened.vault.work.listEvents(run.id)).toEqual(events);
  expect(connection).not.toHaveBeenCalled();
  expect(pipeline.discover).toHaveBeenCalledTimes(1);
  expect(pipeline.hydrate).toHaveBeenCalledTimes(2);
});

it.each(['read_only', 'wrong_provenance'] as const)(
  'blocks saving and unsaving in a %s workspace',
  async (mode) => {
    const { service, file } = open();
    const run = service.start(request);
    await service.waitForIdle();
    const selected = service.vault.work.listCards(run.deckId)[0]!;
    service.vault.writer().work.bookmarkCard(selected.card.id);
    const revision = service.vault.status().revision;
    await service.close();
    services.splice(services.indexOf(service), 1);
    const connection = vi.fn(() => null);
    const blocked = new NativeResearchService(
      openVault(file, 'fixture_native', mode === 'read_only' ? 'reader' : 'owner'),
      connection,
      undefined,
      {
        researchProvenance: mode === 'read_only' ? 'synthetic_fixture' : 'live_provider',
        writable: mode !== 'read_only',
      },
    );
    services.push(blocked);
    const reason = mode === 'read_only' ? /read-only/i : /provenance/i;
    expect(() => blocked.saveCard(selected.card.id)).toThrow(reason);
    expect(() => blocked.unsaveCard(selected.card.id)).toThrow(reason);
    expect(blocked.vault.work.listSavedCards()).toEqual([selected]);
    expect(blocked.vault.work.getCard(selected.card.id)).toEqual(selected);
    expect(blocked.vault.status().revision).toBe(revision);
    expect(connection).not.toHaveBeenCalled();
  },
);

it('rejects unknown cards for saving and unsaving without initializing a provider', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-native-bookmarks-'));
  roots.push(directory);
  const connection = vi.fn(() => null);
  const service = new NativeResearchService(
    openVault(path.join(directory, 'vault.sqlite'), 'fixture_native'),
    connection,
  );
  services.push(service);
  const revision = service.vault.status().revision;
  expect(() => service.saveCard('crd_unknown')).toThrow(/not found/i);
  expect(() => service.unsaveCard('crd_unknown')).toThrow(/not found/i);
  expect(service.vault.work.listSavedCards()).toEqual([]);
  expect(service.vault.status().revision).toBe(revision);
  expect(connection).not.toHaveBeenCalled();
  expect(pipeline.discover).not.toHaveBeenCalled();
  expect(pipeline.hydrate).not.toHaveBeenCalled();
});

it('retains bounded source text after progressive cards and reads it after a keyless reopen', async () => {
  const url = 'https://sources.example/alder';
  pipeline.discover.mockImplementation(async () => ({ candidates: [candidates[0]] }));
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
    await client.ground('Fixture company');
    const data = card(candidate, deckId);
    data.card.citations = [{ title: 'Alder source', url, credibility: 'unknown' }];
    return { cards: [data] };
  });
  const retrieveSource = vi.fn(
    async (
      originalUrl: string,
      options: {
        signal: AbortSignal;
        beforeRequest?: () => void;
      },
    ) => {
      expect(service.vault.work.listCards(service.vault.work.listRuns()[0]!.deckId)).toHaveLength(
        1,
      );
      options.beforeRequest!();
      expect(service.vault.work.listRuns()[0]!.usage.sourceRequests).toBe(1);
      return {
        originalUrl,
        canonicalUrl: originalUrl,
        text: 'Retained fixture text, not a verified claim.',
        retrievalStatus: 'retrieved' as const,
        reason: null,
      };
    },
  );
  const opened = open(testClient(), undefined, { retrieveSource });
  const service = opened.service;
  const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 2 } });
  await service.waitForIdle();
  expect(retrieveSource).toHaveBeenCalledTimes(1);
  const saved = service.vault.work.listCards(run.deckId)[0]!;
  const evidence = service.getCardEvidence(saved.card.id);
  expect(evidence.sources).toEqual([
    expect.objectContaining({
      url,
      retrievalStatus: 'retrieved',
      text: 'Retained fixture text, not a verified claim.',
      fetchedAt: expect.any(String),
      sourceId: expect.any(String),
      sourceRevision: 1,
      passageId: expect.any(String),
      support: 'unreviewed',
    }),
  ]);
  const source = service.vault.getSourceVersion(evidence.sources[0]!.sourceId!, 1)!;
  expect(source.record.visibilityScope).toEqual({ marketIds: [run.marketId], companyIds: [] });
  await service.close();
  services.splice(services.indexOf(service), 1);
  const connection = vi.fn(() => null);
  const reader = new NativeResearchService(
    openVault(opened.file, 'fixture_native', 'reader'),
    connection,
    undefined,
    { researchProvenance: 'synthetic_fixture', writable: false, retrieveSource },
  );
  services.push(reader);
  expect(reader.getCardEvidence(saved.card.id)).toEqual(evidence);
  expect(connection).not.toHaveBeenCalled();
  expect(retrieveSource).toHaveBeenCalledTimes(1);
});

it('captures only two unique public leads across role duplicates and bounds retained excerpts', async () => {
  const urls = [
    'file:///not-public',
    'https://user:secret@sources.example/private',
    'https://sources.example/one',
    'https://sources.example/one',
    'https://sources.example/two',
    'https://sources.example/three',
  ];
  sourceCards(urls, true);
  const text = `${'x'.repeat(19_999)}😀 beyond the excerpt`;
  const retrieveSource = vi.fn(
    async (originalUrl: string, options: { beforeRequest?: () => void }) => {
      options.beforeRequest!();
      return {
        originalUrl,
        canonicalUrl: originalUrl,
        text,
        retrievalStatus: 'retrieved' as const,
        reason: null,
      };
    },
  );
  const { service } = open(testClient(), undefined, { retrieveSource });
  const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 10 } });
  await service.waitForIdle();
  expect(retrieveSource.mock.calls.map(([url]) => url)).toEqual(
    urls
      .slice(2)
      .filter((url, i, all) => all.indexOf(url) === i)
      .slice(0, 2),
  );
  expect(service.vault.work.getRun(run.id)?.usage.sourceRequests).toBe(2);
  const cards = service.vault.work.listCards(run.deckId);
  expect(cards).toHaveLength(2);
  const sources = cards.map((entry) => service.getCardEvidence(entry.card.id).sources);
  for (const evidence of sources) {
    expect(evidence.map((item) => item.retrievalStatus)).toEqual([
      'partial',
      'partial',
      'lead_only',
    ]);
    for (const retained of evidence.slice(0, 2)) {
      expect(retained.text).toBe('x'.repeat(19_999));
      expect(service.vault.getSourceVersion(retained.sourceId!, 1)!.content).toBe(retained.text);
    }
  }
  expect(sources[0]![0]!.sourceId).not.toBe(sources[1]![0]!.sourceId);
  expect(
    cards.every((entry) =>
      entry.metrics.every(
        (metric) => metric.confidence === 'estimated' || metric.confidence === 'unknown',
      ),
    ),
  ).toBe(true);
});

it.each(['failed', 'blocked', 'throws'] as const)(
  'keeps successful cards when source retrieval %s',
  async (outcome) => {
    sourceCards(['https://sources.example/unavailable']);
    const retrieveSource = vi.fn(
      async (originalUrl: string, options: { beforeRequest?: () => void }) => {
        options.beforeRequest!();
        if (outcome === 'throws') throw new Error('Fixture retrieval failure');
        return {
          originalUrl,
          canonicalUrl: originalUrl,
          text: null,
          retrievalStatus: outcome,
          reason: 'Fixture unavailable',
        };
      },
    );
    const { service } = open(testClient(), undefined, { retrieveSource });
    const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 2 } });
    await service.waitForIdle();
    expect(service.vault.work.getRun(run.id)).toMatchObject({
      status: 'completed',
      usage: { sourceRequests: 1 },
    });
    const saved = service.vault.work.listCards(run.deckId);
    expect(saved).toHaveLength(1);
    expect(service.getCardEvidence(saved[0]!.card.id).sources[0]).toMatchObject({
      retrievalStatus: outcome === 'throws' ? 'failed' : outcome,
      fetchedAt: expect.any(String),
      text: null,
      passageId: null,
      support: 'unreviewed',
    });
  },
);

it.each([undefined, 0])(
  'never calls retrieval without an explicit positive source allowance (%s)',
  async (maxSourceRequests) => {
    sourceCards(['https://sources.example/lead']);
    const retrieveSource = vi.fn();
    const { service } = open(testClient(), undefined, { retrieveSource });
    const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests } });
    await service.waitForIdle();
    expect(retrieveSource).not.toHaveBeenCalled();
    const saved = service.vault.work.listCards(run.deckId)[0]!;
    expect(service.vault.work.getRun(run.id)?.usage.sourceRequests ?? 0).toBe(0);
    expect(service.getCardEvidence(saved.card.id).sources[0]).toMatchObject({
      retrievalStatus: 'lead_only',
      fetchedAt: null,
      text: null,
      sourceId: null,
      sourceRevision: null,
      passageId: null,
    });
  },
);

it('reserves every simulated redirect durably and stops at the source request ceiling', async () => {
  sourceCards(['https://sources.example/redirect', 'https://sources.example/next']);
  const dispatchCounts: number[] = [];
  const retrieveSource = vi.fn(
    async (originalUrl: string, options: { beforeRequest?: () => void }) => {
      for (let redirect = 0; redirect < 3; redirect++) {
        options.beforeRequest!();
        dispatchCounts.push(service.vault.work.listRuns()[0]!.usage.sourceRequests!);
      }
      return {
        originalUrl,
        canonicalUrl: originalUrl,
        text: 'Not reached',
        retrievalStatus: 'retrieved' as const,
        reason: null,
      };
    },
  );
  const { service } = open(testClient(), undefined, { retrieveSource });
  const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 2 } });
  await service.waitForIdle();
  expect(dispatchCounts).toEqual([1, 2]);
  expect(retrieveSource).toHaveBeenCalledTimes(1);
  expect(service.vault.work.getRun(run.id)).toMatchObject({
    status: 'completed',
    usage: { sourceRequests: 2 },
  });
  const saved = service.vault.work.listCards(run.deckId)[0]!;
  expect(
    service.getCardEvidence(saved.card.id).sources.map((item) => item.retrievalStatus),
  ).toEqual(['failed', 'lead_only']);
});

it.each(['cancel', 'pause'] as const)(
  'fences late source text on %s while preserving progressive output and draining close',
  async (command) => {
    sourceCards(['https://sources.example/delayed']);
    let release!: () => void;
    let began!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let pendingSignal: AbortSignal | undefined;
    let lateRequestRejected = false;
    const retrieveSource = vi.fn(
      async (originalUrl: string, options: { signal: AbortSignal; beforeRequest?: () => void }) => {
        options.beforeRequest!();
        pendingSignal = options.signal;
        began();
        await delayed;
        try {
          options.beforeRequest!();
        } catch {
          lateRequestRejected = true;
        }
        return {
          originalUrl,
          canonicalUrl: originalUrl,
          text: 'Late text must never be retained',
          retrievalStatus: 'retrieved' as const,
          reason: null,
        };
      },
    );
    const { service, file } = open(testClient(), undefined, { retrieveSource });
    const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 2 } });
    await started;
    const saved = service.vault.work.listCards(run.deckId)[0]!;
    service.control(run.id, command);
    expect(pendingSignal?.aborted).toBe(true);
    const revision = service.vault.status().revision;
    let closed = false;
    const closing = service.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    await closing;
    expect(lateRequestRejected).toBe(true);
    services.splice(services.indexOf(service), 1);
    const reader = new NativeResearchService(
      openVault(file, 'fixture_native', 'reader'),
      () => null,
      undefined,
      { researchProvenance: 'synthetic_fixture', writable: false },
    );
    services.push(reader);
    expect(reader.vault.status().revision).toBe(revision);
    expect(reader.vault.work.getRun(run.id)).toMatchObject({
      status: command === 'cancel' ? 'cancelled' : 'paused',
      usage: { sourceRequests: 1 },
    });
    expect(reader.vault.work.listCards(run.deckId)).toHaveLength(1);
    expect(reader.getCardEvidence(saved.card.id).sources[0]).toMatchObject({
      retrievalStatus: 'lead_only',
      text: null,
    });
  },
);

it.each([1, request.limits.maxRequests])(
  'resumes interrupted source capture for completed companies without rehydration (model allowance %i)',
  async (maxRequests) => {
    sourceCards(['https://sources.example/interrupted-capture']);
    let release!: () => void;
    let began!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    let attempts = 0;
    const retrieveSource = vi.fn(
      async (originalUrl: string, options: { beforeRequest?: () => void }) => {
        options.beforeRequest!();
        if (++attempts === 1) {
          began();
          await delayed;
        }
        return {
          originalUrl,
          canonicalUrl: originalUrl,
          text: 'Captured on the remaining allowance',
          retrievalStatus: 'retrieved' as const,
          reason: null,
        };
      },
    );
    const { service, file } = open(testClient(), undefined, { retrieveSource });
    const run = service.start({
      ...request,
      limits: { ...request.limits, maxRequests, maxSourceRequests: 2 },
    });
    await started;
    const saved = service.vault.work.listCards(run.deckId)[0]!;
    expect(service.vault.work.getRun(run.id)?.tasks?.[0]?.status).toBe('completed');
    service.control(run.id, 'pause');
    release();
    await service.close();
    services.splice(services.indexOf(service), 1);
    const connection = vi.fn(() => null);
    const restarted = new NativeResearchService(
      openVault(file, 'fixture_native'),
      connection,
      undefined,
      { researchProvenance: 'synthetic_fixture', retrieveSource },
    );
    services.push(restarted);
    restarted.control(run.id, 'resume');
    await restarted.waitForIdle();
    expect(restarted.getCardEvidence(saved.card.id).sources[0]).toMatchObject({
      retrievalStatus: 'retrieved',
      text: 'Captured on the remaining allowance',
    });
    expect(restarted.vault.work.getRun(run.id)).toMatchObject({
      status: 'completed',
      usage: { requests: 1, sourceRequests: 2, complete: true },
    });
    expect(connection).not.toHaveBeenCalled();
    expect(pipeline.hydrate).toHaveBeenCalledTimes(1);
    expect(pipeline.discover).toHaveBeenCalledTimes(1);
    expect(retrieveSource).toHaveBeenCalledTimes(2);
  },
);

it.each([1, request.limits.maxRequests])(
  'keeps persistent passage failure resumable and repairs keylessly after reopen (model allowance %i)',
  async (maxRequests) => {
    sourceCards(['https://sources.example/passage-repair']);
    const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-native-evidence-repair-'));
    roots.push(directory);
    const file = path.join(directory, 'vault.sqlite');
    const vault = openVault(file, 'fixture_native');
    const writer = vault.writer();
    let passageAttempts = 0;
    vi.spyOn(vault, 'writer').mockReturnValue({
      ...writer,
      savePassage: () => {
        passageAttempts++;
        throw new Error('Fixture interrupted passage');
      },
    });
    const retrieveSource = vi.fn(
      async (originalUrl: string, options: { beforeRequest?: () => void }) => {
        options.beforeRequest!();
        return {
          originalUrl,
          canonicalUrl: originalUrl,
          text: 'Repair this exact retained source',
          retrievalStatus: 'retrieved' as const,
          reason: null,
        };
      },
    );
    const service = new NativeResearchService(vault, testClient, undefined, {
      researchProvenance: 'synthetic_fixture',
      retrieveSource,
    });
    services.push(service);
    const run = service.start({
      ...request,
      limits: { ...request.limits, maxRequests, maxSourceRequests: 1 },
    });
    await service.waitForIdle();
    const saved = vault.work.listCards(run.deckId)[0]!;
    const unavailable = service.getCardEvidence(saved.card.id).sources[0]!;
    expect(unavailable).toMatchObject({ retrievalStatus: 'failed', text: null, passageId: null });
    expect(vault.work.getRun(run.id)).toMatchObject({
      status: 'failed',
      usage: { sourceRequests: 1, complete: true },
    });
    expect(vault.work.getRun(run.id)?.error).toMatch(/source.*publication|passage/i);
    expect(passageAttempts).toBe(2);
    const failed = vault.work.getRun(run.id)!;
    expect(failed.tasks?.[0]?.status).toBe('completed');
    await service.close();
    services.splice(services.indexOf(service), 1);
    const connection = vi.fn(() => null);
    const unexpectedRetrieval = vi.fn(async () => {
      throw new Error('Local repair must not retrieve');
    });
    const restarted = new NativeResearchService(
      openVault(file, 'fixture_native'),
      connection,
      undefined,
      { researchProvenance: 'synthetic_fixture', retrieveSource: unexpectedRetrieval },
    );
    services.push(restarted);
    restarted.control(run.id, 'resume');
    await restarted.waitForIdle();
    const repaired = restarted.getCardEvidence(saved.card.id).sources[0]!;
    expect(repaired).toMatchObject({
      retrievalStatus: 'retrieved',
      text: 'Repair this exact retained source',
      fetchedAt: unavailable.fetchedAt,
      sourceRevision: 1,
      passageId: expect.any(String),
    });
    expect(restarted.vault.work.getRun(run.id)).toMatchObject({
      status: 'completed',
      usage: { requests: 1, sourceRequests: 1, complete: true },
    });
    expect(restarted.vault.work.getRun(run.id)?.usage).toEqual(failed.usage);
    expect(restarted.vault.work.getRun(run.id)?.tasks).toEqual(failed.tasks);
    expect(restarted.vault.work.getCard(saved.card.id)).toEqual(saved);
    expect(connection).not.toHaveBeenCalled();
    expect(unexpectedRetrieval).not.toHaveBeenCalled();
    expect(retrieveSource).toHaveBeenCalledTimes(1);
    expect(pipeline.hydrate).toHaveBeenCalledTimes(1);
  },
);

it('repairs a one-off passage write failure before completing, without repeating retrieval', async () => {
  sourceCards(['https://sources.example/transient-passage']);
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-native-evidence-transient-'));
  roots.push(directory);
  const vault = openVault(path.join(directory, 'vault.sqlite'), 'fixture_native');
  const writer = vault.writer();
  let attempts = 0;
  vi.spyOn(vault, 'writer').mockReturnValue({
    ...writer,
    savePassage: (input) => {
      if (++attempts === 1) throw new Error('Fixture transient passage failure');
      writer.savePassage(input);
    },
  });
  const retrieveSource = vi.fn(
    async (originalUrl: string, options: { beforeRequest?: () => void }) => {
      options.beforeRequest!();
      return {
        originalUrl,
        canonicalUrl: originalUrl,
        text: 'Repair without HTTP',
        retrievalStatus: 'retrieved' as const,
        reason: null,
      };
    },
  );
  const service = new NativeResearchService(vault, testClient, undefined, {
    researchProvenance: 'synthetic_fixture',
    retrieveSource,
  });
  services.push(service);
  const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 1 } });
  await service.waitForIdle();
  const saved = vault.work.listCards(run.deckId)[0]!;
  expect(service.getCardEvidence(saved.card.id).sources[0]).toMatchObject({
    retrievalStatus: 'retrieved',
    text: 'Repair without HTTP',
  });
  expect(vault.work.getRun(run.id)).toMatchObject({
    status: 'completed',
    usage: { sourceRequests: 1 },
  });
  expect(attempts).toBe(2);
  expect(retrieveSource).toHaveBeenCalledTimes(1);
});

it('fences simultaneous redirect reservations competing for the last source allowance', async () => {
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
    await client.ground(`Fixture ${candidate.name}`);
    const data = card(candidate, deckId);
    data.card.citations = [
      {
        title: candidate.name,
        url: `https://sources.example/${candidate.name}`,
        credibility: 'unknown',
      },
    ];
    return { cards: [data] };
  });
  let release!: () => void;
  const bothStarted = new Promise<void>((resolve) => {
    release = resolve;
  });
  let initialRequests = 0;
  const dispatchCounts: number[] = [];
  const retrieveSource = vi.fn(
    async (originalUrl: string, options: { beforeRequest?: () => void }) => {
      options.beforeRequest!();
      dispatchCounts.push(service.vault.work.listRuns()[0]!.usage.sourceRequests!);
      if (++initialRequests === 2) release();
      await bothStarted;
      options.beforeRequest!();
      dispatchCounts.push(service.vault.work.listRuns()[0]!.usage.sourceRequests!);
      return {
        originalUrl,
        canonicalUrl: `${originalUrl}/redirected`,
        text: 'Last-slot fixture',
        retrievalStatus: 'retrieved' as const,
        reason: null,
      };
    },
  );
  const { service } = open(testClient(), undefined, { retrieveSource });
  const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 3 } });
  await service.waitForIdle();
  expect(dispatchCounts).toEqual([1, 2, 3]);
  expect(service.vault.work.getRun(run.id)).toMatchObject({
    status: 'completed',
    usage: { requests: 3, inputTokens: 90, outputTokens: 60, sourceRequests: 3 },
  });
  expect(
    service.vault.work
      .listCards(run.deckId)
      .map((entry) => service.getCardEvidence(entry.card.id).sources[0]!.retrievalStatus)
      .sort(),
  ).toEqual(['failed', 'retrieved']);
});

it('preserves the source allowance through restart and retries only unfinished company work', async () => {
  let birchAttempts = 0;
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
    await client.ground(`Fixture ${candidate.name}`);
    if (candidate.name === 'Birch' && ++birchAttempts === 1)
      throw new Error('Fixture interrupted company');
    const data = card(candidate, deckId);
    data.card.citations = [
      {
        title: candidate.name,
        url: `https://sources.example/${candidate.name}`,
        credibility: 'unknown',
      },
    ];
    return { cards: [data] };
  });
  const retrieveSource = vi.fn(
    async (originalUrl: string, options: { beforeRequest?: () => void }) => {
      options.beforeRequest!();
      return {
        originalUrl,
        canonicalUrl: originalUrl,
        text: 'Retained before restart',
        retrievalStatus: 'retrieved' as const,
        reason: null,
      };
    },
  );
  const { service, file } = open(testClient(), undefined, { retrieveSource });
  const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 1 } });
  await service.waitForIdle();
  expect(service.vault.work.getRun(run.id)).toMatchObject({
    status: 'failed',
    usage: { sourceRequests: 1 },
  });
  await service.close();
  services.splice(services.indexOf(service), 1);
  const restarted = new NativeResearchService(
    openVault(file, 'fixture_native'),
    testClient,
    undefined,
    { researchProvenance: 'synthetic_fixture', retrieveSource },
  );
  services.push(restarted);
  restarted.control(run.id, 'resume');
  await restarted.waitForIdle();
  expect(restarted.vault.work.getRun(run.id)).toMatchObject({
    status: 'completed',
    usage: { requests: 4, sourceRequests: 1 },
    limits: { maxSourceRequests: 1 },
  });
  expect(retrieveSource).toHaveBeenCalledTimes(1);
  expect(pipeline.hydrate.mock.calls.map(([input]) => input.candidate.name)).toEqual([
    'Alder',
    'Birch',
    'Birch',
  ]);
  for (const saved of restarted.vault.work.listCards(run.deckId)) {
    expect(restarted.getCardEvidence(saved.card.id).sources[0]!.retrievalStatus).toBe(
      saved.company!.name === 'Alder' ? 'retrieved' : 'lead_only',
    );
  }
});

it('bounds saved-only evidence reads to twenty unique leads and five-thousand-character titles', async () => {
  sourceCards(Array.from({ length: 25 }, (_, index) => `https://sources.example/${index}`));
  const hydrate = pipeline.hydrate.getMockImplementation()!;
  pipeline.hydrate.mockImplementation(async (...args) => {
    const result = await hydrate(...args);
    result.cards[0].card.citations[0].title = 't'.repeat(6000);
    return result;
  });
  const { service } = open();
  const run = service.start(request);
  await service.waitForIdle();
  const saved = service.vault.work.listCards(run.deckId)[0]!;
  const evidence = service.getCardEvidence(saved.card.id);
  expect(evidence.cardId).toBe(saved.card.id);
  expect(evidence.sources).toHaveLength(20);
  expect(evidence.sources[0]!.title).toHaveLength(5000);
  expect(evidence.sources.every((lead) => lead.retrievalStatus === 'lead_only')).toBe(true);
  expect(() => service.getCardEvidence('crd_missing')).toThrow(/not found/i);
});

it('preserves source reservations through concurrent provider-meter updates', async () => {
  let firstRequest!: () => void;
  let secondRequest!: () => void;
  const first = new Promise<void>((resolve) => {
    firstRequest = resolve;
  });
  const second = new Promise<void>((resolve) => {
    secondRequest = resolve;
  });
  pipeline.hydrate.mockImplementation(async ({ candidate, client, deckId }) => {
    if (candidate.name === 'Birch') await first;
    await client.ground(`Fixture ${candidate.name}`);
    const data = card(candidate, deckId);
    data.card.citations = [
      {
        title: candidate.name,
        url: `https://sources.example/${candidate.name}`,
        credibility: 'unknown',
      },
    ];
    return { cards: [data] };
  });
  const retrieveSource = vi.fn(
    async (originalUrl: string, options: { beforeRequest?: () => void }) => {
      options.beforeRequest!();
      if (originalUrl.endsWith('Alder')) {
        firstRequest();
        await second;
      } else secondRequest();
      return {
        originalUrl,
        canonicalUrl: originalUrl,
        text: 'Fixture text',
        retrievalStatus: 'retrieved' as const,
        reason: null,
      };
    },
  );
  const { service } = open(testClient(), undefined, { retrieveSource });
  const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 2 } });
  await service.waitForIdle();
  expect(service.vault.work.getRun(run.id)).toMatchObject({
    status: 'completed',
    usage: { requests: 3, inputTokens: 90, outputTokens: 60, sourceRequests: 2 },
  });
  expect(retrieveSource).toHaveBeenCalledTimes(2);
});

it('does not expose retained text or passage references if the passage write failed', async () => {
  sourceCards(['https://sources.example/interrupted']);
  const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-native-evidence-'));
  roots.push(directory);
  const vault = openVault(path.join(directory, 'vault.sqlite'), 'fixture_native');
  const writer = vault.writer();
  vi.spyOn(vault, 'writer').mockReturnValue({
    ...writer,
    savePassage: () => {
      throw new Error('Fixture interrupted passage write');
    },
  });
  const retrieveSource = vi.fn(
    async (originalUrl: string, options: { beforeRequest?: () => void }) => {
      options.beforeRequest!();
      return {
        originalUrl,
        canonicalUrl: originalUrl,
        text: 'Stored source, missing passage',
        retrievalStatus: 'retrieved' as const,
        reason: null,
      };
    },
  );
  const service = new NativeResearchService(vault, testClient, undefined, {
    researchProvenance: 'synthetic_fixture',
    retrieveSource,
  });
  services.push(service);
  const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 1 } });
  await service.waitForIdle();
  expect(vault.work.getRun(run.id)?.status).toBe('failed');
  const saved = vault.work.listCards(run.deckId)[0]!;
  expect(service.getCardEvidence(saved.card.id).sources[0]).toMatchObject({
    retrievalStatus: 'failed',
    fetchedAt: expect.any(String),
    text: null,
    sourceId: null,
    sourceRevision: null,
    passageId: null,
    support: 'unreviewed',
  });
});

it.each(['source_scope', 'passage_scope', 'origin'] as const)(
  'refuses retained text with mismatched %s',
  async (mismatch) => {
    sourceCards(['https://sources.example/wrong-scope']);
    const directory = mkdtempSync(path.join(tmpdir(), 'stratemark-native-evidence-scope-'));
    roots.push(directory);
    const vault = openVault(path.join(directory, 'vault.sqlite'), 'fixture_native');
    const writer = vault.writer();
    vi.spyOn(vault, 'writer').mockReturnValue({
      ...writer,
      saveSourceVersion: (input, content, revision) => {
        const record = sourceVersionRecordSchema.parse(input);
        writer.saveSourceVersion(
          {
            ...record,
            origin: mismatch === 'origin' ? 'imported' : record.origin,
            visibilityScope:
              mismatch === 'source_scope'
                ? { marketIds: [], companyIds: [] }
                : record.visibilityScope,
          },
          content,
          revision,
        );
      },
      savePassage: (input) => {
        const record = evidencePassageRecordSchema.parse(input);
        writer.savePassage({
          ...record,
          origin: mismatch === 'origin' ? 'imported' : record.origin,
          visibilityScope:
            mismatch !== 'origin' ? { marketIds: [], companyIds: [] } : record.visibilityScope,
        });
      },
    });
    const retrieveSource = vi.fn(
      async (originalUrl: string, options: { beforeRequest?: () => void }) => {
        options.beforeRequest!();
        return {
          originalUrl,
          canonicalUrl: originalUrl,
          text: 'Do not cross this scope boundary',
          retrievalStatus: 'retrieved' as const,
          reason: null,
        };
      },
    );
    const service = new NativeResearchService(vault, testClient, undefined, {
      researchProvenance: 'synthetic_fixture',
      retrieveSource,
    });
    services.push(service);
    const run = service.start({ ...request, limits: { ...request.limits, maxSourceRequests: 1 } });
    await service.waitForIdle();
    expect(vault.work.getRun(run.id)?.status).toBe('completed');
    const saved = vault.work.listCards(run.deckId)[0]!;
    const evidence = service.getCardEvidence(saved.card.id).sources[0]!;
    expect(evidence.retrievalStatus).not.toBe('retrieved');
    expect(evidence.text).toBeNull();
    expect(evidence.sourceId).toBeNull();
    expect(evidence.sourceRevision).toBeNull();
    expect(evidence.passageId).toBeNull();
  },
);

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
