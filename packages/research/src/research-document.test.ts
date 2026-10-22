import { describe, expect, it } from 'vitest';
import type { LlmClient } from './types';
import { GeminiRepository, type ResearchStore, type RepoSnapshot } from './repository';
import {
  chunkDocument, cleanDocumentText, digestNoteText, documentDigestPrompt, gateDigest, parseDigestNote, quoteAppears, quoteStatesValue, DOCUMENT_CHUNK_CHARS,
} from './research-document';

const DOC = [
  'Acme Robotics Q3 investor memo.',
  'Acme reported annual recurring revenue of $42.5 million at the end of September 2026.',
  'The company employs 310 people across three offices.',
  'Our Dallas plant will double capacity next spring.',
].join('\n\n');

describe('gateDigest', () => {
  it('keeps findings and figures whose quote appears word for word, and drops the rest', () => {
    const digest = gateDigest({
      summary: ' Acme grew. ',
      findings: [
        { claim: 'Acme has 310 employees.', quote: 'The company employs 310 people across three offices.' },
        { claim: 'Acme won a government contract.', quote: 'Acme won a large government contract in August.' },
        { claim: 'Capacity will double.', quote: 'our dallas plant will double   capacity next spring.' },
      ],
      figures: [
        { metricType: 'arr', value: 42_500_000, label: 'ARR, Sep 2026', quote: 'annual recurring revenue of $42.5 million at the end of September 2026' },
        { metricType: 'arr', value: 99, label: 'second ARR', quote: 'annual recurring revenue of $42.5 million at the end of September 2026' },
        { metricType: 'valuation', value: 1e9, label: 'Valuation', quote: 'valued at one billion dollars' },
        { metricType: 'nonsense', value: 5, label: 'x', quote: 'The company employs 310 people across three offices.' },
        { metricType: 'employees', value: 310, label: 'Headcount', quote: 'The company employs people across three offices.' },
      ],
    }, DOC);
    expect(digest.summary).toBe('Acme grew.');
    expect(digest.findings.map((f) => f.claim)).toEqual(['Acme has 310 employees.', 'Capacity will double.']);
    expect(digest.figures).toEqual([
      { metricType: 'arr', value: 42_500_000, label: 'ARR, Sep 2026', quote: 'annual recurring revenue of $42.5 million at the end of September 2026' },
    ]);
  });

  it('returns nothing for an unreadable model answer', () => {
    expect(gateDigest('not an object', DOC)).toEqual({ summary: '', findings: [], figures: [] });
    expect(gateDigest({ findings: 'oops' }, DOC).findings).toEqual([]);
  });

  it('treats a short quote as no quote', () => {
    expect(quoteAppears('Acme', DOC)).toBe(false);
  });
});

describe('quoteStatesValue', () => {
  it('reads scaled, comma and percent numbers', () => {
    expect(quoteStatesValue('ARR of $42.5 million', 42_500_000)).toBe(true);
    expect(quoteStatesValue('valued at $1.2 billion', 1.2e9)).toBe(true);
    expect(quoteStatesValue('about 1,200 employees', 1200)).toBe(true);
    expect(quoteStatesValue('a 12% share of the market', 12)).toBe(true);
    expect(quoteStatesValue('raised $30M in March', 30_000_000)).toBe(true);
  });
  it('rejects a value the quote does not state', () => {
    expect(quoteStatesValue('ARR of $42.5 million', 99)).toBe(false);
    expect(quoteStatesValue('ARR of $42.5 million', 4_250_000_000)).toBe(false);
    expect(quoteStatesValue('three offices', 3)).toBe(false);
  });
});

describe('parseDigestNote', () => {
  it('reads back what digestNoteText wrote', () => {
    const digest = {
      summary: 'Acme grew in Q3.',
      findings: [{ claim: 'Acme has 310 employees.', quote: 'The company employs 310 people across three offices.' }],
      figures: [{ metricType: 'employees' as const, value: 310, label: 'Headcount', quote: 'The company employs 310 people across three offices.' }],
    };
    const parsed = parseDigestNote(digestNoteText('memo.pdf', digest));
    expect(parsed).toMatchObject({ title: 'memo.pdf', summary: 'Acme grew in Q3.', findings: digest.findings });
    expect(parsed!.figures).toHaveLength(1);
  });

  it('is null for any other note', () => {
    expect(parseDigestNote('Founder told us churn is 4% monthly.')).toBeNull();
  });
});

