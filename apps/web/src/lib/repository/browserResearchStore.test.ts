import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { GeminiRepository, migrateSnapshot, type LlmClient } from '@mi/research';
import { installBrowserResearch, openBrowserResearchStore, readBrowserResearchData } from './browserResearchStore';

const KEY = 'mi.repo.v1';
const data = () => migrateSnapshot(null).snapshot;

/** The raw saved record, as IndexedDB holds it. */
async function rawRecord(key: string): Promise<Record<string, unknown> | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('stratemark.vault', 2);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return new Promise((resolve) => {
    const request = db.transaction('snapshots', 'readonly').objectStore('snapshots').get(key);
    request.onsuccess = () => { db.close(); resolve(request.result as Record<string, unknown> | undefined); };
  });
}

/** Writes a record the way builds before compression did. */
async function putRaw(key: string, value: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('stratemark.vault', 2);
    request.onupgradeneeded = () => { request.result.createObjectStore('snapshots'); request.result.createObjectStore('images'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise<void>((resolve) => {
    const tx = db.transaction('snapshots', 'readwrite');
    tx.objectStore('snapshots').put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
  });
}

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
  }, 30_000); // a 6 MB workspace: quick alone, but the default 5 s has been missed inside a loaded full run

  it('saves the workspace compressed, far under the browser per-record limit a twenty-deck workspace passed', async () => {
    // Chromium refuses one IndexedDB value over 133,169,152 bytes; a 66.6M-character JSON string (UTF-16) is 133.3M.
    const original = data();
    original.reports = Array.from({ length: 2000 }, (_, n) => ({ id: `report-${n}`, markdown: `Evidence row ${n}: the same research prose repeats across companies. `.repeat(20) })) as typeof original.reports;
    const store = await openBrowserResearchStore();
    await store.write(original);
    const json = JSON.stringify(original);
    const saved = await rawRecord(`${KEY}.committed`);
    expect(typeof saved?.json).toBe('undefined');
    expect(Object.prototype.toString.call(saved?.gz)).toBe('[object ArrayBuffer]');
    expect((saved!.gz as ArrayBuffer).byteLength).toBeLessThan(json.length / 5);
    expect((await openBrowserResearchStore()).read()).toEqual(original);
    expect((await readBrowserResearchData()).current).toBe(json);
  });

  it('opens a workspace saved before compression and keeps it as the backup of its first compressed save', async () => {
    const before = { ...data(), reports: [{ id: 'saved-uncompressed' }] } as ReturnType<typeof data>;
    await putRaw(`${KEY}.committed`, { json: JSON.stringify(before), revision: 4, at: 1 });
    const store = await openBrowserResearchStore();
    expect(store.read()).toEqual(before);
    const after = { ...data(), reports: [{ id: 'saved-compressed' }] } as ReturnType<typeof data>;
    await store.write(after);
    const saved = await readBrowserResearchData();
    expect(JSON.parse(saved.current!)).toEqual(after);
    expect(JSON.parse(saved.backup!)).toEqual(before);
    // The uncompressed revision is kept compressed: copied as it was, one near the per-record limit would fail the save.
    expect(typeof (await rawRecord(`${KEY}.committed.backup`))?.json).toBe('undefined');
    expect((await rawRecord(`${KEY}.committed.backup`))?.revision).toBe(4);
    expect((await rawRecord(`${KEY}.committed`))?.revision).toBe(5);
    expect((await openBrowserResearchStore()).read()).toEqual(after);
  });

  it('refuses a damaged compressed record instead of treating the workspace as empty', async () => {
    await putRaw(`${KEY}.committed`, { gz: new Uint8Array([1, 2, 3]).buffer, revision: 2, at: 1 });
    await expect(openBrowserResearchStore()).rejects.toThrow(/unreadable/i);
    await putRaw(`${KEY}.committed`, { revision: 2, at: 1 });
    await expect(openBrowserResearchStore()).rejects.toThrow(/unreadable/i);
  });

  it('a damaged backup never blocks viewing or exporting the healthy current workspace', async () => {
    const store = await openBrowserResearchStore();
    const current = { ...data(), reports: [{ id: 'healthy' }] } as ReturnType<typeof data>;
    await store.write(current);
    await putRaw(`${KEY}.committed.backup`, { gz: new Uint8Array([1, 2, 3]).buffer, revision: 1, at: 1 });
    const saved = await readBrowserResearchData();
    expect(JSON.parse(saved.current!)).toEqual(current);
    expect(saved.backup).toBeNull();
  });

  it('says saved research is intact when the browser cannot prepare a save, and a retry works', async () => {
    const store = await openBrowserResearchStore();
    const kept = { ...data(), reports: [{ id: 'kept' }] } as ReturnType<typeof data>;
    await store.write(kept);
    const encoder = vi.spyOn(TextEncoder.prototype, 'encode').mockImplementationOnce(() => { throw new RangeError('Array buffer allocation failed'); });
    await expect(store.write(data())).rejects.toThrow(/not saved.*intact/i);
    encoder.mockRestore();
    expect((await openBrowserResearchStore()).read()).toEqual(kept);
    const next = { ...data(), reports: [{ id: 'retried' }] } as ReturnType<typeof data>;
    await store.write(next);
    expect((await openBrowserResearchStore()).read()).toEqual(next);
  });

  it('tells a browser without decompression to update instead of calling the research unreadable', async () => {
    const store = await openBrowserResearchStore();
    await store.write(data());
    vi.stubGlobal('DecompressionStream', undefined);
    await expect(openBrowserResearchStore()).rejects.toThrow(/cannot open compressed research/i);
    vi.unstubAllGlobals();
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

  it('coalesces a burst of writes into one transaction and acknowledges every caller', async () => {
    const store = await openBrowserResearchStore();
    const base = data();
    await store.write(base);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const steps = [1, 2, 3].map((n) => ({ ...data(), reports: [{ id: `step-${n}` }] }) as ReturnType<typeof data>);
    await Promise.all(steps.map((s) => store.write(s)));
    // One transaction: the previous revision to backup, the newest to current.
    expect(put).toHaveBeenCalledTimes(2);
    put.mockRestore();
    expect(store.read()).toEqual(steps[2]);
    const saved = await readBrowserResearchData();
    expect(JSON.parse(saved.current!)).toEqual(steps[2]);
    expect(JSON.parse(saved.backup!)).toEqual(base);
  });

  it('queues writes made during an in-flight commit behind it, newest payload wins', async () => {
    const store = await openBrowserResearchStore();
    const first = { ...data(), reports: [{ id: 'first' }] } as ReturnType<typeof data>;
    const inFlight = store.write(first);
    await Promise.resolve(); // the first write has started committing
    const second = { ...data(), reports: [{ id: 'second' }] } as ReturnType<typeof data>;
    const third = { ...data(), reports: [{ id: 'third' }] } as ReturnType<typeof data>;
    const later = [store.write(second), store.write(third)];
    second.reports.push({ id: 'mutated-after-write' } as typeof second.reports[number]);
    await inFlight;
    await Promise.all(later);
    const saved = await readBrowserResearchData();
    expect(JSON.parse(saved.backup!)).toEqual(first);
    expect(JSON.parse(saved.current!)).toEqual(third);
  });

  it('rejects every coalesced caller when their shared transaction fails, keeping the last commit', async () => {
    const store = await openBrowserResearchStore();
    const kept = { ...data(), reports: [{ id: 'kept' }] } as ReturnType<typeof data>;
    await store.write(kept);
    const put = IDBObjectStore.prototype.put;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = put.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    const results = await Promise.allSettled([store.write(data()), store.write(data())]);
    spy.mockRestore();
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(store.read()).toEqual(kept);
    expect((await openBrowserResearchStore()).read()).toEqual(kept);
  });

  it('never folds a valid write into a refused one', async () => {
    const store = await openBrowserResearchStore();
    const valid = { ...data(), reports: [{ id: 'valid' }] } as ReturnType<typeof data>;
    const ok = store.write(valid);
    const refused = store.write({ ...data(), schemaVersion: 999 });
    await expect(refused).rejects.toThrow(/newer version/i);
    await ok;
    expect((await openBrowserResearchStore()).read()).toEqual(valid);
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
  }, 30_000); // a 6 MB workspace: quick on its own, but this suite runs beside others and the default 5 s has been missed under load

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
