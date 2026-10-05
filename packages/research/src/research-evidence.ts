import { usableCitations, type Citation } from '@mi/contracts';
import type { LlmClient, ProviderGrounding } from './types';
import { copyProviderGrounding } from './grounding-support';

/** Grounded model notes, NOT raw source pages or independently verified claims. */
export interface ResearchEvidence {
  id: string;
  companyId?: string;
  companyName?: string;
  topic: string;
  capturedAt: string;
  text: string;
  citations: Citation[];
  queries: string[];
  grounding?: ProviderGrounding;
}

export function recordResearchEvidence(
  client: LlmClient,
  record: ((evidence: ResearchEvidence) => void) | ((evidence: ResearchEvidence) => Promise<void>),
): LlmClient {
  return {
    structure: client.structure.bind(client),
    async ground(prompt, opts) {
      const result = await client.ground(prompt, opts);
      const citations = usableCitations(result.citations);
      // Unscoped discovery/chat output must not enter a company's evidence vault.
      if (opts?.researchContext && result.text.trim() && citations.length) {
        await record({
          id: `ev_${globalThis.crypto.randomUUID()}`,
          ...opts.researchContext,
          capturedAt: new Date().toISOString(),
          text: result.text,
          citations,
          queries: [...result.queries],
          ...(result.grounding ? { grounding: copyProviderGrounding(result.grounding) } : {}),
        });
      }
      return result;
    },
  };
}

export function searchResearchEvidence(
  records: readonly ResearchEvidence[],
  input: { companyId?: string; companyName?: string; query?: string; limit?: number },
): ResearchEvidence[] {
  if (!input.companyId && !input.companyName) return [];
  const name = (value: string) => value.trim().toLowerCase();
  const terms = [...new Set((input.query ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((term) => term.length > 2 && !['the', 'and', 'for', 'what', 'how', 'this', 'company', 'about'].includes(term));
  const limit = Number.isFinite(input.limit) ? Math.min(10, Math.max(1, Math.floor(input.limit!))) : 4;
  return records
    .filter((record) => input.companyId
      ? record.companyId === input.companyId
      : name(record.companyName ?? '') === name(input.companyName!))
    .map((record) => {
      const text = `${record.topic} ${record.text}`.toLowerCase();
      return { record, score: terms.reduce((score, term) => score + Number(text.includes(term)), 0) };
    })
    .filter(({ score }) => !terms.length || score > 0)
    .sort((a, b) => b.score - a.score || b.record.capturedAt.localeCompare(a.record.capturedAt))
    .slice(0, limit)
    .map(({ record }) => ({ ...record, citations: record.citations.map((c) => ({ ...c })), queries: [...record.queries],
      ...(record.grounding ? { grounding: copyProviderGrounding(record.grounding) } : {}),
    }));
}
