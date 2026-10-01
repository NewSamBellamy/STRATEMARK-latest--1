import { describe, expect, it } from 'vitest';
import * as contracts from './index';

const block = {
  id: 'note_offering_0',
  text: 'The product guide describes workshop scheduling.',
  kind: 'reported',
  support: 'unreviewed',
  timeWindow: null,
  citations: [{ title: 'Product guide', url: 'https://fixture.example/product' }],
};
const brief = {
  sections: [{ section: 'offering', blocks: [block] }],
  openQuestions: ['Which integrations are supported?'],
  limitations: [],
};
describe('retained research brief', () => {
  it('retains source-linked research notes without claiming verification', () => {
    expect(contracts.researchBriefSchema.parse(brief)).toEqual(brief);
  });
  it('requires a reported note to have its own source, while allowing clearly labelled analysis', () => {
    expect(
      contracts.researchBriefSchema.safeParse({
        ...brief,
        sections: [{ section: 'offering', blocks: [{ ...block, citations: [] }] }],
      }).success,
    ).toBe(false);
    expect(
      contracts.researchBriefSchema.safeParse({
        ...brief,
        sections: [
          { section: 'position', blocks: [{ ...block, kind: 'analysis', citations: [] }] },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects promoted support, credential-bearing links and unexpected authority fields', () => {
    for (const override of [
      { support: 'verified' },
      { support: 'supported' },
      { userVerified: true },
      { citations: [{ title: 'Private', url: 'https://user:secret@fixture.example/' }] },
      { citations: [{ title: 'Script', url: 'javascript:alert(1)' }] },
    ])
      expect(
        contracts.researchBriefSchema.safeParse({
          ...brief,
          sections: [{ section: 'overview', blocks: [{ ...block, ...override }] }],
        }).success,
      ).toBe(false);
  });
  it('bounds content and rejects duplicate sections rather than hiding or merging notes', () => {
    expect(
      contracts.researchBriefSchema.safeParse({
        ...brief,
        sections: [brief.sections[0], brief.sections[0]],
      }).success,
    ).toBe(false);
    expect(
      contracts.researchBriefSchema.safeParse({
        ...brief,
        sections: [{ section: 'offering', blocks: [{ ...block, text: 'x'.repeat(2001) }] }],
      }).success,
    ).toBe(false);
    expect(
      contracts.researchBriefSchema.safeParse({ ...brief, openQuestions: Array(9).fill('Unknown') })
        .success,
    ).toBe(false);
  });
  it('rejects malformed source URLs without throwing out of safeParse', () => {
    for (const url of ['not a URL', 'https://', 'https://[broken', '']) {
      expect(
        contracts.researchBriefSchema.safeParse({
          ...brief,
          sections: [
            { section: 'overview', blocks: [{ ...block, citations: [{ title: 'Source', url }] }] },
          ],
        }).success,
      ).toBe(false);
    }
  });
  it('requires a method and explicit assumptions for estimated notes', () => {
    const estimated = { ...block, kind: 'estimate' };
    expect(
      contracts.researchBriefSchema.safeParse({
        ...brief,
        sections: [{ section: 'position', blocks: [estimated] }],
      }).success,
    ).toBe(false);
    expect(
      contracts.researchBriefSchema.safeParse({
        ...brief,
        sections: [
          {
            section: 'position',
            blocks: [
              {
                ...estimated,
                method: 'Scenario arithmetic, not a disclosed figure.',
                assumptions: ['Illustrative adoption only.'],
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
  it('rejects a brief whose serialized UTF-8 body exceeds 128 KiB', () => {
    const sections = ['overview', 'offering', 'position', 'updates'].map((section) => ({
      section,
      blocks: Array.from({ length: 6 }, (_, index) => ({
        ...block,
        id: `${section}-${index}`,
        text: '界'.repeat(2000),
      })),
    }));
    expect(contracts.researchBriefSchema.safeParse({ ...brief, sections }).success).toBe(false);
  });
});
