import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { GeminiRepository, migrateSnapshot, type LlmClient } from '@mi/research';
import { installBrowserResearch, openBrowserResearchStore, readBrowserResearchData } from './browserResearchStore';

const KEY = 'mi.repo.v1';
const data = () => migrateSnapshot(null).snapshot;

describe('acknowledged browser research storage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('indexedDB', new IDBFactory());
    localStorage.clear();
  });

  it('migrates legacy research without deleting it or copying credentials', async () => {
    const original = data();
    original.reports = [{ id: 'paid-report', markdown: 'irreplaceable' }] as typeof original.reports;
    localStorage.setItem(KEY, JSON.stringify(original));
    localStorage.setItem('mi.geminiApiKey', 'secret-test-only');
    const store = await openBrowserResearchStore();
    await store.write(store.read()!);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(original));
    const reopened = await openBrowserResearchStore();
    expect(reopened.read()).toEqual(original);
    expect(JSON.stringify(reopened.read())).not.toContain('secret-test-only');
  });

  it('saves and reopens research larger than the failed browser working-copy limit', async () => {
    const original = data();
    original.reports = [{ id: 'large-report', markdown: 'x'.repeat(6_000_000) }] as typeof original.reports;
    const store = await openBrowserResearchStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await store.write(original);
    expect((await openBrowserResearchStore()).read()).toEqual(original);
  });

  it('keeps immutable queued revisions instead of saving later caller mutations', async () => {
    const store = await openBrowserResearchStore();
    const snapshot = data();
    const pending = store.write(snapshot);
    snapshot.reports.push({ id: 'uncommitted' } as typeof snapshot.reports[number]);
    await pending;
    expect((await openBrowserResearchStore()).read()!.reports).toEqual([]);
    const copy = store.read()!;
    copy.reports.push({ id: 'external-mutation' } as typeof copy.reports[number]);
    expect(store.read()!.reports).toEqual([]);
  });

  it('rejects a stale writer and preserves the newer committed research', async () => {
    const first = await openBrowserResearchStore();
    const stale = await openBrowserResearchStore();
    const newer = data();
    newer.reports.push({ id: 'latest' } as typeof newer.reports[number]);
    await first.write(newer);
    await expect(stale.write(data())).rejects.toThrow(/another window/i);
    expect((await openBrowserResearchStore()).read()).toEqual(newer);
  });

  it('never reports a save when durable storage is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(openBrowserResearchStore()).rejects.toThrow(/storage/i);
  });

  it('preserves corrupt legacy research and refuses to overwrite it', async () => {
    localStorage.setItem(KEY, '{broken');
    await expect(openBrowserResearchStore()).rejects.toThrow(/unreadable/i);
    expect(localStorage.getItem(KEY)).toBe('{broken');
  });

  it('refuses writes to an unsupported future workspace', async () => {
    const future = { ...data(), schemaVersion: 999 };
    localStorage.setItem(KEY, JSON.stringify(future));
    const store = await openBrowserResearchStore();
    await expect(store.write(data())).rejects.toThrow(/newer version/i);
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify(future));
  });

  it('runs an actual repository mutation through the durable adapter and reopens it', async () => {
    const store = await openBrowserResearchStore();
    const repo = new GeminiRepository({ apiKey: 'test', store });
    const saved = await repo.createMarket({ name: 'Game studios', scopeDefinition: { vertical: 'Games', geography: null, notes: null }, refreshCadence: 'weekly' });
    const reopened = new GeminiRepository({ apiKey: 'test', store: await openBrowserResearchStore() });
    expect(await reopened.getMarket(saved.id)).toEqual(saved);
  });

  it('acknowledges original receipts before verification and preserves them through reopen and JSON import', async () => {
    const snapshot = data();
    const url = 'https://www.sec.gov/Archives/acme';
    const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
    snapshot.companies = [{ id: 'acme', name: 'Acme Inc.', oneLiner: 'Software', websiteUrl: 'https://acme.example', logoUrl: null, hqLocation: null, brandTheme: null }];
    snapshot.metrics = [{ id: 'headcount', companyId: 'acme', metricType: 'employees', value: null, confidence: 'unknown', source: null, citations: [], methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z' }];
    const store = await openBrowserResearchStore();
    await store.write(snapshot);
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text: quote, citations: [{ title: 'SEC', url }], queries: [] })),
      structure: vi.fn(async (_prompt, schema) => {
        expect((await openBrowserResearchStore()).read()!.originalSourceAttempts).toHaveLength(1);
        return schema.parse({ verdict: 'contradicted', currentValue: 45, passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } });
      }) as LlmClient['structure'],
    };
    const repo = new GeminiRepository({ apiKey: 'secret-test-only', store, client, originalSourceReader: async () => ({ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-03T00:00:00.000Z' }) });
    expect((await repo.verifyMetric({ companyId: 'acme', metricType: 'employees' })).metric.value).toBe(45);
    const exported = (await readBrowserResearchData()).current!;
    expect(exported).toContain(quote);
    expect(exported).not.toContain('secret-test-only');
    await installBrowserResearch(exported);
    const reopened = new GeminiRepository({ apiKey: 'test', store: await openBrowserResearchStore(), client });
    expect((await reopened.getOriginalSourceEvidence({ companyId: 'acme' }))[0]!.receipts[0]!.text).toBe(quote);
    expect((await reopened.getCompanyMetrics('acme'))[0]!.value).toBe(45);
    expect(client.ground).toHaveBeenCalledTimes(1);
  });

  it('keeps both previous records when a transaction aborts and allows a real retry', async () => {
    const store = await openBrowserResearchStore();
    const first = data();
    first.reports.push({ id: 'previous' } as typeof first.reports[number]);
    await store.write(first);
    const second = { ...first, reports: [{ id: 'second' }] } as typeof first;
    await store.write(second);
    const before = await readBrowserResearchData();
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    await expect(store.write(data())).rejects.toThrow(/not saved/i);
    spy.mockRestore();
    expect(await readBrowserResearchData()).toEqual(before);
    expect(store.read()).toEqual(second);
    await store.write(first);
    expect((await openBrowserResearchStore()).read()).toEqual(first);
  });

  it('imports large research atomically, retaining the prior workspace as backup', async () => {
    const store = await openBrowserResearchStore();
    await store.write(data());
    const large = { ...data(), reports: [{ id: 'paid', markdown: 'x'.repeat(6_000_000) }] } as ReturnType<typeof data>;
    await installBrowserResearch(JSON.stringify(large));
    const saved = await readBrowserResearchData();
    expect(JSON.parse(saved.current!)).toEqual(large);
    expect(JSON.parse(saved.backup!)).toEqual(data());
    await expect(store.write(data())).rejects.toThrow(/another window/i);
  });

  it('rejects malformed and future imports without changing either saved revision', async () => {
    const store = await openBrowserResearchStore();
    await store.write(data());
    const before = await readBrowserResearchData();
    await expect(installBrowserResearch('{broken')).rejects.toThrow(/unreadable/i);
    await expect(installBrowserResearch(JSON.stringify({ ...data(), schemaVersion: 999 }))).rejects.toThrow(/newer version/i);
    expect(await readBrowserResearchData()).toEqual(before);
  });

  it('refuses import while research is active', async () => {
    const active = data();
    active.researchJobs = [{ id: 'job', status: 'running' }] as typeof active.researchJobs;
    const store = await openBrowserResearchStore();
    await store.write(active);
    await expect(installBrowserResearch(JSON.stringify(data()))).rejects.toThrow(/stop active research/i);
    expect((await openBrowserResearchStore()).read()).toEqual(active);
  });

  it('rejects structurally corrupt exports before backing up or replacing valid data', async () => {
    const store = await openBrowserResearchStore();
    await store.write(data());
    const before = await readBrowserResearchData();
    for (const patch of [{ researchJobs: {} }, { dashboards: [] }, { schemaVersion: '2' }, { markets: [null] }, { originalSourceAttempts: {} }, { originalSourceAttempts: [{ id: 'broken' }] }]) {
      await expect(installBrowserResearch(JSON.stringify({ ...data(), ...patch }))).rejects.toThrow(/unreadable/i);
      expect(await readBrowserResearchData()).toEqual(before);
    }
  });
});
