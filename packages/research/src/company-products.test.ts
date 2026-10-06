import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { researchDashboardWithSources } from './dashboard';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const company = { id: 'cmp', name: 'Acme', websiteUrl: 'https://acme.com', oneLiner: 'Research software', logoUrl: null, hqLocation: null, brandTheme: null };
const url = 'https://acme.com/products/atlas';
const quote = 'Atlas is now available to help independent analysts organize their company research.';
const roadmapQuote = 'Acme plans to launch Atlas Connect for research teams on 2027-01-15.';
const time = new Date().toISOString();
const receipt = { requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200, contentHash: 'a'.repeat(64), text: `${quote} ${roadmapQuote}`, retrievedAt: time };
const selections = { products: [{ name: 'Atlas', status: 'live', sourceUrl: url, quote,
  description: 'Invented adoption: 99 million users', revenueNote: '$99B revenue', url: 'https://fake.example/atlas' }],
  roadmap: [{ title: 'Atlas Connect', sourceUrl: url, quote: roadmapQuote, date: '2027-01-15', horizon: 'now', detail: 'Invented delivered feature' }] };
function setup() {
  const ground = vi.fn().mockResolvedValue({ text: 'Unchecked search says Atlas has $99B revenue.', citations: [{ title: 'Official product', url }], queries: [] });
  const structure = vi.fn().mockResolvedValue(selections);
  const sources = { supports: (_url: string) => true, list: vi.fn().mockResolvedValue([]), retrieve: vi.fn().mockResolvedValue(receipt), save: vi.fn().mockResolvedValue(undefined) };
  const client = { ground, structure } as unknown as LlmClient;
  const run = () => researchDashboardWithSources('products_roadmap', { company, marketName: 'Research', storedMetrics: [], client, originalSources: sources });
  return { ground, structure, sources, client, run };
}

