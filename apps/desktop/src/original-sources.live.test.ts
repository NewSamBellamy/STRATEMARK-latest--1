import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createOriginalSourceServices } from './original-sources';

const runLiveAcceptance = process.env.STRATEMARK_LIVE_SOURCE_ACCEPTANCE === '1';

describe.skipIf(!runLiveAcceptance)('bounded native original-source acceptance', () => {
  it('retrieves and reopens public originals for two companies without model calls', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'stratemark-live-originals-'));
    try {
      const companies = [
        { id: 'cmp_microsoft_live_acceptance', name: 'Microsoft Corporation', url: 'https://www.microsoft.com/' },
        { id: 'cmp_anthropic_live_acceptance', name: 'Anthropic', url: 'https://www.anthropic.com/' },
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
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
