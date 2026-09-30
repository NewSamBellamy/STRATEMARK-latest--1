import { describe, expect, it } from 'vitest';
import {
  evidencePassageRecordSchema,
  numericObservationRecordSchema,
  observationComparisonKey,
  recordVersionSchema,
  sourceVersionRecordSchema,
} from './vault-evidence';

const version = {
  contractVersion: '1',
  vaultId: 'vault_1',
  id: 'source_1',
  revision: 2,
  createdAt: '2026-09-30T12:00:00.000Z',
  updatedAt: '2026-09-30T12:00:00.000Z',
};
const evidenceRef = { sourceId: 'source_1', sourceRevision: 2, passageId: 'passage_1' };

const source = {
  ...version,
  canonicalUrl: 'https://example.com/annual-report',
  originalUrl: 'http://example.com/redirected-report',
  contentHash: 'a'.repeat(64),
  fetchedAt: '2026-09-30T11:00:00.000Z',
  publishedAt: '2026-03-01T00:00:00.000Z',
  eventAt: '2025-12-31T00:00:00.000Z',
  retrievalStatus: 'retrieved',
  origin: 'web',
  visibilityScope: { marketIds: ['market_1'], companyIds: ['company_1'] },
};

const passage = {
  ...version,
  id: 'passage_1',
  sourceId: 'source_1',
  sourceRevision: 2,
  text: 'Revenue was zero for the measured period.',
  contentHash: 'b'.repeat(64),
  origin: 'web',
  visibilityScope: { marketIds: ['market_1'], companyIds: ['company_1'] },
};

const observation = {
  ...version,
  id: 'observation_1',
  companyId: 'company_1',
  metricDefinitionId: 'annual_revenue',
  scope: { kind: 'market', id: 'market_1' },
  unit: 'money',
  currency: 'USD',
  period: {
    kind: 'interval',
    startAt: '2025-01-01T00:00:00.000Z',
    endAt: '2025-12-31T23:59:59.999Z',
  },
  value: 0,
  support: 'supported',
  evidenceRefs: [evidenceRef],
};

