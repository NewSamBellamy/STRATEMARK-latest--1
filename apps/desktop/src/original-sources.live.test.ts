import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOriginalSourceServices } from './original-sources';
import { GeminiRepository, migrateSnapshot } from '@mi/research';
import type { LlmClient } from '@mi/research';
import { createFileStore } from './storage';

const runLiveAcceptance = process.env.STRATEMARK_LIVE_SOURCE_ACCEPTANCE === '1';

describe.skipIf(!runLiveAcceptance)('bounded native original-source acceptance', () => {
  it('retrieves originals and reopens honest dashboard diagnostics for two companies without external model calls', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'stratemark-live-originals-'));
    try {
      const companies = [
        { id: 'cmp_microsoft_live_acceptance', name: 'Microsoft Corporation', url: 'https://www.microsoft.com/en-us/about' },
        { id: 'cmp_anthropic_live_acceptance', name: 'Anthropic', url: 'https://www.anthropic.com/company' },
      ];
      const sources = createOriginalSourceServices(directory);
      const attempts = await Promise.all(companies.map(async (company) => ({
        id: `src_${randomUUID()}`,
        companyId: company.id,
        metricType: 'overview',
        capturedAt: new Date().toISOString(),
        receipts: [await sources.retrieve(company.url, {
          companyId: company.id,
          companyName: company.name,
          metricType: 'overview',
        })],
      })));

      for (const attempt of attempts) {
        expect(attempt.receipts[0]).toMatchObject({ status: 'retrieved', httpStatus: 200 });
        expect(attempt.receipts[0]?.text?.trim().length).toBeGreaterThan(100);
        expect(attempt.receipts[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
        await sources.save(attempt);
      }

      const reopened = createOriginalSourceServices(directory);
      for (const company of companies) {
        const [attempt] = await reopened.list({ companyId: company.id, metricType: 'overview', limit: 1 });
        expect(attempt?.receipts[0]).toMatchObject({ status: 'retrieved', httpStatus: 200 });
        expect(attempt?.receipts[0]?.text?.trim().length).toBeGreaterThan(100);
        expect(attempt?.receipts[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
      }

      // Exercise the same repository/dashboard seam used by the native app.
      // No external model/search call is made; the deterministic client returns
      // no proposal so the dashboard must preserve Unknown and source outcomes.
      const snapshot = migrateSnapshot(null).snapshot;
      snapshot.companies = companies.map(company => ({ id: company.id, name: company.name,
        oneLiner: '', websiteUrl: company.url, logoUrl: null, hqLocation: null, brandTheme: null }));
      snapshot.companyMarket = Object.fromEntries(companies.map(company => [company.id, 'Research']));
      const statePath = path.join(directory, 'repository.json');
      await createFileStore(statePath).write(snapshot);
      let groundingCalls = 0;
      let structureCalls = 0;
      const client: LlmClient = {
        ground: async () => { groundingCalls++; return { text: '', citations: [], queries: [] }; },
        structure: async (_prompt, schema) => { structureCalls++; return schema.parse({ excerpts: [] }); },
      };
      const repo = new GeminiRepository({ apiKey: 'acceptance-test-only', client,
        store: createFileStore(statePath), originalSources: reopened });
      for (const company of companies) {
        const overview = await repo.getDashboardTab(company.id, 'overview');
        expect(overview?.sourceDiagnostics).toMatchObject({
          reads: [expect.objectContaining({ outcome: 'retrieved' })],
          eligibleSourceCount: 1,
          acceptedExcerptCount: 0,
        });
        expect(overview?.content.markdown).toContain('- Employees: Unknown');
        expect(overview?.content.markdown).toContain('Background unavailable');
      }
      expect(groundingCalls).toBe(companies.length);
      expect(structureCalls).toBe(companies.length);

      // A cold repository reopening must render the same honest source/unknown
      // state from local artifacts without contacting the deterministic client again.
      const reopenedRepo = new GeminiRepository({ apiKey: 'acceptance-test-only',
        client: { ground: async () => { throw new Error('Reopen must not research'); },
          structure: async () => { throw new Error('Reopen must use retained excerpts'); } },
        store: createFileStore(statePath), originalSources: createOriginalSourceServices(directory) });
      for (const company of companies) {
        const overview = await reopenedRepo.getDashboardTab(company.id, 'overview');
        expect(overview?.content.markdown).toContain('- Employees: Unknown');
        expect(overview?.sourceDiagnostics).toMatchObject({ eligibleSourceCount: 1, acceptedExcerptCount: 0 });
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