describe('document text', () => {
  it('cleans control characters and blank-line runs', () => {
    expect(cleanDocumentText('a\u0000b\r\n\r\n\r\n\r\nc  \n')).toBe('a b\n\nc');
  });

  it('chunks long text at paragraph breaks, within the limit, losing nothing', () => {
    const paragraph = 'word '.repeat(900).trim();
    const text = Array.from({ length: 12 }, () => paragraph).join('\n\n');
    const chunks = chunkDocument(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(DOCUMENT_CHUNK_CHARS);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' '));
  });

  it('tells the model the document is data and bounds what it reads', () => {
    const prompt = documentDigestPrompt({ companyName: 'Acme', title: 'memo.pdf', text: 'x'.repeat(100_000) });
    expect(prompt).toContain('untrusted DATA');
    expect(prompt.length).toBeLessThan(50_000);
  });

  it('writes a digest note that says it is the user\'s own and not verified', () => {
    const note = digestNoteText('memo.pdf', { summary: 'S', findings: [{ claim: 'C', quote: 'Q quote here' }], figures: [] });
    expect(note).toContain('provided by you, not independently verified');
    expect(note).toContain('"Q quote here"');
  });
});

function repoWith(structure: LlmClient['structure']) {
  let snapshot: RepoSnapshot | null = null;
  const store: ResearchStore = { read: () => snapshot, write: (snap) => { snapshot = snap; } };
  const client: LlmClient = {
    ground: async () => ({ text: '', citations: [], queries: [] }),
    structure,
  } as LlmClient;
  return new GeminiRepository({ apiKey: 'x', client, store });
}

describe('addResearchDocument', () => {
  it('stores the document, reads it back with verified quotes, and makes it searchable', async () => {
    const repo = repoWith((async () => ({
      summary: 'Acme memo.',
      findings: [{ claim: 'Headcount is 310.', quote: 'The company employs 310 people across three offices.' }],
      figures: [{ metricType: 'employees', value: 310, label: 'Headcount', quote: 'The company employs 310 people across three offices.' }],
    })) as LlmClient['structure']);
    const result = await repo.addResearchDocument({ companyId: 'cmp_a', companyName: 'Acme', title: 'memo.md', text: DOC, kind: 'file' });
    expect(result.findings).toHaveLength(1);
    expect(result.figures[0]).toMatchObject({ metricType: 'employees', value: 310 });
    expect(result.truncated).toBe(false);
    expect(result.digestFailed).toBe(false);
    const evidence = repo.getResearchEvidence({ companyId: 'cmp_a', limit: 20 });
    expect(evidence.every((e) => e.topic === 'user_note')).toBe(true);
    expect(evidence.some((e) => e.text.includes('Provided by you: memo.md'))).toBe(true);
    expect(evidence.some((e) => e.text.includes('Digest of your document'))).toBe(true);
  });

  it('keeps the document even when the model read fails', async () => {
    const repo = repoWith((async () => { throw new Error('model down'); }) as LlmClient['structure']);
    const result = await repo.addResearchDocument({ companyId: 'cmp_a', companyName: 'Acme', title: 'memo.md', text: DOC, kind: 'text' });
    expect(result.digestFailed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(repo.getResearchEvidence({ companyId: 'cmp_a', limit: 20 })).toHaveLength(1);
  });

  it('rejects a document with too little text, and cuts one that is too long', async () => {
    const repo = repoWith((async () => ({ summary: '', findings: [], figures: [] })) as LlmClient['structure']);
    await expect(repo.addResearchDocument({ companyId: 'cmp_a', companyName: 'Acme', title: 't', text: 'short', kind: 'text' })).rejects.toThrow(/too little/);
    const long = Array.from({ length: 400 }, (_, i) => `Paragraph ${i} about Acme. ${'detail '.repeat(60)}`).join('\n\n');
    const result = await repo.addResearchDocument({ companyId: 'cmp_a', companyName: 'Acme', title: 'long', text: long, kind: 'file' });
    expect(result.truncated).toBe(true);
  });
});