describe('canonical vault evidence records', () => {
  it('validates strict version metadata and chronological timestamps', () => {
    expect(recordVersionSchema.parse(version)).toEqual(version);
    expect(recordVersionSchema.safeParse({ ...version, unexpected: true }).success).toBe(false);
    expect(recordVersionSchema.safeParse({ ...version, contractVersion: '2' }).success).toBe(false);
    expect(recordVersionSchema.safeParse({ ...version, id: '../source' }).success).toBe(false);
    expect(recordVersionSchema.safeParse({ ...version, id: 'x'.repeat(129) }).success).toBe(false);
    expect(recordVersionSchema.safeParse({ ...version, revision: -1 }).success).toBe(false);
    expect(
      recordVersionSchema.safeParse({ ...version, createdAt: 'not-a-timestamp' }).success,
    ).toBe(false);
    expect(
      recordVersionSchema.safeParse({
        ...version,
        createdAt: '2026-09-30T12:00:00.0002Z',
        updatedAt: '2026-09-30T12:00:00.0001Z',
      }).success,
    ).toBe(false);
  });

  it('keeps source URLs safe and publication, event, and retrieval dates distinct', () => {
    expect(sourceVersionRecordSchema.parse(source)).toEqual(source);
    expect(
      sourceVersionRecordSchema.safeParse({ ...source, canonicalUrl: 'file:///private/report' })
        .success,
    ).toBe(false);
    expect(
      sourceVersionRecordSchema.safeParse({
        ...source,
        originalUrl: 'https://person:secret@example.com/report',
      }).success,
    ).toBe(false);
    expect(
      sourceVersionRecordSchema.safeParse({
        ...source,
        visibilityScope: { marketIds: ['market_1', 'market_1'], companyIds: [] },
      }).success,
    ).toBe(false);
    expect(
      sourceVersionRecordSchema.safeParse({
        ...source,
        fetchedAt: '2026-09-30T12:00:00.0001Z',
      }).success,
    ).toBe(false);
    expect(
      sourceVersionRecordSchema.safeParse({ ...source, localPath: 'C:\\private' }).success,
    ).toBe(false);
  });

  it('requires retained, bounded passage text linked to a source version', () => {
    expect(evidencePassageRecordSchema.parse(passage)).toEqual(passage);
    expect(evidencePassageRecordSchema.safeParse({ ...passage, text: '  ' }).success).toBe(false);
    expect(
      evidencePassageRecordSchema.safeParse({ ...passage, text: 'x'.repeat(20_001) }).success,
    ).toBe(false);
    expect(evidencePassageRecordSchema.safeParse({ ...passage, sourceRevision: -1 }).success).toBe(
      false,
    );
  });

  it('requires evidence for supported values and keeps unknown values null', () => {
    expect(numericObservationRecordSchema.parse(observation)).toEqual(observation);
    expect(
      numericObservationRecordSchema.safeParse({ ...observation, evidenceRefs: [] }).success,
    ).toBe(false);
    expect(
      numericObservationRecordSchema.safeParse({ ...observation, support: 'reported' }).success,
    ).toBe(true);
    expect(
      numericObservationRecordSchema.safeParse({ ...observation, support: 'conflicted' }).success,
    ).toBe(true);
    expect(
      numericObservationRecordSchema.safeParse({ ...observation, value: null, support: 'unknown' })
        .success,
    ).toBe(true);
    expect(
      numericObservationRecordSchema.safeParse({ ...observation, value: 0, support: 'unknown' })
        .success,
    ).toBe(false);
    expect(
      numericObservationRecordSchema.safeParse({ ...observation, value: Number.POSITIVE_INFINITY })
        .success,
    ).toBe(false);
    expect(
      numericObservationRecordSchema.safeParse({
        ...observation,
        evidenceRefs: [evidenceRef, evidenceRef],
      }).success,
    ).toBe(false);
    expect(
      numericObservationRecordSchema.safeParse({ ...observation, userVerified: true }).success,
    ).toBe(false);
  });

  it('compares only matching company, definition, scope, units, currency, and period', () => {
    const current = numericObservationRecordSchema.parse(observation);
    const changedValueAndEvidence = numericObservationRecordSchema.parse({
      ...observation,
      value: 12,
      evidenceRefs: [{ sourceId: 'source_2', sourceRevision: 1, passageId: 'passage_2' }],
    });
    const nextYear = numericObservationRecordSchema.parse({
      ...observation,
      period: {
        kind: 'interval',
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2026-12-31T23:59:59.999Z',
      },
    });
    const otherDimensions = [
      { ...observation, companyId: 'company_2' },
      { ...observation, metricDefinitionId: 'quarterly_revenue' },
      { ...observation, scope: { kind: 'company', id: 'company_1' } },
      { ...observation, unit: 'count' },
      { ...observation, currency: 'EUR' },
    ].map((candidate) => numericObservationRecordSchema.parse(candidate));

    expect(observationComparisonKey(current)).toBe(
      observationComparisonKey(changedValueAndEvidence),
    );
    expect(observationComparisonKey(current)).not.toBe(observationComparisonKey(nextYear));
    for (const candidate of otherDimensions) {
      expect(observationComparisonKey(current)).not.toBe(observationComparisonKey(candidate));
    }
  });

  it('rejects reversed intervals and unsupported attestation shortcuts', () => {
    expect(
      numericObservationRecordSchema.safeParse({
        ...observation,
        period: {
          kind: 'interval',
          startAt: '2025-12-31T23:59:59.999Z',
          endAt: '2025-01-01T00:00:00.000Z',
        },
      }).success,
    ).toBe(false);
    expect(
      numericObservationRecordSchema.safeParse({ ...observation, support: 'user_verified' })
        .success,
    ).toBe(false);
  });
  it('does not treat unknown periods as comparable or equivalent timestamp spellings as conflicts', () => {
    const instant = numericObservationRecordSchema.parse({
      ...observation,
      period: { kind: 'instant', at: '2025-12-31T00:00:00Z' },
    });
    const padded = numericObservationRecordSchema.parse({
      ...instant,
      period: { kind: 'instant', at: '2025-12-31T00:00:00.0000Z' },
    });
    expect(observationComparisonKey(instant)).toBe(observationComparisonKey(padded));
    expect(observationComparisonKey({ ...instant, period: { kind: 'unknown' } })).toBeNull();
  });
  it('requires an actual value and retained support for conflicted observations', () => {
    expect(numericObservationRecordSchema.safeParse({ ...observation, value: null }).success).toBe(
      false,
    );
    expect(
      numericObservationRecordSchema.safeParse({
        ...observation,
        support: 'conflicted',
        evidenceRefs: [],
      }).success,
    ).toBe(false);
    expect(
      numericObservationRecordSchema.safeParse({
        ...observation,
        scope: { kind: 'anything', id: 'scope_1' },
      }).success,
    ).toBe(false);
  });
  it('does not fabricate a public URL for private evidence or a content hash for failed retrieval', () => {
    expect(
      sourceVersionRecordSchema.safeParse({
        ...source,
        origin: 'user_provided',
        canonicalUrl: null,
        originalUrl: null,
      }).success,
    ).toBe(true);
    expect(
      sourceVersionRecordSchema.safeParse({
        ...source,
        retrievalStatus: 'failed',
        contentHash: null,
      }).success,
    ).toBe(true);
    expect(sourceVersionRecordSchema.safeParse({ ...source, contentHash: null }).success).toBe(
      false,
    );
    expect(
      observationComparisonKey(
        numericObservationRecordSchema.parse({ ...observation, currency: null }),
      ),
    ).toBeNull();
  });
});
