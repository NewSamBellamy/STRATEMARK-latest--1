/**
 * Corpus retrieval — how the app (and its agent) finds things in accumulated
 * research without loading it all into a prompt.
 *
 * The evidence log is the crown jewel of a long-lived deck: weeks of grounded
 * passes, hunts, verifications and notes. Keyword scoring over a weighted
 * field bundle is deliberately simple — deterministic, testable, zero
 * dependencies, and fast at corpus sizes this product reaches in years (a
 * 2,000-record scan is a millisecond-scale operation). Semantic/FTS
 * accelerators can slot underneath later; the passage contract here is the
 * stable part.
 */
import type { Citation } from '@mi/contracts';
import type { ResearchEvidence } from './research-evidence';

export interface ResearchPassage {
  evidenceId: string;
  companyId: string | null;
  companyName: string | null;
  topic: string;
  capturedAt: string;
  /** Best-matching window of the record, sentence-aligned and bounded. Verbatim record text. */
  snippet: string;
  citations: Citation[];
}

export interface CorpusQuery {
  query: string;
  /** Restrict to these companies (a deck's roster, a card's subject). Absent = the whole corpus. */
  companyIds?: readonly string[];
  topics?: readonly string[];
  /** Default 8. */
  limit?: number;
}

/** Words too common to rank on; a bigger stoplist would only hide domain terms. */
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'and', 'or', 'to', 'is', 'are', 'was', 'were', 'what', 'which', 'who', 'how', 'their', 'its', 'with', 'about', 'does', 'do', 'did', 'has', 'have']);

function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9.'-]{1,}/g) ?? [])
    .map(term => term.replace(/[.'-]+$/, ''))
    .filter(term => term.length >= 2 && !STOPWORDS.has(term));
}

/** Field bundle with weights: identity fields matter more than prose volume. */
function bundle(record: ResearchEvidence): { weighted: string; plain: string } {
  const grounding = record.grounding;
  const supportTexts = grounding ? grounding.supports.map(support => support.text).join(' ') : '';
  return {
    weighted: `${record.topic} ${record.topic} ${record.topic} ${record.companyName ?? ''} ${record.companyName ?? ''} ${record.companyName ?? ''} ${record.queries.join(' ')} ${record.queries.join(' ')}`,
    plain: `${record.text} ${grounding?.answerText ?? ''} ${supportTexts}`,
  };
}

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-Z"'(])/u;

/** Passage text is USER-FACING: strip the raw agent-output artifacts the red
 * team flagged — source-URL lines, markdown emphasis markers, and internal
 * field labels ("**Headline:**") — while keeping the words verbatim. */
function presentable(text: string): string {
  return text
    .split('\n')
    // URLs belong in the passage's citation chips, never its prose.
    .filter(line => !/https?:\/\//i.test(line))
    .join('\n')
    // Internal field labels ("**Source Type:**") are agent scaffolding.
    .replace(/\*\*[^*]{1,40}:\*\*\s*/g, '')
    .replace(/\*\*/g, '')
    .replace(/^\s*[A-Za-z][A-Za-z /&-]{2,30}:\s(?=[A-Z])/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best sentence-aligned window over the record's text fields, bounded. */
function snippet(record: ResearchEvidence, queryTerms: readonly string[]): string {
  const source = record.text && record.text.trim() ? record.text : record.grounding?.answerText ?? '';
  if (!source.trim()) return '';
  const sentences = presentable(source).split(SENTENCE_SPLIT).map(sentence => sentence.trim()).filter(Boolean);
  if (!sentences.length) return presentable(source).slice(0, 600);
  if (!queryTerms.length) return sentences.slice(0, 2).join(' ').slice(0, 700);
  const score = (sentence: string) => {
    const lower = sentence.toLowerCase();
    return queryTerms.reduce((total, term) => total + (lower.includes(term) ? 1 : 0), 0);
  };
  let bestIndex = 0;
  let bestScore = -1;
  sentences.forEach((sentence, index) => {
    const sentenceScore = score(sentence);
    if (sentenceScore > bestScore) { bestScore = sentenceScore; bestIndex = index; }
  });
  if (bestScore <= 0) return sentences.slice(0, 2).join(' ').slice(0, 700);
  const window = [sentences[bestIndex]!];
  if (bestIndex + 1 < sentences.length) window.push(sentences[bestIndex + 1]!);
  return window.join(' ').slice(0, 700);
}

export interface ScoredPassage extends ResearchPassage { score: number }

/** Rank the corpus for a query. Empty query = most recent records first. */
export function searchEvidenceCorpus(records: readonly ResearchEvidence[], query: CorpusQuery): ScoredPassage[] {
  const limit = Number.isFinite(query.limit) ? Math.min(25, Math.max(1, Math.floor(query.limit!))) : 8;
  const companyFilter = query.companyIds ? new Set(query.companyIds) : null;
  const topicFilter = query.topics ? new Set(query.topics.map(topic => topic.toLowerCase())) : null;
  const queryTerms = [...new Set(terms(query.query))];

  const candidates = records.filter(record => {
    if (companyFilter && (!record.companyId || !companyFilter.has(record.companyId))) return false;
    if (topicFilter && !topicFilter.has(record.topic.toLowerCase())) return false;
    return true;
  });

  if (!queryTerms.length) {
    return [...candidates]
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
      .slice(0, limit)
      .map(record => ({
        evidenceId: record.id, companyId: record.companyId ?? null, companyName: record.companyName ?? null,
        topic: record.topic, capturedAt: record.capturedAt,
        snippet: snippet(record, []), citations: record.citations.map(citation => ({ ...citation })), score: 0,
      }));
  }

  // Inverse document frequency over the scored bundle, corpus-local.
  const bundles = candidates.map(record => bundle(record));
  const docFrequency = new Map<string, number>();
  for (const { weighted, plain } of bundles) {
    const seen = new Set(terms(`${weighted} ${plain}`));
    for (const term of seen) docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
  }
  const idf = (term: string) => Math.log(1 + candidates.length / (1 + (docFrequency.get(term) ?? 0)));

  const scored = candidates.map((record, index) => {
    const { weighted, plain } = bundles[index]!;
    const weightedLower = weighted.toLowerCase();
    const plainLower = plain.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      const weight = idf(term);
      if (weightedLower.includes(term)) score += 3 * weight;
      const occurrences = plainLower.split(term).length - 1;
      // Log-frequency: repeated boilerplate terms must not drown unique ones.
      score += (occurrences > 0 ? 1 + Math.log(occurrences) : 0) * weight;
    }
    // Normalization: long records win by term-count alone unless damped.
    score = score / Math.sqrt(Math.max(1, (plain.length + weighted.length) / 500));
    return { record, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.record.capturedAt.localeCompare(a.record.capturedAt))
    .slice(0, limit)
    .map(({ record, score }) => ({
      evidenceId: record.id, companyId: record.companyId ?? null, companyName: record.companyName ?? null,
      topic: record.topic, capturedAt: record.capturedAt,
      snippet: snippet(record, queryTerms), citations: record.citations.map(citation => ({ ...citation })), score,
    }));
}
