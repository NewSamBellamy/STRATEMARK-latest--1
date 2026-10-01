import { describe, expect, it } from 'vitest';
import * as contracts from './native-research';

const source = {
  url: 'https://fixture.invalid/source',
  title: 'Synthetic source',
  retrievalStatus: 'partial',
  fetchedAt: '2026-10-01T12:00:00.000Z',
  text: 'Retained source text, not a verified claim.',
  sourceId: 'src_fixture',
  sourceRevision: 1,
  passageId: 'pass_fixture',
  support: 'unreviewed',
};
describe('native saved evidence read boundary', () => {
  it('retains source identity and unreviewed support, without claiming semantic verification', () => {
    expect(
      contracts.nativeCardEvidenceSchema.parse({ cardId: 'crd_fixture', sources: [source] }),
    ).toEqual({ cardId: 'crd_fixture', sources: [source] });
    expect(
      contracts.nativeCardEvidenceSchema.safeParse({
        cardId: 'crd_fixture',
        sources: [{ ...source, support: 'verified' }],
      }).success,
    ).toBe(false);
  });
  it('does not allow a retrieved passage without retained identity, or a failed source with text', () => {
    for (const changed of [
      { passageId: null },
      { sourceId: null },
      { text: null },
      { retrievalStatus: 'failed' },
      { retrievalStatus: 'lead_only' },
    ]) {
      expect(
        contracts.nativeCardEvidenceSchema.safeParse({
          cardId: 'crd_fixture',
          sources: [{ ...source, ...changed }],
        }).success,
      ).toBe(false);
    }
  });
  it('accepts an honest uncaptured lead and bounds excerpt size and source count', () => {
    const lead = {
      ...source,
      retrievalStatus: 'lead_only',
      fetchedAt: null,
      text: null,
      sourceId: null,
      sourceRevision: null,
      passageId: null,
    };
    expect(
      contracts.nativeCardEvidenceSchema.safeParse({ cardId: 'crd_fixture', sources: [lead] })
        .success,
    ).toBe(true);
    expect(
      contracts.nativeCardEvidenceSchema.safeParse({
        cardId: 'crd_fixture',
        sources: [{ ...source, text: 'x'.repeat(20001) }],
      }).success,
    ).toBe(false);
    expect(
      contracts.nativeCardEvidenceSchema.safeParse({
        cardId: 'crd_fixture',
        sources: Array(21).fill(lead),
      }).success,
    ).toBe(false);
    expect(
      contracts.nativeCardEvidenceSchema.safeParse({
        cardId: 'crd_fixture',
        sources: [{ ...lead, url: 'https://user:secret@fixture.invalid/source' }],
      }).success,
    ).toBe(false);
  });
});

describe('explicit source capture allowance', () => {
  it('does not silently grant retrieval to older approved limits', () => {
    const prior = { maxRequests: 10, maxInputTokens: 1000, maxOutputTokens: 1000 };
    expect(contracts.nativeResearchLimitsSchema.parse(prior)).toEqual(prior);
    expect(contracts.nativeResearchLimitsSchema.parse({ ...prior, maxSourceRequests: 12 })).toEqual(
      { ...prior, maxSourceRequests: 12 },
    );
    expect(
      contracts.nativeResearchLimitsSchema.safeParse({ ...prior, maxSourceRequests: 101 }).success,
    ).toBe(false);
  });
});
