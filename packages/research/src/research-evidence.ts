import { usableCitations, type Citation } from '@mi/contracts';
import type { LlmClient, ProviderGrounding } from './types';
import { copyProviderGrounding } from './grounding-support';
import { isOriginalSourceAttempt, type OriginalSourceAttempt } from './original-source';

function queryTerms(query: string | undefined): string[] {
  return [...new Set((query ?? '').slice(0, 2000).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter(term => term.length > 2 && !['the', 'and', 'for', 'what', 'how', 'this', 'company', 'about'].includes(term)).slice(0, 24);
}

/** Local retrieval relevance only. Originals remain untrusted, not accepted facts.
 * Bounded excerpts are contiguous original text, never synthesized quotations.
 */
export function searchOriginalSourceEvidence(attempts: readonly OriginalSourceAttempt[], input: { companyIds: readonly string[]; query: string }) {
  const allowed = new Set(input.companyIds);
  const terms = queryTerms(input.query);
  const candidates = attempts.filter(attempt => allowed.has(attempt.companyId) && isOriginalSourceAttempt(attempt))
    .flatMap(attempt => attempt.receipts.flatMap(receipt => {
      if (receipt.status !== 'retrieved' || !receipt.text?.trim()) return [];
      const sourceUrl = usableCitations([{ url: receipt.finalUrl ?? receipt.requestedUrl, title: '' }])[0]?.url;
      if (!sourceUrl) return [];
      const text = receipt.text;
      const searchable = `${attempt.metricType} ${text}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + Number(searchable.includes(term)), 0);
      if (terms.length && !score) return [];
      const limit = 1200;
      const starts = [0, ...terms.map(term => text.toLowerCase().indexOf(term)).filter(index => index >= 0)
        .map(index => Math.min(Math.max(0, index - 200), Math.max(0, text.length - limit)))];
      const start = starts.map(start => ({ start, score: terms.reduce((sum, term) => sum + Number(text.slice(start, start + limit).toLowerCase().includes(term)), 0) }))
        .sort((a, b) => b.score - a.score || a.start - b.start)[0]!.start;
      return [{ score, companyId: attempt.companyId, attemptId: attempt.id, metricType: attempt.metricType,
        sourceUrl, capturedAt: attempt.capturedAt, retrievedAt: receipt.retrievedAt, contentHash: receipt.contentHash,
        excerpt: text.slice(start, start + limit), excerptTruncated: Boolean(receipt.truncated || text.length > limit) }];
    })).sort((a, b) => b.score - a.score || b.capturedAt.localeCompare(a.capturedAt));
  const seen = new Set<string>();
  let characters = 0;
  // ponytail: bounded linear lookup over supplied receipts; indexed vault search replaces it at K2 scale.
  return candidates.flatMap(({ score: _score, ...entry }) => {
    const key = JSON.stringify([entry.companyId, entry.sourceUrl, entry.contentHash]);
    const size = JSON.stringify(entry).length;
    if (seen.has(key) || seen.size >= 4 || characters + size > 6500) return [];
    seen.add(key);
    characters += size;
    return [entry];
  });
}

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
    // Pacing counters pass through so the run log can read them (audit fix 4).
    metrics: () => client.metrics?.() ?? { calls: 0, retries: 0, rateLimitedMs: 0 },
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
  const terms = queryTerms(input.query);
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