describe('original-backed company product dossier', () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date('2026-10-06T00:00:00.000Z')));
  afterEach(() => vi.useRealTimers());
  it('publishes original excerpts and fetched official links, never model prose, revenue or horizon guesses', async () => {
    const { run, sources, structure } = setup();
    structure.mockImplementation(async () => { expect(sources.save).toHaveBeenCalledTimes(1); return selections; });
    const result = await run();
    expect(result.content.products).toEqual([expect.objectContaining({ name: 'Atlas', status: 'live', url, revenueNote: '', description: expect.stringContaining(quote) })]);
    expect(result.content.roadmap).toEqual([expect.objectContaining({ title: 'Atlas Connect', detail: expect.stringContaining(roadmapQuote), date: '2027-01-15', horizon: 'next' })]);
    expect(JSON.stringify(result.content)).not.toContain('Invented');
    expect(JSON.stringify(result.content)).not.toContain('99B');
    expect(result.citations).toEqual([expect.objectContaining({ url })]);
    expect(sources.retrieve).toHaveBeenCalledTimes(1);
  });
  it.each(['invented-quote', 'wrong-url', 'wrong-company', 'no-lifecycle', 'negative-lifecycle'])(
    'rejects %s product proposals rather than defaulting to live', async fault => {
      const { run, structure, sources } = setup();
      const row = { ...selections.products[0]! };
      if (fault === 'invented-quote') row.quote = 'Atlas is now available with an invented feature.';
      if (fault === 'wrong-url') row.sourceUrl = 'https://fake.example/atlas';
      if (fault === 'wrong-company') sources.retrieve.mockResolvedValue({ ...receipt, finalUrl: 'https://other-company.example/atlas' });
      if (fault === 'no-lifecycle' || fault === 'negative-lifecycle') {
        row.quote = fault === 'no-lifecycle' ? 'Atlas helps researchers organize company data.' : 'Atlas is not available to independent analysts.';
        sources.retrieve.mockResolvedValue({ ...receipt, text: row.quote });
      }
      structure.mockResolvedValue({ products: [row], roadmap: [] });
      expect((await run()).content.products).toEqual([]);
    });
  it('retains failed outcomes and stops synthesis when no official original is readable', async () => {
    const { run, sources, structure } = setup();
    sources.retrieve.mockResolvedValue({ requestedUrl: url, status: 'blocked', retrievedAt: time } as never);
    expect((await run()).content).toEqual({ products: [], roadmap: [] });
    expect(sources.save).toHaveBeenCalledTimes(1);
    expect(structure).not.toHaveBeenCalled();
  });
  it('does not spend on synthesis after evidence persistence fails', async () => {
    const { run, sources, structure } = setup();
    sources.save.mockRejectedValue(new Error('Disk full'));
    await expect(run()).rejects.toThrow('Disk full');
    expect(structure).not.toHaveBeenCalled();
  });
  it('reuses scoped product originals without search or another original read', async () => {
    const { run, sources, ground } = setup();
    sources.list.mockResolvedValue([{ id: 'src', companyId: company.id, metricType: 'products_roadmap', capturedAt: time, receipts: [receipt] }] as never);
    expect((await run()).content.products).toHaveLength(1);
    expect(ground).not.toHaveBeenCalled();
    expect(sources.retrieve).not.toHaveBeenCalled();
  });
  it('saves selections, reopens offline and revalidates originals despite newer unrelated failed reads', async () => {
    const { client, ground, structure } = setup();
    let saved = migrateSnapshot(null).snapshot;
    saved.companies.push(company);
    const store: ResearchStore = { read: () => structuredClone(saved), write: async value => { saved = structuredClone(value); } };
    const reader = vi.fn().mockResolvedValue(receipt);
    const repo = () => new GeminiRepository({ apiKey: 'test', client, store, originalSourceReader: reader });
    const first = await repo().getDashboardTab('cmp', 'products_roadmap');
    expect(first!.content.products[0]!.description).toContain(quote);
    saved.originalSourceAttempts!.push(...Array.from({ length: 30 }, (_, i) => ({ id: `src_new_${i}`, companyId: 'cmp', metricType: 'employees',
      capturedAt: new Date(Date.now() + i + 1).toISOString(), receipts: [{ requestedUrl: url, status: 'unavailable' as const, retrievedAt: time }] })));
    ground.mockRejectedValue(new Error('offline')); structure.mockRejectedValue(new Error('offline')); reader.mockRejectedValue(new Error('offline'));
    expect(await repo().getDashboardTab('cmp', 'products_roadmap')).toEqual(first);
    expect(ground).toHaveBeenCalledTimes(1); expect(structure).toHaveBeenCalledTimes(1); expect(reader).toHaveBeenCalledTimes(1);
    saved.originalSourceAttempts = [];
    expect((await repo().getDashboardTab('cmp', 'products_roadmap'))!.content).toEqual({ products: [], roadmap: [] });
  });
  it('does not silently trust or spend to replace legacy product cache', async () => {
    const { client, ground } = setup();
    const snapshot = migrateSnapshot(null).snapshot;
    snapshot.companies.push(company);
    snapshot.dashboards.cmp = { products_roadmap: { content: { products: [{ name: 'Fake', status: 'live', description: 'Invented', revenueNote: '', url: null }], roadmap: [] }, lastRefreshedAt: time } };
    const repo = new GeminiRepository({ apiKey: 'test', client, store: { read: () => snapshot, write: async () => {} } });
    expect((await repo.getDashboardTab('cmp', 'products_roadmap'))!.content).toEqual({ products: [], roadmap: [] });
    expect(snapshot.dashboards.cmp!.products_roadmap!.content).toHaveProperty('products.0.name', 'Fake');
    expect(ground).not.toHaveBeenCalled();
  });
  it.each(['different-product', 'negated-sunset'])( 'does not publish %s lifecycle evidence', async fault => {
    const { run, sources, structure } = setup();
    const text = fault === 'different-product' ? 'Atlas is a research tool. Nova is now available to independent analysts.'
      : 'Atlas is not discontinued and remains a research tool for independent analysts.';
    sources.retrieve.mockResolvedValue({ ...receipt, text });
    structure.mockResolvedValue({ products: [{ name: 'Atlas', status: fault === 'different-product' ? 'live' : 'sunset', sourceUrl: url, quote: text }], roadmap: [] });
    expect((await run()).content.products).toEqual([]);
  });
  it.each([
    ['future-availability', 'Atlas is available next year for independent analysts.'],
    ['future-dated-availability', 'Atlas is generally available starting 2027-01-15.'],
  ])('does not label %s as live', async (_fault, text) => {
    const { run, sources, structure } = setup();
    sources.retrieve.mockResolvedValue({ ...receipt, text });
    structure.mockResolvedValue({ products: [{ name: 'Atlas', status: 'live', sourceUrl: url, quote: text }], roadmap: [] });
    expect((await run()).content.products).toEqual([]);
  });
  it.each(['invented-date', 'overdue', 'invalid-date'])( 'does not publish %s roadmap dates', async fault => {
    const { run, sources, structure } = setup();
    const date = fault === 'invented-date' ? '2027-01-16' : fault === 'overdue' ? '2025-01-15' : '2027-02-30';
    const text = fault === 'invented-date' ? roadmapQuote : `Acme plans to launch Atlas Connect for researchers on ${date}.`;
    sources.retrieve.mockResolvedValue({ ...receipt, text });
    structure.mockResolvedValue({ products: [], roadmap: [{ title: 'Atlas Connect', sourceUrl: url, quote: text, date }] });
    expect((await run()).content.roadmap).toEqual([]);
  });
  it('an explicit refresh reads new originals rather than recycling saved availability', async () => {
    const { client, sources, ground, structure } = setup();
    sources.list.mockResolvedValue([{ id: 'src', companyId: company.id, metricType: 'products_roadmap', capturedAt: time, receipts: [receipt] }] as never);
    sources.retrieve.mockResolvedValue({ requestedUrl: url, status: 'unavailable', retrievedAt: time } as never);
    const result = await researchDashboardWithSources('products_roadmap', { company, marketName: 'Research', storedMetrics: [], client,
      originalSources: sources, refreshOriginals: true });
    expect(result.content.products).toEqual([]);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).not.toHaveBeenCalled();
  });
  it('does not read unrelated publishers ahead of available official product originals', async () => {
    const { run, ground, sources } = setup();
    ground.mockResolvedValue({ text: 'Source leads', citations: [
      { title: 'Other publisher', url: 'https://reuters.com/story' }, { title: 'Another publisher', url: 'https://bloomberg.com/story' },
      { title: 'Official', url },
    ], queries: [] });
    expect((await run()).content.products).toHaveLength(1);
    expect(sources.retrieve).toHaveBeenCalledTimes(1);
    expect(sources.retrieve.mock.calls[0]![0]).toBe(url);
  });
  it('does not pay for extraction when no official company domain is resolved', async () => {
    const { client, ground, sources, structure } = setup();
    const result = await researchDashboardWithSources('products_roadmap', { company: { ...company, websiteUrl: null }, marketName: 'Research',
      storedMetrics: [], client, originalSources: sources });
    expect(result.content).toEqual({ products: [], roadmap: [] });
    expect(ground).not.toHaveBeenCalled(); expect(structure).not.toHaveBeenCalled(); expect(sources.retrieve).not.toHaveBeenCalled();
  });
  it('does not spend search or source slots when the active reader cannot read the official domain', async () => {
    const { run, ground, sources, structure } = setup();
    sources.supports = () => false;
    expect((await run()).content).toEqual({ products: [], roadmap: [] });
    expect(ground).not.toHaveBeenCalled(); expect(structure).not.toHaveBeenCalled(); expect(sources.retrieve).not.toHaveBeenCalled();
  });
  it('retains the completed first original if a second read fails, without synthesis or a false result', async () => {
    const { run, ground, sources, structure } = setup();
    ground.mockResolvedValue({ text: 'Source leads', citations: [{ title: 'Official', url }, { title: 'Plan', url: 'https://acme.com/roadmap' }], queries: [] });
    sources.retrieve.mockResolvedValueOnce(receipt).mockRejectedValueOnce(new Error('Connection lost'));
    await expect(run()).rejects.toThrow('Connection lost');
    expect(sources.save.mock.calls[0]![0]).toMatchObject({ companyId: 'cmp', metricType: 'products_roadmap', receipts: [receipt] });
    expect(structure).not.toHaveBeenCalled();
  });
  it.each(['beta', 'sunset'] as const)('retains an explicit company-reported %s lifecycle', async status => {
    const { run, sources, structure } = setup();
    const text = status === 'beta' ? 'Atlas is in public beta for independent company researchers.'
      : 'Atlas has been retired from our company research product lineup.';
    sources.retrieve.mockResolvedValue({ ...receipt, text });
    structure.mockResolvedValue({ products: [{ name: 'Atlas', status, sourceUrl: url, quote: text }], roadmap: [] });
    expect((await run()).content.products).toEqual([expect.objectContaining({ name: 'Atlas', status, description: expect.stringContaining(text) })]);
  });
});
