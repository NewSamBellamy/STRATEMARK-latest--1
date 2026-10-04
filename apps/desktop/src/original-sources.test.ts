import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createOriginalSourceServices } from './original-sources';
import type { OriginalSourceAttempt } from '@mi/research';
import { GeminiRepository, hydrateCompanyCard } from '@mi/research';
import type { LlmClient } from '@mi/research';
import sample from '../../web/src/sample/frontier-snapshot.json';
import { createFileStore, parseResearchExport } from './storage';

const directories: string[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'keystone-originals-'));
  directories.push(directory);
  return { directory, store: createOriginalSourceServices(directory) };
}
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
function attempt(companyId = 'acme'): OriginalSourceAttempt {
  return { id: `src_${randomUUID()}`, companyId, metricType: 'arr', capturedAt: new Date().toISOString(),
    receipts: [{ requestedUrl: 'https://sec.gov/report', finalUrl: 'https://sec.gov/report', status: 'retrieved', retrievedAt: new Date().toISOString(), httpStatus: 200, contentHash: 'a'.repeat(64), text: 'Company revenue passage.', truncated: false }] };
}

describe('native original source artifacts', () => {
  it('stores initial company originals with a valid identity and reloads them after restart', async () => {
    const { directory, store } = await setup();
    const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
    const url = 'https://sec.gov/report';
    const client: LlmClient = {
      ground: async () => ({ text: 'Provider notes', citations: [{ title: 'SEC', url }], queries: [] }),
      structure: (async (_prompt, schema) => schema.parse({ metrics: { employees: { value: 45, confidence: 'verified', sourceIndex: 0,
        passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } } } })) as LlmClient['structure'],
    };
    const result = await hydrateCompanyCard({
      candidate: { name: 'Acme Inc.', domain: null, descriptor: 'Software', cardTypes: ['company'] },
      client, plan: { marketName: 'Software', vertical: 'SaaS', geography: null, notes: null, searchThemes: [] }, companyId: 'cmp_acme',
      originalSources: { ...store, retrieve: async () => ({ ...attempt().receipts[0]!, text: quote }) },
      fetchImpl: async () => new Response('', { status: 404 }),
    });
    expect(result.metrics.find((m) => m.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'verified' });
    const restarted = createOriginalSourceServices(directory);
    const records = await restarted.list({ companyId: 'cmp_acme', metricType: 'company_profile' });
    expect(records).toHaveLength(1);
    expect(records[0]!.id).toMatch(/^src_[a-f0-9-]{36}$/);
    expect(records[0]!.receipts[0]!.text).toBe(quote);
  });
  it('saves a separate artifact and reloads scoped evidence after restart', async () => {
    const { directory, store } = await setup();
    const record = attempt();
    await store.save(record);
    await store.save(attempt('other-company'));
    expect(await createOriginalSourceServices(directory).list({ companyId: 'acme' })).toEqual([record]);
    expect(await store.list({ companyId: 'acme', metricType: 'users' })).toEqual([]);
    expect(await store.list({ companyId: '' })).toEqual([]);
    expect((await readdir(directory)).every((file) => file.endsWith('.json'))).toBe(true);
  });

  it('refuses overwriting an existing receipt rather than rewriting its history', async () => {
    const { store } = await setup();
    const record = attempt();
    await store.save(record);
    await expect(store.save({ ...record, companyId: 'forged' })).rejects.toThrow();
    expect(await store.list({ companyId: 'acme' })).toEqual([record]);
  });

  it('rejects path traversal and oversized extracts before writing', async () => {
    const { directory, store } = await setup();
    await expect(store.save({ ...attempt(), id: '../outside' })).rejects.toThrow();
    const record = attempt();
    record.receipts[0]!.text = 'a'.repeat(4001);
    await expect(store.save(record)).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });

  it('surfaces corrupt artifacts instead of returning silently incomplete research', async () => {
    const { directory, store } = await setup();
    const record = attempt();
    await store.save(record);
    await writeFile(path.join(directory, `${record.id}.json`), 'broken');
    await expect(store.list({ companyId: 'acme' })).rejects.toThrow();
  });

  it('keeps originals queryable after a real repository interpretation failure and restart', async () => {
    const { directory } = await setup();
    const snapshot = createFileStore(path.join(directory, 'repo.json'));
    const initial = parseResearchExport(JSON.stringify(sample));
    snapshot.write(initial);
    const metric = initial.metrics.find((m) => m.confidence !== 'user_verified')!;
    const sourceStore = createOriginalSourceServices(path.join(directory, 'originals'));
    const ground = vi.fn(async () => ({ text: 'Generated provider notes', citations: [{ title: 'Filing', url: 'https://sec.gov/report' }], queries: [] }));
    const structure = vi.fn(async () => { throw new Error('Model interpretation failed'); });
    const originals = { ...sourceStore, retrieve: async () => attempt().receipts[0]! };
    const repo = new GeminiRepository({ apiKey: 'test-key', store: snapshot, client: { ground, structure }, originalSources: originals });
    await expect(repo.verifyMetric({ companyId: metric.companyId, metricType: metric.metricType })).rejects.toThrow('Model interpretation failed');
    expect(JSON.stringify(snapshot.read())).not.toContain('Company revenue passage.');
    const restarted = new GeminiRepository({ apiKey: 'test-key', store: snapshot, client: { ground, structure }, originalSources: createOriginalSourceServices(path.join(directory, 'originals')) });
    const hits = await restarted.getOriginalSourceEvidence({ companyId: metric.companyId, metricType: metric.metricType });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.receipts[0]!.text).toBe('Company revenue passage.');
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
    expect((await restarted.getCompanyMetrics(metric.companyId)).find((m) => m.id === metric.id)!.value).toBe(metric.value);
  });
});
