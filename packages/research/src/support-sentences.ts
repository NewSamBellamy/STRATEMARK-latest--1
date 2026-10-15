import type { ProviderGrounding } from './types';
import { sentenceAround } from './reported-metrics';

// Sentence ends, but not after a legal form, honorific or initial: "Anthropic
// Inc. CEO Dario Amodei" and "Lyre's Spirit Co. operates ..." stay one sentence.
// The abbreviation's own period belongs inside the look-behind: written without
// it (as this once was) the exclusion could never match, because the text ending
// at the split point always ends with the period, never with "Inc" or "Co".
export const SENTENCE_END = /(?<!\b(?:Inc|Corp|Ltd|Co|Jr|Sr|Dr|Mr|Ms|Mrs|St|plc|vs|[A-Z])\.)(?<=[.!?])\s+|\n+/u;

/**
 * Give every grounding support its whole sentence.
 *
 * Google marks only the clause it can attribute, and routinely leaves the
 * sentence's subject outside the span: "Lyre's Spirit Co. operates the Bourbon
 * Alternative as its product." arrives as a support reading "operates the
 * Bourbon Alternative as its product". The product and team gates require the
 * supporting sentence to name the company, so they dropped every such claim:
 * Lyre's showed no products although the research named eleven, and the metric
 * lane (which widens the same way, reported-metrics.ts) was the only one spared.
 *
 * The widened text is verbatim answer text and its offsets are updated to match,
 * so provider attribution of the clause is untouched. A support that cannot be
 * located, or already is a whole sentence, is returned as it was.
 */
export function widenSupportsToSentences(grounding: ProviderGrounding): ProviderGrounding {
  return {
    ...grounding,
    supports: grounding.supports.map((support) => {
      const text = sentenceAround(support.text, grounding.answerText, support.startIndex).trim();
      if (text === support.text || !text.trim() || !grounding.answerText.includes(text)) return support;
      const startIndex = grounding.answerText.indexOf(text, Math.max(0, (support.startIndex ?? 0) - text.length));
      return { ...support, text, ...(startIndex >= 0 ? { startIndex, endIndex: startIndex + text.length } : {}) };
    }),
  };
}
