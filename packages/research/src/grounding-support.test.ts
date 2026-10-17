import { describe, expect, it, vi } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import { createGeminiClient } from './gemini';
import { createGenAiClient } from './genai';
import { recordResearchEvidence, searchResearchEvidence, type ResearchEvidence } from './research-evidence';
import type { LlmClient } from './types';

const answer = '  Acme has 120 employees. OtherCo has 900 employees.  ';
const chunks = [{ web: { uri: 'https://sec.gov/acme', title: 'Acme filing' } },
  { web: { title: 'No URL' } }, { web: { uri: 'https://reuters.com/otherco', title: 'OtherCo' } }];
const support = (text: string, indices: number[]) => ({ segment: { text, startIndex: 2, endIndex: 25 }, groundingChunkIndices: indices });

function clientFor(kind: 'fetch' | 'sdk', supports: unknown[], text = answer) {
  const data = { text, candidates: [{ content: { parts: [{ text }] },
    groundingMetadata: { groundingChunks: chunks, groundingSupports: supports, webSearchQueries: ['Acme headcount'] } }] };
  if (kind === 'fetch') return createGeminiClient({ apiKey: 'test', groundedRpm: 0,
    fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(data))) });
  return createGenAiClient({ apiKey: 'test', groundedRpm: 0,
    clientImpl: { models: { generateContent: vi.fn().mockResolvedValue(data as unknown as GenerateContentResponse) } } });
}

describe.each(['fetch', 'sdk'] as const)('%s provider grounding support', (kind) => {
  it('keeps the original answer and maps original chunk indices, not compact citation indices', async () => {
    const out = await clientFor(kind, [support('Acme has 120 employees.', [0]), support('OtherCo has 900 employees.', [2])]).ground('test');
    expect(out).toMatchObject({ grounding: { provider: 'google-search', answerText: answer, supports: [
      { text: 'Acme has 120 employees.', sources: [{ chunkIndex: 0, url: 'https://sec.gov/acme' }] },
      { text: 'OtherCo has 900 employees.', sources: [{ chunkIndex: 2, url: 'https://reuters.com/otherco' }] },
    ] } });
    expect(out.text).toBe(answer.trim());
  });

  it('drops unsupported text and invalid source mappings instead of borrowing another citation', async () => {
    const out = await clientFor(kind, [support('Invented statement', [0]), support('Acme has 120 employees.', [1]),
      support('Acme has 120 employees.', [99]), support('Acme has 120 employees.', [-1]),
      support('Acme has 120 employees.', [0, 99]), support('Acme has 120 employees.', [0.5]),
      support('Acme has 120 employees.', [])]).ground('test');
    expect(out).toMatchObject({ grounding: { supports: [] } });
  });

  it('preserves non-ASCII passage text without interpreting provider byte offsets as JS string positions', async () => {
    const text = '会社には120人の従業員がいます。';
    const out = await clientFor(kind, [support(text, [0])], text).ground('test');
    expect(out).toMatchObject({ grounding: { answerText: text, supports: [{ text, startIndex: 2, endIndex: 25 }] } });
  });

  it('persists mappings before structuring and returns independent copies when querying saved research', async () => {
    const records: ResearchEvidence[] = [];
    const client = recordResearchEvidence(clientFor(kind, [support('Acme has 120 employees.', [0])]), (record) => records.push(record));
    await client.ground('test', { researchContext: { companyId: 'acme', topic: 'verify:employees' } });
    const stored = JSON.parse(JSON.stringify(records));
    const hits = searchResearchEvidence(stored, { companyId: 'acme' });
    expect(hits[0]).toMatchObject({ grounding: { answerText: answer, supports: [{ sources: [{ url: 'https://sec.gov/acme' }] }] } });
    // Mutating returned metadata must not rewrite the saved research receipt.
    const hit = hits[0] as unknown as { grounding: { supports: { sources: { url: string }[] }[] } };
    hit.grounding.supports[0]!.sources[0]!.url = 'changed';
    expect(stored[0].grounding.supports[0].sources[0].url).toBe('https://sec.gov/acme');
  });
});

it('does not manufacture support metadata for older/custom providers', async () => {
  const records: ResearchEvidence[] = [];
  const client = recordResearchEvidence({ ground: vi.fn().mockResolvedValue({ text: 'Legacy notes', citations: [{ title: 'Filing', url: 'https://sec.gov/report' }], queries: [] }), structure: vi.fn() } as unknown as LlmClient, (record) => records.push(record));
  await client.ground('test', { researchContext: { companyId: 'acme', topic: 'overview' } });
  expect(records[0]).not.toHaveProperty('grounding');
});
