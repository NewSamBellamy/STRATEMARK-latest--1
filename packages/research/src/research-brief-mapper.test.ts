import { describe, expect, it } from 'vitest';
import { researchBriefSchema } from '@mi/contracts';
import { enrichmentOutSchema } from './schemas';
import { zodToGenAiSchema } from './genai';
import { mapResearchBrief } from './research-brief-mapper';

const citations = [
  { title: 'Product', url: 'https://alder.example/product' },
  { title: 'Terms', url: 'https://alder.example/terms' },
  { title: 'Unrelated company page', url: 'https://alder.example/company' },
];
const note = (changes: Record<string, unknown> = {}) => ({
  text: 'Business accounts require approval.',
  kind: 'reported',
  sourceIndices: [1],
  timeWindow: null,
  ...changes,
});
const packet = (blocks: unknown[] = [note()], changes: Record<string, unknown> = {}) => ({
  sections: [{ section: 'offering', blocks }],
  openQuestions: ['Pricing is not disclosed.'],
  limitations: ['Only publisher documentation was found.'],
  ...changes,
});
const map = (input: unknown, sources = citations) =>
  mapResearchBrief(enrichmentOutSchema.parse({ researchBrief: input }).researchBrief, sources);

describe('bounded indexed research brief mapping', () => {
  it('retains the live four-section provider shape with singleton-wrapped own indices', () => {
    const input = packet([], {
      sections: [
        {
          section: 'overview',
          blocks: [
            note({ text: 'Foundation models and developer tooling.', sourceIndices: [[0]] }),
          ],
        },
        {
          section: 'offering',
          blocks: [
            note({ text: 'Open-weight and proprietary model catalog.', sourceIndices: [[2]] }),
            note({ text: 'Serverless inference and fine-tuning platform.', sourceIndices: [[2]] }),
            note({ text: 'Enterprise chat and code assistants.', sourceIndices: [[2]] }),
          ],
        },
        {
          section: 'position',
          blocks: [
            note({
              text: 'Open weights may distinguish the offering; this is analysis.',
              kind: 'analysis',
              sourceIndices: [],
            }),
          ],
        },
        {
          section: 'updates',
          blocks: [
            note({
              text: 'A dated funding announcement.',
              sourceIndices: [[6]],
              timeWindow: 'September 2026',
            }),
            note({
              text: 'A dated infrastructure announcement.',
              sourceIndices: [[8]],
              timeWindow: 'March 2026',
            }),
          ],
        },
      ],
    });
    const sources = Array.from({ length: 9 }, (_, index) => ({
      title: `Synthetic grounded lead ${index}`,
      url: `https://fixtures.invalid/source-${index}`,
    }));
    const draft = enrichmentOutSchema.parse({ researchBrief: input }).researchBrief!;
    expect(
      draft.sections.flatMap((section) => section.blocks.map((block) => block.sourceIndices)),
    ).toEqual([[0], [2], [2], [2], [], [6], [8]]);
    const mapped = mapResearchBrief(draft, sources).researchBrief!;
    expect(mapped.sections.map((section) => section.section)).toEqual([
      'overview',
      'offering',
      'position',
      'updates',
    ]);
    const blocks = mapped.sections.flatMap((section) => section.blocks);
    expect(blocks.map((block) => block.citations)).toEqual([
      [sources[0]],
      [sources[2]],
      [sources[2]],
      [sources[2]],
      [],
      [sources[6]],
      [sources[8]],
    ]);
    expect(blocks.every((block) => block.support === 'unreviewed')).toBe(true);
    expect(mapped.sections[3]!.blocks.map((block) => block.timeWindow)).toEqual([
      'September 2026',
      'March 2026',
    ]);
    expect(mapped.limitations).toEqual(input.limitations);
  });

  it.each([
    { indices: [[0], [2]], expected: [0, 2] },
    { indices: [0, [2]], expected: [0, 2] },
    { indices: [[0], 2, [1]], expected: [0, 2, 1] },
  ])(
    'normalizes only singleton integer wrappers without changing indices %#',
    ({ indices, expected }) => {
      const wrapped = map(packet([note({ sourceIndices: indices })]));
      const flat = map(packet([note({ sourceIndices: expected })]));
      expect(wrapped).toEqual(flat);
      expect(wrapped.researchBrief!.sections[0]!.blocks[0]!.citations).toEqual(
        expected.map((index) => citations[index]),
      );
    },
  );

  it.each([
    { indices: [[]] },
    { indices: [[0, 2]] },
    { indices: [[[0]]] },
    { indices: [['0']] },
    { indices: [[null]] },
    { indices: [[0.5]] },
    { indices: [[Number.MAX_SAFE_INTEGER + 1]] },
    { indices: [[0], [1], [2], [0]] },
  ])(
    'rejects ambiguous/noninteger/deeper wrappers and preserves the three-entry bound %#',
    ({ indices }) => {
      const mapped = map(packet([note({ sourceIndices: indices })]));
      expect(mapped.researchBrief).toBeUndefined();
      expect(mapped.gapNotes.join(' ')).toMatch(/sourceIndices/);
    },
  );

  it.each([{ indices: [[-1]] }, { indices: [[99]] }])(
    'leaves wrapped out-of-range indices to own-source validation %#',
    ({ indices }) => {
      const draft = enrichmentOutSchema.parse({
        researchBrief: packet([note({ sourceIndices: indices })]),
      }).researchBrief!;
      expect(draft.sections[0]!.blocks[0]!.sourceIndices).toEqual([indices[0]![0]]);
      const mapped = mapResearchBrief(draft, citations);
      expect(mapped.researchBrief).toBeUndefined();
      expect(mapped.gapNotes.join(' ')).toMatch(/unavailable source index|own source attribution/);
    },
  );

  it("maps only a block's own sources and stamps local IDs/unreviewed status", () => {
    const mapped = map(packet()).researchBrief!;
    expect(researchBriefSchema.safeParse(mapped).success).toBe(true);
    expect(mapped.sections[0]!.blocks[0]).toMatchObject({
      text: 'Business accounts require approval.',
      citations: [citations[1]],
      support: 'unreviewed',
      timeWindow: null,
      id: expect.stringMatching(/^note_offering_/),
    });
    expect(mapped.openQuestions).toEqual(['Pricing is not disclosed.']);
  });

  it('uses stable content/section IDs across reorderings, source-index changes and unrelated notes', () => {
    const before = map(
      packet([
        note(),
        note({
          text: 'Optional integration has documented limits.',
          kind: 'analysis',
          sourceIndices: [],
        }),
      ]),
    ).researchBrief!;
    const after = map(
      packet([
        note({
          text: 'Optional integration has documented limits.',
          kind: 'analysis',
          sourceIndices: [],
        }),
        note({ sourceIndices: [0] }),
      ]),
    ).researchBrief!;
    expect(before.sections[0]!.blocks[0]!.id).toBe(after.sections[0]!.blocks[1]!.id);
    const otherSection = map(
      packet([note()], { sections: [{ section: 'overview', blocks: [note()] }] }),
    ).researchBrief!;
    expect(before.sections[0]!.blocks[0]!.id).not.toBe(otherSection.sections[0]!.blocks[0]!.id);
  });

  it.each([[], [-1], [99], [1.5], ['1'], [null]].map((indices) => ({ indices })))(
    'drops reported blocks with no usable own index %# and explains the gap',
    ({ indices }) => {
      const mapped = map(packet([note({ sourceIndices: indices })]));
      expect(mapped.researchBrief).toBeUndefined();
      expect(mapped.gapNotes.join(' ')).toMatch(/source|attribution/i);
      expect(mapped.gapNotes.join(' ')).not.toContain('Business accounts require approval.');
    },
  );

  it('keeps valid own indices, deduplicates sources, and explains unavailable indices without global fallback', () => {
    const mapped = map(packet([note({ sourceIndices: [1, 99, 1] })])).researchBrief!;
    expect(mapped.sections[0]!.blocks[0]!.citations).toEqual([citations[1]]);
    expect(mapped.limitations.join(' ')).toMatch(/source|index/i);
  });

  it.each([
    'javascript:alert(1)',
    'file:///private',
    'https://user:pass@alder.example/',
    'not a URL',
    'https://alder.example/' + 'x'.repeat(2048),
  ])('rejects invalid grounded citation %s without replacement', (url) => {
    const mapped = map(packet([note({ sourceIndices: [0] })]), [{ title: 'Invalid', url }]);
    expect(mapped.researchBrief).toBeUndefined();
    expect(mapped.gapNotes.join(' ')).toMatch(/source|attribution/i);
  });

  it('does not give uncited analysis an invented citation', () => {
    const mapped = map(
      packet([
        note({
          kind: 'analysis',
          sourceIndices: [],
          text: 'Coverage may constrain expansion; this has not been compared.',
        }),
      ]),
    ).researchBrief!;
    expect(mapped.sections[0]!.blocks[0]!.citations).toEqual([]);
  });

  it('keeps numeric estimates visibly estimated with method, assumptions and unknown period', () => {
    const mapped = map(
      packet([
        note({
          text: 'Illustrative annual cost: $240.',
          kind: 'estimate',
          sourceIndices: [],
          method: '2 assumed accounts × $10 × 12',
          assumptions: ['Assumed price, not disclosed'],
        }),
      ]),
    ).researchBrief!;
    expect(mapped.sections[0]!.blocks[0]).toMatchObject({
      kind: 'estimate',
      method: '2 assumed accounts × $10 × 12',
      assumptions: ['Assumed price, not disclosed'],
      support: 'unreviewed',
      timeWindow: null,
      citations: [],
    });
    expect(mapped.limitations.join(' ')).toMatch(/period|time window/i);
  });

  it.each([
    { method: null, assumptions: ['Assumed price'] },
    { method: 'Calculation', assumptions: [] },
    { method: '', assumptions: ['Assumed price'] },
    { method: 'Calculation', assumptions: [''] },
  ])(
    'drops estimate with invalid method/assumptions %# without discarding usable blocks',
    (changes) => {
      const mapped = map(
        packet([note(), note({ text: 'Estimated revenue', kind: 'estimate', ...changes })]),
      ).researchBrief!;
      expect(mapped.sections[0]!.blocks).toHaveLength(1);
      expect(mapped.limitations.join(' ')).toMatch(/method|assumptions/i);
    },
  );

  it.each([
    { id: 'model_authority' },
    { support: 'verified' },
    { citations: [citations[0]] },
    { verified: true },
  ])(
    'rejects model-supplied host fields %# rather than accepting forged attribution/authority',
    (changes) => {
      const mapped = map(
        packet([note(), note({ text: 'Forged note', ...changes })]),
      ).researchBrief!;
      expect(mapped.sections[0]!.blocks).toHaveLength(1);
      expect(mapped.limitations.join(' ')).toMatch(/invalid|omitted/i);
    },
  );

  it.each([undefined, null])('leaves absent old briefs absent %#', (input) => {
    expect(map(input)).toEqual({ gapNotes: [] });
  });

  it.each(['malformed', [], 42, { sections: 'broken' }])(
    'keeps a malformed optional brief from failing the whole enrichment %#',
    (input) => {
      const mapped = map(input);
      expect(mapped.researchBrief).toBeUndefined();
      expect(mapped.gapNotes.join(' ')).toMatch(/invalid|omitted/i);
    },
  );

  it('drops duplicate content and duplicate sections, maintaining unique IDs and visible reasons', () => {
    const mapped = map(
      packet([note(), note()], {
        sections: [
          { section: 'offering', blocks: [note(), note()] },
          { section: 'offering', blocks: [note({ text: 'Duplicate section' })] },
        ],
      }),
    ).researchBrief!;
    expect(mapped.sections).toHaveLength(1);
    expect(mapped.sections[0]!.blocks).toHaveLength(1);
    expect(mapped.limitations.join(' ')).toMatch(/duplicate/i);
    expect(researchBriefSchema.safeParse(mapped).success).toBe(true);
  });

  it('enforces text, period, method, assumptions and source-index bounds without silent truncation of claims', () => {
    const invalid = [
      note({ text: 'x'.repeat(2001) }),
      note({ timeWindow: 'x'.repeat(241) }),
      note({ method: 'x'.repeat(501) }),
      note({ assumptions: Array(7).fill('Assumption') }),
      note({ assumptions: ['x'.repeat(501)] }),
      note({ sourceIndices: [0, 1, 2, 0] }),
    ];
    for (const block of invalid) {
      const mapped = map(packet([note(), block])).researchBrief!;
      expect(mapped.sections[0]!.blocks).toHaveLength(1);
      expect(mapped.limitations.join(' ')).toMatch(/invalid|omitted/i);
      expect(researchBriefSchema.safeParse(mapped).success).toBe(true);
    }
    expect(
      map(packet([note({ text: 'x'.repeat(2000) })])).researchBrief!.sections[0]!.blocks[0]!.text,
    ).toHaveLength(2000);
  });

  it('bounds sections, blocks, questions and limitations while reserving room for omission reasons', () => {
    const mapped = map(
      packet([], {
        sections: ['overview', 'offering', 'position', 'updates', 'extra'].map((section) => ({
          section,
          blocks: Array.from({ length: 7 }, (_, i) => note({ text: `${section} note ${i}` })),
        })),
        openQuestions: [...Array(9).fill('Open question'), 'x'.repeat(501)],
        limitations: Array(9).fill('Declared limitation'),
      }),
    ).researchBrief!;
    expect(mapped.sections).toHaveLength(4);
    expect(mapped.sections.every((section) => section.blocks.length === 6)).toBe(true);
    expect(mapped.openQuestions.length).toBeLessThanOrEqual(8);
    expect(mapped.limitations.length).toBeLessThanOrEqual(8);
    expect(mapped.limitations.join(' ')).toMatch(/limit|omitted/i);
    expect(researchBriefSchema.safeParse(mapped).success).toBe(true);
  });

  it('exposes the optional typed model shape without host IDs, URLs or support status', () => {
    const schema = zodToGenAiSchema(enrichmentOutSchema) as {
      properties: Record<
        string,
        {
          properties: Record<
            string,
            {
              items: {
                properties: Record<string, { items: { properties: Record<string, unknown> } }>;
              };
            }
          >;
        }
      >;
    };
    const fields =
      schema.properties.researchBrief!.properties.sections!.items.properties.blocks!.items
        .properties;
    expect(Object.keys(fields)).toEqual([
      'text',
      'kind',
      'sourceIndices',
      'timeWindow',
      'method',
      'assumptions',
    ]);
    expect(fields).not.toHaveProperty('citations');
    expect(fields).not.toHaveProperty('support');
  });

  it('omits an otherwise valid brief over the shared serialized UTF-8 cap with an explicit reason', () => {
    const largeSources = citations.map((source) => ({
      ...source,
      title: 'Source '.repeat(700),
    }));
    const mapped = map(
      packet([], {
        sections: ['overview', 'offering', 'position', 'updates'].map((section) => ({
          section,
          blocks: Array.from({ length: 6 }, (_, i) =>
            note({ text: `${section} substantive note ${i}`, sourceIndices: [0, 1, 2] }),
          ),
        })),
      }),
      largeSources,
    );
    expect(mapped.researchBrief).toBeUndefined();
    expect(mapped.gapNotes.join(' ')).toMatch(/128 KiB|size limit/i);
    expect(mapped.gapNotes.join(' ')).toContain('Pricing is not disclosed.');
  });
});
